-- T08: authentication challenges, versioned shipping/SMTP settings,
-- notification outbox metadata, and append-only audit records.

create table public.sms_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('register','reset')),
  target_session_hash text not null check (target_session_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  verified_at timestamptz,
  delivery_mode text not null check (delivery_mode in ('mock','real')),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (verified_at is null or verified_at >= created_at)
);
create index sms_challenges_user_purpose_created_idx on public.sms_challenges(user_id,purpose,created_at desc);
create index sms_challenges_expiry_idx on public.sms_challenges(expires_at);

create table public.shipping_settings (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (btrim(version) <> ''),
  origin_prefecture_code smallint not null default 13 check (origin_prefecture_code between 1 and 47),
  base_fee_yen integer not null default 940 check (base_fee_yen >= 0),
  free_threshold_yen integer not null default 10000 check (free_threshold_yen >= 0),
  heavy_threshold_g integer not null default 20000 check (heavy_threshold_g > 0),
  heavy_rule_json jsonb not null check (jsonb_typeof(heavy_rule_json) = 'object'),
  yamato_source_url text not null check (yamato_source_url ~ '^https://'),
  source_checked_at timestamptz,
  is_active boolean not null default false,
  active_from timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index shipping_settings_single_active_idx on public.shipping_settings((is_active)) where is_active;
create index shipping_settings_active_version_idx on public.shipping_settings(active_from desc,version);
insert into public.shipping_settings(version,heavy_rule_json,yamato_source_url,is_active)
values ('initial-v1','{}'::jsonb,'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',true);

create table public.smtp_settings (
  id uuid primary key default gen_random_uuid(),
  host text not null check (btrim(host) <> ''),
  port integer not null check (port between 1 and 65535),
  tls_mode text not null check (tls_mode in ('implicit','starttls','none')),
  sender_address text not null check (sender_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  sender_name text not null check (btrim(sender_name) <> ''),
  username text,
  secret_ref text check (secret_ref is null or secret_ref ~ '^vault://[A-Za-z0-9/_-]{1,160}$'),
  is_active boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not is_active or secret_ref is not null)
);
create unique index smtp_settings_single_active_idx on public.smtp_settings((is_active)) where is_active;

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('auth_confirmation','password_reset','order_confirmation','order_status')),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  payload_ref text not null check (payload_ref ~ '^payload://[A-Za-z0-9/_-]{1,160}$'),
  state text not null default 'queued' check (state in ('queued','sending','sent','retry','failed','cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state in ('queued','retry') and attempt_count < 10) or state not in ('queued','retry'))
);
create index notification_jobs_state_next_attempt_idx on public.notification_jobs(state,next_attempt_at);
create index notification_jobs_created_idx on public.notification_jobs(created_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{0,95}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{0,47}$'),
  entity_id uuid,
  change_summary jsonb not null default '{"changed_fields":[]}'::jsonb
    check (jsonb_typeof(change_summary) = 'object' and change_summary ? 'changed_fields'),
  request_id text check (request_id is null or request_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  created_at timestamptz not null default now()
);
create index audit_logs_entity_created_idx on public.audit_logs(entity_type,entity_id,created_at desc);
create index audit_logs_actor_created_idx on public.audit_logs(actor_id,created_at desc);

-- Hashes are keyed HMAC-SHA-256 values, with a server-only key held outside the
-- database. Raw SHA-256 is insufficient for six-digit OTPs or email addresses.
comment on column public.sms_challenges.code_hash is
  'Keyed HMAC-SHA-256 of the OTP; key is held outside the database. Never store plaintext OTP.';
comment on column public.sms_challenges.target_session_hash is
  'Keyed HMAC-SHA-256 of the flow target; key is held outside the database.';
comment on column public.notification_jobs.recipient_hash is
  'Keyed HMAC-SHA-256 of recipient address; key is held outside the database.';

-- A missing or unmatched official rate is represented as null in the versioned
-- rate table and must be treated as SHIPPING_UNAVAILABLE by the quote service.
comment on column public.shipping_settings.heavy_rule_json is
  'Versioned official Yamato rates by destination, parcel size and weight; unmatched rates are unavailable, never inferred.';
comment on column public.smtp_settings.secret_ref is
  'Opaque reference to a protected secret store; never SMTP credential plaintext.';
create or replace function public.prevent_audit_log_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_id is not null
     and new.actor_id is null
     and current_setting('app.audit_actor_unlink', true) = 'on'
     and pg_trigger_depth() > 1
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'audit logs are append-only' using errcode = '55000';
end;
$$;
create or replace function public.validate_audit_summary()
returns trigger language plpgsql set search_path = '' as $$
declare item record; field_name text; summary_key text;
begin
  for item in select key,value from jsonb_each(new.change_summary) loop
    summary_key := item.key;
    if summary_key not in ('changed_fields','reason_code') then
      raise exception 'audit summary only accepts field names and reason codes' using errcode = '23514';
    end if;
    if summary_key = 'changed_fields' then
      if jsonb_typeof(item.value) <> 'array' then
        raise exception 'changed_fields must be an array' using errcode = '23514';
      end if;
      for field_name in select jsonb_array_elements_text(item.value) loop
        if field_name not in ('price_tax_included_yen','status','category_id','product_image','stock_on_hand',
          'shipping_base_fee_yen','shipping_free_threshold_yen','shipping_heavy_threshold_g','shipping_rate_table',
          'shipping_origin_prefecture_code','smtp_host','smtp_port','smtp_tls_mode','smtp_sender_address',
          'smtp_sender_name','smtp_username','smtp_secret_ref','admin_membership','order_status','payment_state') then
          raise exception 'audit field name is not allowlisted' using errcode = '23514';
        end if;
      end loop;
    elsif jsonb_typeof(item.value) <> 'string' or item.value #>> '{}' not in
      ('manual_update','connection_test','stock_adjustment','product_change','order_exception','role_change',
       'configuration_change','reconciliation','privacy_unlink') then
      raise exception 'audit reason code is not allowlisted' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
create trigger audit_logs_safe_summary before insert on public.audit_logs
  for each row execute function public.validate_audit_summary();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

-- Unlink only the account UUID before Auth's 30-day deletion. All audited facts
-- remain byte-for-byte unchanged, so deletion can proceed without retaining a
-- persistent link to the erased account.
create or replace function public.unlink_deleted_user_from_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.audit_actor_unlink','on',true);
  update public.audit_logs set actor_id = null where actor_id = old.id;
  perform set_config('app.audit_actor_unlink','off',true);
  return old;
end;
$$;
create trigger auth_users_unlink_audit_before_delete before delete on auth.users
  for each row execute function public.unlink_deleted_user_from_audit();

create trigger notification_jobs_updated_at before update on public.notification_jobs
  for each row execute function public.set_updated_at();

alter table public.sms_challenges enable row level security;
alter table public.shipping_settings enable row level security;
alter table public.smtp_settings enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.audit_logs enable row level security;
