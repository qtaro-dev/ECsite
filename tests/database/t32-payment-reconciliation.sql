\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000401','authenticated','authenticated','t32-member@example.test',now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ('00000000-0000-4000-8000-000000000400',(select id from public.categories where slug='cpu'),
  't32-reconcile-fixture','T32-CPU','T32 Reconciliation fixture','T32 Labs','fixture','fixture',100,1000,'draft',500,300,200,100);
insert into public.inventory(product_id,on_hand,allocated)
values ('00000000-0000-4000-8000-000000000400',10,4);
insert into public.orders(id,user_id,status,currency,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
  shipping_total_yen,tax_total_yen,grand_total_yen,tax_rate_basis_points,shipping_rule_version,
  origin_snapshot,address_snapshot,checkout_key)
values
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000401','payment_pending','JPY',100,0,0,0,9,100,1000,'t32-fixture','{}','{}','00000000-0000-4000-8000-000000000431'),
 ('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000401','payment_pending','JPY',100,0,0,0,9,100,1000,'t32-fixture','{}','{}','00000000-0000-4000-8000-000000000433'),
 ('00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000401','expired','JPY',100,0,0,0,9,100,1000,'t32-fixture','{}','{}','00000000-0000-4000-8000-000000000435'),
 ('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000401','payment_pending','JPY',100,0,0,0,9,100,1000,'t32-fixture','{}','{}','00000000-0000-4000-8000-000000000437'),
 ('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000401','payment_pending','JPY',100,0,0,0,9,100,1000,'t32-fixture','{}','{}','00000000-0000-4000-8000-000000000439');
insert into public.payment_attempts(id,order_id,attempt_no,state,amount_yen,expires_at,
  stripe_session_id,stripe_session_expires_at,stripe_session_site_origin,stripe_payment_intent_id)
values
 ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000401',1,'created',100,now()-interval '35 minutes','cs_test_t32_000000000401',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,'https://shop.example.test',null),
 ('00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000403',1,'processing',100,now()-interval '35 minutes','cs_test_t32_000000000403',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,'https://shop.example.test',null),
 ('00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000405',1,'expired',100,now()-interval '35 minutes','cs_test_t32_000000000405',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,'https://shop.example.test',null),
 ('00000000-0000-4000-8000-000000000408','00000000-0000-4000-8000-000000000407',1,'processing',100,now()-interval '35 minutes','cs_test_t32_000000000407',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,'https://shop.example.test',null),
 ('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000409',1,'processing',100,now()+interval '5 minutes','cs_test_t32_000000000409',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1800,'https://shop.example.test',null);
insert into public.stock_allocations(order_id,product_id,quantity,expires_at,state,resolved_at)
values
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000400',1,now()-interval '1 minute','active',null),
 ('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000400',1,now()-interval '1 minute','active',null),
 ('00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000400',1,now()-interval '1 minute','released',now()),
 ('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000400',1,now()-interval '1 minute','active',null),
 ('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000400',1,now()+interval '5 minutes','active',null);

create function pg_temp.t32_apply(
  p_order uuid,p_attempt uuid,p_result text,p_session_status text,p_payment_status text,p_pi_status text,
  p_pi_received integer default null
) returns jsonb language sql as $$
  select public.apply_checkout_reconciliation(
    p_order,p_attempt,p_result,
    'cs_test_t32_'||pg_catalog.right(pg_catalog.replace(p_order::text,'-',''),12),
    'payment',false,p_session_status,p_payment_status,100,'jpy',
    pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-3900,
    pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,
    p_order::text,p_attempt::text,
    case when p_pi_status is null then null else 'pi_t32_'||pg_catalog.right(pg_catalog.replace(p_order::text,'-',''),12) end,
    p_pi_status,100,case when p_pi_status is null then p_pi_received
      else coalesce(p_pi_received,case when p_pi_status='succeeded' then 100 else 0 end) end,
    case when p_pi_status is null then null else 'jpy' end,
    case when p_pi_status is null then null else p_order::text end,
    case when p_pi_status is null then null else p_attempt::text end
  );
$$;

do $$ declare r jsonb; c record; n integer; begin
  if has_function_privilege('anon','public.claim_expired_checkout_attempts(integer)','EXECUTE')
     or has_function_privilege('authenticated','public.claim_expired_checkout_attempts(integer)','EXECUTE')
     or has_function_privilege('anon','public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE') then
    raise exception 'browser roles may execute service-only reconciliation RPCs';
  end if;
  if not has_function_privilege('service_role','public.claim_expired_checkout_attempts(integer)','EXECUTE')
     or not has_function_privilege('service_role','public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE') then
    raise exception 'service_role cannot execute reconciliation RPCs';
  end if;
  begin
    perform public.claim_expired_checkout_attempts(4);
    raise exception 'claim accepted a batch larger than the route timeout budget';
  exception when invalid_parameter_value then null; end;

  select count(*) into n from public.claim_expired_checkout_attempts(3);
  if n<>3 then raise exception 'expected three due active attempts, got %',n; end if;
  select count(*) into n from public.claim_expired_checkout_attempts(3);
  if n<>0 then raise exception 'active reconciliation lease was claimed twice'; end if;
  if (select reconciliation_attempt_count from public.payment_attempts where id='00000000-0000-4000-8000-000000000410')<>0
     or (select reconciliation_next_attempt_at from public.payment_attempts where id='00000000-0000-4000-8000-000000000410') is not null then
    raise exception 'non-expired attempt was selected';
  end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402','succeeded','complete','paid','succeeded');
  if r->>'status'<>'processed' or (select status from public.orders where id='00000000-0000-4000-8000-000000000401')<>'paid'
     or (select state from public.payment_attempts where id='00000000-0000-4000-8000-000000000402')<>'succeeded'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000401')<>'consumed'
     or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>9
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>3 then
    raise exception 'verified late success did not atomically consume active stock: %',r;
  end if;
  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000402','succeeded','complete','paid','succeeded');
  if r->>'status'<>'already_paid' or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>9 then
    raise exception 'duplicate reconciliation consumed stock twice';
  end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000404','failed','complete','unpaid','requires_payment_method');
  if r->>'status'<>'processed' or (select status from public.orders where id='00000000-0000-4000-8000-000000000403')<>'payment_failed'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000403')<>'released'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>2 then
    raise exception 'definitive failure did not atomically release active stock: %',r;
  end if;
  update public.payment_attempts set reconciliation_next_attempt_at=now()-interval '1 second'
    where id='00000000-0000-4000-8000-000000000404';
  select count(*) into n from public.claim_expired_checkout_attempts(3)
    where attempt_id='00000000-0000-4000-8000-000000000404';
  if n<>0 then raise exception 'fully resolved terminal attempt was claimed repeatedly'; end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000406','succeeded','complete','paid','succeeded');
  if r->>'status'<>'needs_review' or (select status from public.orders where id='00000000-0000-4000-8000-000000000405')<>'review_required'
     or (select state from public.payment_attempts where id='00000000-0000-4000-8000-000000000406')<>'review_required'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000405')<>'released'
     or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>9
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>2 then
    raise exception 'success after release was not retained for review without stock mutation: %',r;
  end if;
  update public.payment_attempts set reconciliation_next_attempt_at=now()-interval '1 second'
    where id='00000000-0000-4000-8000-000000000406';
  select count(*) into n from public.claim_expired_checkout_attempts(3)
    where attempt_id='00000000-0000-4000-8000-000000000406';
  if n<>0 then raise exception 'stockless manual-review attempt was polled repeatedly'; end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000408','unavailable',null,null,null);
  if r->>'status'<>'needs_review' or (select status from public.orders where id='00000000-0000-4000-8000-000000000407')<>'review_required'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000407')<>'active'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>2 then
    raise exception 'unavailable Stripe lookup released stock instead of retaining it: %',r;
  end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000408','failed','complete','unpaid','requires_payment_method',100);
  if r->>'status'<>'needs_review' or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000407')<>'active'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>2 then
    raise exception 'failure response with nonzero received amount released stock: %',r;
  end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000408','expired','expired','paid',null);
  if r->>'status'<>'needs_review' or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000407')<>'active'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>2 then
    raise exception 'expired Session with paid status released stock: %',r;
  end if;

  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000410','succeeded','complete','paid','succeeded');
  if r->>'status'<>'not_due' or (select status from public.orders where id='00000000-0000-4000-8000-000000000409')<>'payment_pending' then
    raise exception 'reconciliation changed an attempt before its deadline: %',r;
  end if;

  update public.payment_attempts set expires_at=now()-interval '35 minutes',
    stripe_session_expires_at=pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100
    where id='00000000-0000-4000-8000-000000000410';
  update public.stock_allocations set expires_at=now()-interval '1 minute'
    where order_id='00000000-0000-4000-8000-000000000409';
  r := pg_temp.t32_apply('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000410','expired','expired','unpaid',null,null);
  if r->>'status'<>'processed' or (select status from public.orders where id='00000000-0000-4000-8000-000000000409')<>'expired'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000409')<>'released'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000400')<>1 then
    raise exception 'unpaid expired Session without a PaymentIntent did not safely release its allocation: %',r;
  end if;
end $$;

-- Verify pg_net's queued bytes and the HMAC that the Vercel raw-body verifier
-- receives. The surrounding transaction rolls the synthetic Vault secrets and
-- queued request back before pg_net can send anything.
do $$
declare
  v_request_id bigint;
  v_body bytea;
  v_headers jsonb;
  v_timestamp text;
  v_signature text;
  v_expected text;
  v_body_text text;
  v_secret text := 't32-synthetic-cron-signing-secret-for-test-only';
begin
  if not exists(select 1 from cron.job where jobname='t32-payment-reconciliation' and schedule='*/5 * * * *') then
    raise exception 'five-minute T32 Supabase Cron job was not registered';
  end if;
  if has_function_privilege('anon','public.invoke_t32_payment_reconciliation()','EXECUTE')
     or has_function_privilege('authenticated','public.invoke_t32_payment_reconciliation()','EXECUTE')
     or has_function_privilege('service_role','public.invoke_t32_payment_reconciliation()','EXECUTE') then
    raise exception 'only the postgres-owned Cron job may invoke the Vault-backed sender';
  end if;
  perform vault.create_secret('https://t32-test.invalid/api/internal/reconcile-payments','t32_reconciliation_url','transactional fixture');
  perform vault.create_secret(v_secret,'t32_internal_job_secret','transactional fixture');
  v_request_id := public.invoke_t32_payment_reconciliation();
  if v_request_id is null then raise exception 'configured Cron sender did not queue an HTTP request'; end if;
  select q.body,q.headers into v_body,v_headers from net.http_request_queue q where q.id=v_request_id;
  if v_body is null or v_headers is null then raise exception 'pg_net queued request was not inspectable'; end if;
  v_body_text := pg_catalog.convert_from(v_body,'UTF8');
  if v_body_text<>'{"limit": 3}' then raise exception 'pg_net request body bytes differ from the signed body'; end if;
  v_timestamp := v_headers->>'X-Internal-Job-Timestamp';
  v_signature := v_headers->>'X-Internal-Job-Signature';
  v_expected := pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(v_timestamp||E'\n'||v_body_text,'UTF8'),
    pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex');
  if v_signature is distinct from v_expected
     or (v_headers->>'Content-Type') is distinct from 'application/json' then
    raise exception 'Cron HMAC did not cover the exact pg_net body bytes';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000401',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000401","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.claim_expired_checkout_attempts(10);
    raise exception 'authenticated member executed reconciliation claim';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_checkout_reconciliation(null,null,'pending',null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null);
    raise exception 'authenticated member executed reconciliation transition';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
