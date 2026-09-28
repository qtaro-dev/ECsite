-- T22 MVP: anonymous demo accounts only. The original regular-member and
-- notification retention contract remains for a later ticket.
create table public.demo_retention_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text check (last_error_code in
    ('payment_pending','stripe_unavailable','auth_unavailable','db_unavailable','unexpected'))
);
create index demo_retention_queue_due_idx on public.demo_retention_queue(next_attempt_at,requested_at);
alter table public.demo_retention_queue enable row level security;
alter table public.demo_retention_queue force row level security;
create policy demo_retention_service on public.demo_retention_queue for all to service_role using (true) with check (true);
revoke all on public.demo_retention_queue from public,anon,authenticated;
grant select,insert,update,delete on public.demo_retention_queue to service_role;

create function public.request_demo_retention(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users u where u.id=p_user_id and u.is_anonymous is true) then
    return false;
  end if;
  insert into public.demo_retention_queue(user_id) values (p_user_id)
    on conflict (user_id) do update set next_attempt_at=pg_catalog.least(public.demo_retention_queue.next_attempt_at,now());
  return true;
end;
$$;
revoke all on function public.request_demo_retention(uuid) from public,anon,authenticated;
grant execute on function public.request_demo_retention(uuid) to service_role;

create function public.claim_demo_retention(p_limit integer default 5,p_user_id uuid default null)
returns table(user_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 5 then
    raise exception 'invalid retention batch size' using errcode='22023';
  end if;
  -- Supabase does not automatically purge anonymous Auth users.
  insert into public.demo_retention_queue(user_id,requested_at)
    select u.id,u.created_at from auth.users u
    where u.is_anonymous is true and u.created_at<=pg_catalog.clock_timestamp()-interval '30 days'
    order by u.created_at,u.id limit 100
    on conflict on constraint demo_retention_queue_pkey do nothing;

  return query
  with due as (
    select q.user_id from public.demo_retention_queue q
      where q.next_attempt_at<=pg_catalog.clock_timestamp()
        and (p_user_id is null or q.user_id=p_user_id)
      order by q.requested_at,q.user_id for update skip locked limit p_limit
  ), leased as (
    update public.demo_retention_queue q
       set next_attempt_at=pg_catalog.clock_timestamp()+interval '5 minutes',
           attempt_count=q.attempt_count+1
      from due d where q.user_id=d.user_id returning q.user_id
  ) select l.user_id from leased l;
end;
$$;
revoke all on function public.claim_demo_retention(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_demo_retention(integer,uuid) to service_role;

create function public.defer_demo_retention(p_user_id uuid,p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_code not in ('payment_pending','stripe_unavailable','auth_unavailable','db_unavailable','unexpected') then
    raise exception 'invalid retention reason' using errcode='22023';
  end if;
  update public.demo_retention_queue
    set next_attempt_at=pg_catalog.clock_timestamp()+interval '15 minutes',last_error_code=p_code
    where user_id=p_user_id;
end;
$$;
revoke all on function public.defer_demo_retention(uuid,text) from public,anon,authenticated;
grant execute on function public.defer_demo_retention(uuid,text) to service_role;

-- Final deletion is one transaction. FK cascades remove addresses, cart,
-- quotes, orders, items, attempts and allocations. Never cascade active holds.
create function public.finish_demo_retention(p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_is_anonymous boolean;
begin
  if p_user_id is null then return 'not_found'; end if;
  select u.is_anonymous into v_is_anonymous from auth.users u where u.id=p_user_id for update;
  if not found then return 'not_found'; end if;
  if v_is_anonymous is not true then return 'forbidden'; end if;
  perform 1 from public.orders o where o.user_id=p_user_id order by o.id for update;
  if exists (select 1 from public.orders o where o.user_id=p_user_id
      and o.status in ('payment_pending','review_required'))
    or exists (select 1 from public.payment_attempts pa join public.orders o on o.id=pa.order_id
      where o.user_id=p_user_id and pa.state in ('created','processing','review_required'))
    or exists (select 1 from public.stock_allocations sa join public.orders o on o.id=sa.order_id
      where o.user_id=p_user_id and sa.state='active') then
    return 'payment_pending';
  end if;
  delete from public.payment_events pe where pe.attempt_id in
    (select pa.id from public.payment_attempts pa join public.orders o on o.id=pa.order_id where o.user_id=p_user_id);
  -- Keep append-only audit facts. The existing auth.users BEFORE DELETE trigger
  -- safely unlinks actor_id while preserving every other audit field.
  delete from auth.users where id=p_user_id and is_anonymous is true;
  return 'deleted';
end;
$$;
revoke all on function public.finish_demo_retention(uuid) from public,anon,authenticated;
grant execute on function public.finish_demo_retention(uuid) to service_role;

-- Fail closed for attempts to create a new order after deletion was requested.
create function public.guard_demo_retention_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.demo_retention_queue q where q.user_id=new.user_id) then
    raise exception 'demo account deletion is pending' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger orders_block_demo_retention before insert on public.orders
  for each row execute function public.guard_demo_retention_order();
revoke all on function public.guard_demo_retention_order() from public,anon,authenticated;

create function public.invoke_t22_demo_retention()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_bypass_secret text;
  v_timestamp text := pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint::text;
  v_body jsonb := pg_catalog.jsonb_build_object('limit',5);
  v_signature text;
begin
  select max(s.decrypted_secret) filter (where s.name='t22_retention_url'),
         max(s.decrypted_secret) filter (where s.name='t22_internal_job_secret'),
         max(s.decrypted_secret) filter (where s.name='t22_vercel_bypass_secret')
    into v_url,v_secret,v_bypass_secret from vault.decrypted_secrets s
   where s.name in ('t22_retention_url','t22_internal_job_secret','t22_vercel_bypass_secret');
  if v_url is null and v_secret is null and v_bypass_secret is null then return null; end if;
  if v_url is null or v_secret is null or pg_catalog.octet_length(v_secret)<32
    or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/internal/delete-expired-demos$'
    or (v_bypass_secret is not null and (v_bypass_secret='' or v_bypass_secret ~ '[[:space:][:cntrl:]]')) then
    raise exception 'T22 Cron Vault configuration is missing or invalid' using errcode='55000';
  end if;
  v_signature := pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(v_timestamp||E'\n'||v_body::text,'UTF8'),
    pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex');
  return net.http_post(url:=v_url,body:=v_body,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json',
      'X-Internal-Job-Timestamp',v_timestamp,'X-Internal-Job-Signature',v_signature)
      || case when v_bypass_secret is null then '{}'::jsonb
           else pg_catalog.jsonb_build_object('x-vercel-protection-bypass',v_bypass_secret) end,
    timeout_milliseconds:=30000);
end;
$$;
revoke all on function public.invoke_t22_demo_retention() from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from cron.job where jobname='t22-demo-retention') then
    perform cron.unschedule(jobid) from cron.job where jobname='t22-demo-retention';
  end if;
  perform cron.schedule('t22-demo-retention','*/15 * * * *',
    'select public.invoke_t22_demo_retention();');
end $$;
