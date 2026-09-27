\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000311','authenticated','authenticated','t31-member@example.test',now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ('00000000-0000-4000-8000-000000000310',(select id from public.categories where slug='cpu'),
  't31-webhook-fixture','T31-CPU','T31 Webhook fixture','T31 Labs','fixture','fixture',100,1000,'draft',500,300,200,100);
insert into public.inventory(product_id,on_hand,allocated)
values ('00000000-0000-4000-8000-000000000310',20,6);
insert into public.orders(id,user_id,status,currency,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
  shipping_total_yen,tax_total_yen,grand_total_yen,tax_rate_basis_points,shipping_rule_version,
  origin_snapshot,address_snapshot,checkout_key)
values
 ('00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000331'),
 ('00000000-0000-4000-8000-000000000313','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000333'),
 ('00000000-0000-4000-8000-000000000315','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000335'),
 ('00000000-0000-4000-8000-000000000317','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000337'),
 ('00000000-0000-4000-8000-000000000319','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000339'),
 ('00000000-0000-4000-8000-000000000321','00000000-0000-4000-8000-000000000311','payment_pending','JPY',100,0,0,0,9,100,1000,'t31-fixture','{}','{}','00000000-0000-4000-8000-000000000341');
insert into public.payment_attempts(id,order_id,attempt_no,state,amount_yen,expires_at,
  stripe_session_id,stripe_session_expires_at,stripe_session_site_origin)
values
 ('00000000-0000-4000-8000-000000000312','00000000-0000-4000-8000-000000000311',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000311',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test'),
 ('00000000-0000-4000-8000-000000000314','00000000-0000-4000-8000-000000000313',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000313',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test'),
 ('00000000-0000-4000-8000-000000000316','00000000-0000-4000-8000-000000000315',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000315',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test'),
 ('00000000-0000-4000-8000-000000000318','00000000-0000-4000-8000-000000000317',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000317',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test'),
 ('00000000-0000-4000-8000-000000000320','00000000-0000-4000-8000-000000000319',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000319',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test'),
 ('00000000-0000-4000-8000-000000000322','00000000-0000-4000-8000-000000000321',1,'processing',100,now()+interval '35 minutes','cs_test_t31_000000000321',pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,'https://shop.example.test');
insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
select v.order_id,'00000000-0000-4000-8000-000000000310',1,now()+interval '35 minutes'
from (values
 ('00000000-0000-4000-8000-000000000311'::uuid),('00000000-0000-4000-8000-000000000313'::uuid),
 ('00000000-0000-4000-8000-000000000315'::uuid),('00000000-0000-4000-8000-000000000317'::uuid),
 ('00000000-0000-4000-8000-000000000319'::uuid),('00000000-0000-4000-8000-000000000321'::uuid)
) v(order_id);

create function pg_temp.t31_apply_event(
  p_event_id text,p_event_type text,p_result text,p_order_id uuid,p_attempt_id uuid,
  p_session_status text,p_payment_status text,p_session_amount integer,p_session_currency text,
  p_metadata_order_id text,p_payment_intent_id text,p_payment_intent_status text,
  p_payment_intent_amount_received integer,p_payment_intent_currency text,p_pi_metadata_order_id text
) returns jsonb language sql as $$
  select public.apply_stripe_checkout_webhook(
    p_event_id,p_event_type,p_result,p_order_id,p_attempt_id,
    'cs_test_t31_'||pg_catalog.substr(pg_catalog.replace(p_order_id::text,'-',''),1,12),
    'payment',false,p_session_status,p_payment_status,p_session_amount,p_session_currency,
    pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint,
    pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint+1810,
    p_metadata_order_id,p_attempt_id::text,p_payment_intent_id,p_payment_intent_status,
    case when p_payment_intent_id is null then null else p_session_amount end,
    p_payment_intent_amount_received,p_payment_intent_currency,p_pi_metadata_order_id,
    case when p_payment_intent_id is null then null else p_attempt_id::text end
  );
$$;
create function pg_temp.t31_fail_event_finalize() returns trigger language plpgsql as $t31$
begin
  if new.stripe_event_id='evt_t31_retry' then raise exception 'injected database failure'; end if;
  return new;
end
$t31$;

do $$ declare r jsonb; begin
  if has_function_privilege('anon','public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.ignore_stripe_webhook_event(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.ignore_stripe_webhook_event(text,text)','EXECUTE') then
    raise exception 'browser roles may execute service-only Stripe webhook RPCs';
  end if;
  if not has_function_privilege('service_role','public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.ignore_stripe_webhook_event(text,text)','EXECUTE') then
    raise exception 'service_role cannot execute Stripe webhook RPCs';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000311',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000311","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.ignore_stripe_webhook_event('evt_t31_forbidden','customer.updated');
    raise exception 'authenticated member executed event ignore RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_stripe_checkout_webhook('evt_t31_forbidden','checkout.session.completed','pending',null,null,
      'cs_test_forbidden','payment',false,'open','unpaid',100,'jpy',1,2,null,null,null,null,null,null,null,null,null);
    raise exception 'authenticated member executed payment transition RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ declare r jsonb; begin
  r := pg_temp.t31_apply_event('evt_t31_success','checkout.session.completed','succeeded',
    '00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000312',
    'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000311','pi_t31_311','succeeded',100,'jpy','00000000-0000-4000-8000-000000000311');
  if r->>'status'<>'processed' then raise exception 'verified success did not process: %',r; end if;
  if (select status from public.orders where id='00000000-0000-4000-8000-000000000311')<>'paid'
     or (select state from public.payment_attempts where id='00000000-0000-4000-8000-000000000312')<>'succeeded'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000311')<>'consumed'
     or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000310')<>19
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000310')<>5 then
    raise exception 'success and stock consumption were not atomic';
  end if;
  r := pg_temp.t31_apply_event('evt_t31_success','checkout.session.completed','succeeded',
    '00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000312',
    'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000311','pi_t31_311','succeeded',100,'jpy','00000000-0000-4000-8000-000000000311');
  if r->>'status'<>'duplicate' then raise exception 'same Stripe event was not deduplicated: %',r; end if;
  r := pg_temp.t31_apply_event('evt_t31_success_again','checkout.session.async_payment_succeeded','succeeded',
    '00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000312',
    'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000311','pi_t31_311','succeeded',100,'jpy','00000000-0000-4000-8000-000000000311');
  if r->>'status'<>'processed' or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000310')<>19 then
    raise exception 'distinct duplicate success consumed inventory twice: %',r;
  end if;

  r := pg_temp.t31_apply_event('evt_t31_amount_mismatch','checkout.session.completed','succeeded',
    '00000000-0000-4000-8000-000000000313','00000000-0000-4000-8000-000000000314',
    'complete','paid',99,'jpy','00000000-0000-4000-8000-000000000313','pi_t31_313','succeeded',99,'jpy','00000000-0000-4000-8000-000000000313');
  if r->>'status'<>'needs_review' or (select status from public.orders where id='00000000-0000-4000-8000-000000000313')<>'review_required'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000313')<>'active' then
    raise exception 'amount mismatch was not retained for review: %',r;
  end if;
  r := pg_temp.t31_apply_event('evt_t31_currency_mismatch','checkout.session.completed','succeeded',
    '00000000-0000-4000-8000-000000000315','00000000-0000-4000-8000-000000000316',
    'complete','paid',100,'usd','00000000-0000-4000-8000-000000000315','pi_t31_315','succeeded',100,'usd','00000000-0000-4000-8000-000000000315');
  if r->>'status'<>'needs_review' or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000315')<>'active' then
    raise exception 'currency mismatch was not retained for review: %',r;
  end if;
  r := pg_temp.t31_apply_event('evt_t31_metadata_mismatch','checkout.session.completed','succeeded',
    '00000000-0000-4000-8000-000000000317','00000000-0000-4000-8000-000000000318',
    'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000313','pi_t31_317','succeeded',100,'jpy','00000000-0000-4000-8000-000000000313');
  if r->>'status'<>'needs_review' or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000317')<>'active' then
    raise exception 'metadata mismatch was not retained for review: %',r;
  end if;

  -- Simulate a database failure after the event insert. The event and all state
  -- changes must roll back so Stripe can retry the same event ID safely.
  execute 'create trigger t31_fail_event_finalize before update on public.payment_events for each row execute function pg_temp.t31_fail_event_finalize()';
  begin
    perform pg_temp.t31_apply_event('evt_t31_retry','checkout.session.async_payment_succeeded','succeeded',
      '00000000-0000-4000-8000-000000000317','00000000-0000-4000-8000-000000000318',
      'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000317','pi_t31_317','succeeded',100,'jpy','00000000-0000-4000-8000-000000000317');
    raise exception 'injected failure did not abort the RPC';
  exception when others then
    if sqlerrm='injected failure did not abort the RPC' then raise; end if;
  end;
  if exists(select 1 from public.payment_events where stripe_event_id='evt_t31_retry')
     or (select status from public.orders where id='00000000-0000-4000-8000-000000000317')<>'payment_pending'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000317')<>'active' then
    raise exception 'failed webhook RPC left a partial event or state change';
  end if;
  execute 'drop trigger t31_fail_event_finalize on public.payment_events';
  r := pg_temp.t31_apply_event('evt_t31_retry','checkout.session.async_payment_succeeded','succeeded',
    '00000000-0000-4000-8000-000000000317','00000000-0000-4000-8000-000000000318',
    'complete','paid',100,'jpy','00000000-0000-4000-8000-000000000317','pi_t31_317','succeeded',100,'jpy','00000000-0000-4000-8000-000000000317');
  if r->>'status'<>'processed' or (select outcome from public.payment_events where stripe_event_id='evt_t31_retry')<>'needs_review' then
    raise exception 'Stripe retry after rolled back database failure did not process: %',r;
  end if;

  r := pg_temp.t31_apply_event('evt_t31_failure','checkout.session.async_payment_failed','failed',
    '00000000-0000-4000-8000-000000000319','00000000-0000-4000-8000-000000000320',
    'complete','unpaid',100,'jpy','00000000-0000-4000-8000-000000000319','pi_t31_319','requires_payment_method',0,'jpy','00000000-0000-4000-8000-000000000319');
  if r->>'status'<>'processed' or (select status from public.orders where id='00000000-0000-4000-8000-000000000319')<>'payment_failed'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000319')<>'released'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000310')<>4 then
    raise exception 'definitive async failure did not release allocation: %',r;
  end if;
  r := pg_temp.t31_apply_event('evt_t31_expiry','checkout.session.expired','expired',
    '00000000-0000-4000-8000-000000000321','00000000-0000-4000-8000-000000000322',
    'expired','unpaid',100,'jpy','00000000-0000-4000-8000-000000000321',null,null,null,null,null);
  if r->>'status'<>'processed' or (select status from public.orders where id='00000000-0000-4000-8000-000000000321')<>'expired'
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000321')<>'released'
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000310')<>3 then
    raise exception 'expired Checkout Session did not release allocation: %',r;
  end if;

  r := public.ignore_stripe_webhook_event('evt_t31_unsupported','customer.updated');
  if r->>'status'<>'ignored' or (select outcome from public.payment_events where stripe_event_id='evt_t31_unsupported')<>'ignored' then
    raise exception 'signed unsupported event was not logged as ignored: %',r;
  end if;
  r := public.ignore_stripe_webhook_event('evt_t31_unsupported','customer.updated');
  if r->>'status'<>'duplicate' then raise exception 'ignored event retry was not deduplicated: %',r; end if;

  if (select count(*) from public.payment_events where outcome is null)<>0 then
    raise exception 'a committed webhook event has no final outcome';
  end if;
end $$;

rollback;
