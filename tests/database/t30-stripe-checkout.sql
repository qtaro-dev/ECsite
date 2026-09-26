\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000301','authenticated','authenticated','t30-member@example.test',now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ('00000000-0000-4000-8000-000000000302',(select id from public.categories where slug='cpu'),
  't30-stripe-fixture','T30-CPU','T30 Stripe fixture','T30 Labs','fixture','fixture',100,1000,'draft',500,300,200,100);
insert into public.inventory(product_id,on_hand,allocated)
values ('00000000-0000-4000-8000-000000000302',5,3);
insert into public.orders(id,user_id,status,currency,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
  shipping_total_yen,tax_total_yen,grand_total_yen,tax_rate_basis_points,shipping_rule_version,
  origin_snapshot,address_snapshot,checkout_key)
values
 ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000301','payment_pending','JPY',100,0,0,0,9,100,1000,'t30-fixture','{}','{}','00000000-0000-4000-8000-000000000313'),
 ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000301','payment_pending','JPY',100,0,0,0,9,100,1000,'t30-fixture','{}','{}','00000000-0000-4000-8000-000000000314'),
 ('00000000-0000-4000-8000-000000000308','00000000-0000-4000-8000-000000000301','payment_pending','JPY',100,0,0,0,9,100,1000,'t30-fixture','{}','{}','00000000-0000-4000-8000-000000000315');
insert into public.payment_attempts(id,order_id,attempt_no,state,amount_yen,expires_at)
values
 ('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000303',1,'created',100,now()+interval '35 minutes'),
 ('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000304',1,'created',100,now()+interval '35 minutes'),
 ('00000000-0000-4000-8000-000000000307','00000000-0000-4000-8000-000000000308',1,'created',100,now()+interval '35 minutes');
insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
values
 ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000302',1,now()+interval '35 minutes'),
 ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000302',1,now()+interval '35 minutes'),
 ('00000000-0000-4000-8000-000000000308','00000000-0000-4000-8000-000000000302',1,now()+interval '35 minutes');

do $$ begin
  if has_function_privilege('anon','public.checkout_session_record(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.checkout_session_record(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.checkout_session_creation_failed(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.checkout_session_creation_failed(uuid,uuid,text)','EXECUTE') then
    raise exception 'browser roles may execute T30 service-only RPCs';
  end if;
  if has_function_privilege('anon','public.checkout_session_prepare(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.checkout_session_prepare(uuid,uuid,text)','EXECUTE') then
    raise exception 'browser roles may execute T30 prepare RPC';
  end if;
  if not has_function_privilege('service_role','public.checkout_session_prepare(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.checkout_session_record(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.checkout_session_creation_failed(uuid,uuid,text)','EXECUTE') then
    raise exception 'service_role cannot execute T30 checkout RPCs';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.checkout_session_prepare('00000000-0000-4000-8000-000000000303',
      '00000000-0000-4000-8000-000000000305','https://shop.example.test');
    raise exception 'authenticated member executed service-only prepare RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.checkout_session_record('00000000-0000-4000-8000-000000000303',
      '00000000-0000-4000-8000-000000000305','cs_test_t30_forbidden');
    raise exception 'authenticated member executed service-only session RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000304',
      '00000000-0000-4000-8000-000000000306','stripe_rejected');
    raise exception 'authenticated member executed service-only release RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ declare r jsonb; v_expiry bigint; begin
  r := public.checkout_session_prepare('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','https://shop.example.test');
  if r->>'status'<>'prepared' then raise exception 'Session parameters were not frozen: %',r; end if;
  v_expiry := (r->>'expiresAtEpochSeconds')::bigint;
  perform pg_catalog.pg_sleep(1);
  r := public.checkout_session_prepare('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','https://shop.example.test');
  if r->>'status'<>'already_prepared' or (r->>'expiresAtEpochSeconds')::bigint<>v_expiry
     or r->>'siteOrigin'<>'https://shop.example.test' then
    raise exception 'retry changed the frozen Stripe parameters: %',r;
  end if;
  r := public.checkout_session_prepare('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','https://other.example.test');
  if r->>'status'<>'parameters_conflict' then raise exception 'changed return origin was accepted: %',r; end if;

  r := public.checkout_session_record('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','cs_test_t30_session_a');
  if r->>'status'<>'stored' then raise exception 'Session id was not stored: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','cs_test_t30_session_a');
  if r->>'status'<>'already_stored' then raise exception 'same Session retry was not idempotent: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','cs_test_t30_session_b');
  if r->>'status'<>'session_conflict' then raise exception 'different Session id was accepted: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','cs_live_t30_forbidden');
  if r->>'status'<>'invalid_session_id' then raise exception 'live Session id was accepted: %',r; end if;
  if (select state from public.payment_attempts where id='00000000-0000-4000-8000-000000000305')<>'processing'
     or (select stripe_session_id from public.payment_attempts where id='00000000-0000-4000-8000-000000000305')<>'cs_test_t30_session_a' then
    raise exception 'Session persistence and processing transition were not atomic';
  end if;
  r := public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','stripe_rejected');
  if r->>'status'<>'session_exists' then raise exception 'release was allowed after Session persistence: %',r; end if;
  if (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000302')<>3
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000303')<>'active' then
    raise exception 'refused release changed inventory';
  end if;
  update public.payment_attempts set stripe_session_expires_at=pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-1
    where id='00000000-0000-4000-8000-000000000305';
  r := public.checkout_session_prepare('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','https://shop.example.test');
  if r->>'status'<>'session_expired' then raise exception 'expired Session replay was not blocked: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','cs_test_t30_session_a');
  if r->>'status'<>'session_expired' then raise exception 'expired Session id was stored or replayed: %',r; end if;

  r := public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000304',
    '00000000-0000-4000-8000-000000000306','stripe_rejected');
  if r->>'status'<>'released' then raise exception 'definitive failure did not release allocation: %',r; end if;
  if (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000302')<>2
     or (select state from public.stock_allocations where order_id='00000000-0000-4000-8000-000000000304')<>'released'
     or (select state from public.payment_attempts where id='00000000-0000-4000-8000-000000000306')<>'failed'
     or (select status from public.orders where id='00000000-0000-4000-8000-000000000304')<>'payment_failed' then
    raise exception 'failure state and inventory release were not atomic';
  end if;
  r := public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000304',
    '00000000-0000-4000-8000-000000000306','stripe_rejected');
  if r->>'status'<>'already_released' then raise exception 'release retry was not idempotent: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000304',
    '00000000-0000-4000-8000-000000000306','cs_test_t30_released_order');
  if r->>'status'<>'not_pending' then raise exception 'released order accepted Session persistence: %',r; end if;

  update public.payment_attempts set expires_at=now()-interval '1 second'
    where id='00000000-0000-4000-8000-000000000307';
  r := public.checkout_session_prepare('00000000-0000-4000-8000-000000000308',
    '00000000-0000-4000-8000-000000000307','https://shop.example.test');
  if r->>'status'<>'allocation_window_elapsed' then raise exception 'expired allocation was prepared for Stripe: %',r; end if;
  r := public.checkout_session_record('00000000-0000-4000-8000-000000000308',
    '00000000-0000-4000-8000-000000000307','cs_test_t30_too_late');
  if r->>'status'<>'allocation_elapsed' then raise exception 'late Session response was persisted: %',r; end if;
  r := public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000308',
    '00000000-0000-4000-8000-000000000307','allocation_window_elapsed');
  if r->>'status'<>'released' then raise exception 'elapsed allocation compensation did not release: %',r; end if;
  if (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000302')<>1
     or (select stripe_session_id from public.payment_attempts where id='00000000-0000-4000-8000-000000000307') is not null then
    raise exception 'late Session response changed stock or persisted an id';
  end if;
  r := public.checkout_session_creation_failed('00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000305','invented_code');
  if r->>'status'<>'not_pending' then raise exception 'unknown failure code was accepted: %',r; end if;
end $$;
reset role;

rollback;
