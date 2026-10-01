-- T56: durable first-owner claim survives auth.users/admin_memberships cascade deletion.
create table public.admin_setup_claim (
  id smallint primary key check (id = 1),
  claimed_at timestamptz not null default now()
);
alter table public.admin_setup_claim enable row level security;
revoke all on public.admin_setup_claim from public, anon, authenticated;
grant select on public.admin_setup_claim to service_role;
-- Preserve closure if an older admin membership has already been removed by
-- auth.users ON DELETE CASCADE before this migration is applied.
insert into public.admin_setup_claim(id)
select 1
where exists (select 1 from public.admin_memberships)
   or exists (select 1 from public.audit_logs
      where entity_type = 'admin_membership'
        and action in ('admin_membership.granted', 'admin_membership.revoked'))
on conflict (id) do nothing;

create table public.admin_setup_attempts (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count smallint not null check (attempt_count between 1 and 11)
);
alter table public.admin_setup_attempts enable row level security;
revoke all on public.admin_setup_attempts from public, anon, authenticated;

create or replace function public.bootstrap_first_admin(p_user_id uuid, p_request_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_request_id !~ '^[A-Za-z0-9_.:-]{1,128}$' then
    raise exception 'invalid bootstrap input' using errcode = '22023';
  end if;

  -- Serialize all bootstrap attempts, including attempts for distinct users.
  perform pg_catalog.pg_advisory_xact_lock(56001001);
  if exists (select 1 from public.admin_setup_claim) or exists (select 1 from public.admin_memberships) then
    return false;
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous is not true) then
    raise exception 'auth user unavailable' using errcode = '23503';
  end if;

  insert into public.admin_setup_claim(id) values (1);
  insert into public.admin_memberships(user_id, granted_by)
  values (p_user_id, p_user_id);
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, change_summary, request_id)
  values (p_user_id, 'admin_membership.granted', 'admin_membership', p_user_id,
    '{"changed_fields":["admin_membership"],"reason_code":"role_change"}'::jsonb, p_request_id);
  return true;
end;
$$;

create or replace function public.consume_admin_setup_attempt(p_bucket_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_window timestamptz; current_count smallint;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  if p_bucket_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid rate limit bucket' using errcode = '22023'; end if;
  delete from public.admin_setup_attempts where window_started_at < now() - interval '1 hour';
  insert into public.admin_setup_attempts(bucket_hash, window_started_at, attempt_count)
    values (p_bucket_hash, now(), 1)
    on conflict (bucket_hash) do update
      set attempt_count = case when public.admin_setup_attempts.window_started_at <= now() - interval '10 minutes'
        then 1 else least(public.admin_setup_attempts.attempt_count + 1, 11) end,
          window_started_at = case when public.admin_setup_attempts.window_started_at <= now() - interval '10 minutes'
        then now() else public.admin_setup_attempts.window_started_at end
    returning window_started_at, attempt_count into current_window, current_count;
  return current_count <= 10 and current_window > now() - interval '10 minutes';
end;
$$;

revoke all on function public.bootstrap_first_admin(uuid,text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid,text) to service_role;
revoke all on function public.consume_admin_setup_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_admin_setup_attempt(text) to service_role;
