\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000521','authenticated','authenticated',true,now()-interval '30 days 1 second',now()),
 ('00000000-0000-0000-0000-000000000522','authenticated','authenticated',true,now()-interval '30 days'+interval '1 second',now()),
 ('00000000-0000-0000-0000-000000000523','authenticated','authenticated',false,now()-interval '31 days',now());
insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street) values
 ('00000000-0000-0000-0000-000000000521','デモ購入者','0000000',13,'架空市','デモ専用1番地'),
 ('00000000-0000-0000-0000-000000000522','デモ購入者','0000000',1,'架空市','デモ専用1番地');
insert into public.carts(user_id) values ('00000000-0000-0000-0000-000000000521'),('00000000-0000-0000-0000-000000000522');
insert into public.audit_logs(actor_id,action,entity_type,entity_id) values
 ('00000000-0000-0000-0000-000000000521','demo.test','account',null);
-- Existing pending orders must predate the retention request. The production
-- order guard intentionally rejects any new order once the request is queued.
insert into public.orders(user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
  tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
values ('00000000-0000-0000-0000-000000000522','payment_pending',1000,0,0,0,90,1000,'t22-test','{}','{}',
  '00000000-0000-4000-8000-000000000522');
-- Precreate the second order used later to test an active hold. The retention
-- request guard intentionally blocks creating it after the request is queued.
insert into public.orders(user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
  tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
values ('00000000-0000-0000-0000-000000000522','expired',1000,0,0,0,90,1000,'t22-test','{}','{}',
  '00000000-0000-0000-0000-000000000525') returning id \gset active_hold_

do $$ declare claimed uuid; begin
  select user_id into claimed from public.claim_demo_retention(5,null);
  if claimed <> '00000000-0000-0000-0000-000000000521' then raise exception '30-day boundary or anonymous scope failed'; end if;
  if (select count(*) from public.demo_retention_queue) <> 1 then raise exception 'unexpected retention candidate'; end if;
  if public.finish_demo_retention(claimed) <> 'deleted' then raise exception 'expired demo not deleted'; end if;
  if exists(select 1 from auth.users where id=claimed)
    or exists(select 1 from public.addresses where user_id=claimed)
    or exists(select 1 from public.carts where user_id=claimed)
    or exists(select 1 from public.audit_logs where actor_id=claimed)
    or exists(select 1 from public.demo_retention_queue where user_id=claimed) then
    raise exception 'demo cascade/audit deletion incomplete';
  end if;
  if not exists(select 1 from public.audit_logs where action='demo.test' and entity_type='account'
      and actor_id is null and entity_id is null and change_summary='{"changed_fields":[]}'::jsonb) then
    raise exception 'append-only audit fact was not preserved with its actor unlinked';
  end if;
  if not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000522')
    or not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000523') then
    raise exception 'other or normal member deleted';
  end if;
  if public.request_demo_retention('00000000-0000-0000-0000-000000000523') then
    raise exception 'normal member queued as demo';
  end if;
  if not public.request_demo_retention('00000000-0000-0000-0000-000000000522') then
    raise exception 'self-request queue failed';
  end if;
  begin
    insert into public.orders(user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
      tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
    values ('00000000-0000-0000-0000-000000000522','payment_pending',1000,0,0,0,90,1000,'t22-test','{}','{}',
      '00000000-0000-4000-8000-000000000526');
    raise exception 'order accepted after deletion was requested';
  exception when check_violation then null;
  end;
  update public.demo_retention_queue set next_attempt_at=clock_timestamp()+interval '15 minutes'
    where user_id='00000000-0000-0000-0000-000000000522';
  if not public.request_demo_retention('00000000-0000-0000-0000-000000000522') then
    raise exception 'repeat deletion request was rejected';
  end if;
  if (select next_attempt_at from public.demo_retention_queue
      where user_id='00000000-0000-0000-0000-000000000522') > clock_timestamp() then
    raise exception 'repeat deletion request did not safely shorten the retry time';
  end if;
end $$;
do $$ begin
  if public.finish_demo_retention('00000000-0000-0000-0000-000000000522') <> 'payment_pending'
    then raise exception 'pending order cascaded'; end if;
  if not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000522')
    then raise exception 'pending demo Auth deleted'; end if;
  perform public.defer_demo_retention('00000000-0000-0000-0000-000000000522','payment_pending');
  if (select last_error_code from public.demo_retention_queue where user_id='00000000-0000-0000-0000-000000000522') <> 'payment_pending'
    then raise exception 'failure not monitorable'; end if;
end $$;
delete from public.orders where user_id='00000000-0000-0000-0000-000000000522' and status='payment_pending';
insert into public.stock_allocations(order_id,product_id,quantity,state,expires_at)
values (:'active_hold_id',null,1,'active',now()+interval '1 hour');
do $$ begin
  if public.finish_demo_retention('00000000-0000-0000-0000-000000000522') <> 'payment_pending'
    then raise exception 'active stock allocation was cascaded'; end if;
  if not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000522')
    then raise exception 'demo Auth deleted with active allocation'; end if;
end $$;
delete from public.stock_allocations where order_id=:'active_hold_id';
delete from public.orders where id=:'active_hold_id';
do $$ begin
  if public.finish_demo_retention('00000000-0000-0000-0000-000000000522') <> 'deleted'
    then raise exception 'retry did not complete'; end if;
  if exists(select 1 from public.addresses where user_id='00000000-0000-0000-0000-000000000522')
    then raise exception 'address remained after retry'; end if;
end $$;

-- Verify the T22 Vault-backed sender keeps the URL and HMAC contract, and adds
-- Vercel's recommended bypass header only when its optional Vault secret exists.
do $$
declare
  v_request_id bigint;
  v_body bytea;
  v_headers jsonb;
  v_body_text text;
  v_timestamp text;
  v_signature text;
  v_expected text;
  v_hmac_secret text := 't22-synthetic-cron-signing-secret-for-test-only';
  v_bypass_secret text := 't22-synthetic-vercel-bypass-secret-for-test-only';
begin
  if not exists(select 1 from cron.job where jobname='t22-demo-retention' and schedule='*/15 * * * *') then
    raise exception '15-minute T22 Supabase Cron job was not registered';
  end if;
  if has_function_privilege('anon','public.invoke_t22_demo_retention()','EXECUTE')
     or has_function_privilege('authenticated','public.invoke_t22_demo_retention()','EXECUTE')
     or has_function_privilege('service_role','public.invoke_t22_demo_retention()','EXECUTE') then
    raise exception 'only the postgres-owned Cron job may invoke the Vault-backed sender';
  end if;
  perform vault.create_secret('https://t22-test.invalid/api/internal/delete-expired-demos','t22_retention_url','transactional fixture');
  perform vault.create_secret(v_hmac_secret,'t22_internal_job_secret','transactional fixture');
  v_request_id := public.invoke_t22_demo_retention();
  select q.body,q.headers into v_body,v_headers from net.http_request_queue q where q.id=v_request_id;
  if v_body is null or v_headers is null then raise exception 'T22 pg_net request was not inspectable'; end if;
  v_body_text := pg_catalog.convert_from(v_body,'UTF8');
  if v_body_text <> '{"limit": 5}' then raise exception 'T22 Cron body bytes differ from the signed body'; end if;
  if v_headers ? 'x-vercel-protection-bypass' then raise exception 'optional Vercel bypass header was sent while unconfigured'; end if;
  v_timestamp := v_headers->>'X-Internal-Job-Timestamp';
  v_signature := v_headers->>'X-Internal-Job-Signature';
  v_expected := pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(v_timestamp||E'\n'||v_body_text,'UTF8'),
    pg_catalog.convert_to(v_hmac_secret,'UTF8'),'sha256'),'hex');
  if v_signature is distinct from v_expected then raise exception 'T22 Cron HMAC did not cover exact request bytes'; end if;

  perform vault.create_secret(v_bypass_secret,'t22_vercel_bypass_secret','transactional fixture');
  v_request_id := public.invoke_t22_demo_retention();
  select q.headers into v_headers from net.http_request_queue q where q.id=v_request_id;
  if v_headers->>'x-vercel-protection-bypass' is distinct from v_bypass_secret then
    raise exception 'configured Vercel bypass secret was not sent as its HTTP header';
  end if;
end;
$$;

set local role authenticated;
do $$ begin
  begin perform public.claim_demo_retention(1,null); raise exception 'member claimed retention';
  exception when insufficient_privilege then null; end;
  begin perform public.finish_demo_retention('00000000-0000-0000-0000-000000000523'); raise exception 'member deleted another account';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.demo_retention_queue; raise exception 'member read service queue';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
