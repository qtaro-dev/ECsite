\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000291','authenticated','authenticated','t29-member-a@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000292','authenticated','authenticated','t29-member-b@example.test',now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,is_default) values
 ('00000000-0000-4000-8000-000000000293','00000000-0000-4000-8000-000000000291','T29 A','1000001',13,'千代田区','1-1',false),
 ('00000000-0000-4000-8000-000000000294','00000000-0000-4000-8000-000000000292','T29 B','1000002',13,'千代田区','2-2',false);
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ('00000000-0000-4000-8000-000000000295',(select id from public.categories where slug='cpu'),
  't29-atomic-cpu','T29-CPU','T29 Atomic CPU','T29 Labs','fixture','fixture',9000,1000,'draft',500,300,200,100);
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
values ('00000000-0000-4000-8000-000000000295','AM5',8,3600,65);
insert into public.product_images(product_id,storage_path,alt_text)
values ('00000000-0000-4000-8000-000000000295','t29/t29-atomic-cpu.png','T29 synthetic atomic checkout fixture');
update public.products set status='published' where id='00000000-0000-4000-8000-000000000295';
insert into public.inventory(product_id,on_hand,allocated)
values ('00000000-0000-4000-8000-000000000295',3,0);
insert into public.carts(user_id) values
 ('00000000-0000-4000-8000-000000000291'),('00000000-0000-4000-8000-000000000292');
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
select c.id,'00000000-0000-4000-8000-000000000295',1,8000 from public.carts c where c.user_id in
 ('00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000292');

insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
  shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
values
 ('00000000-0000-4000-8000-000000000296','00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000293',
  '[{"productId":"00000000-0000-4000-8000-000000000295","quantity":1,"unitPriceYen":9000,"lineTotalYen":9000}]',9000,940,0,903,9940,'initial-v1'),
 ('00000000-0000-4000-8000-000000000297','00000000-0000-4000-8000-000000000292','00000000-0000-4000-8000-000000000294',
  '[{"productId":"00000000-0000-4000-8000-000000000295","quantity":1,"unitPriceYen":9000,"lineTotalYen":9000}]',9000,940,0,903,9940,'initial-v1');

do $$ begin
  if has_function_privilege('anon','public.create_checkout_order(uuid,uuid,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.create_checkout_order(uuid,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'browser roles may execute the atomic order RPC';
  end if;
  if not has_function_privilege('service_role','public.create_checkout_order(uuid,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'service_role cannot execute the atomic order RPC';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000291',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000291","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.create_checkout_order('00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
      '00000000-0000-4000-8000-000000000298','{}'::jsonb);
    raise exception 'authenticated member executed service-only RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Force a late write failure and verify the RPC's order/stock writes roll back together.
create function public.t29_reject_payment_attempt() returns trigger
language plpgsql as $$ begin
  if current_setting('t29.fail_payment_attempt',true) = 'on' then
    raise exception 'T29 injected payment-attempt failure';
  end if;
  return new;
end $$;
create trigger t29_reject_payment_attempt before insert on public.payment_attempts
for each row execute function public.t29_reject_payment_attempt();

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('t29.fail_payment_attempt','on',true);
do $$ begin
  begin
    perform public.create_checkout_order(
      '00000000-0000-4000-8000-000000000292','00000000-0000-4000-8000-000000000297',
      '00000000-0000-4000-8000-000000000302',
      '{"address":{"id":"00000000-0000-4000-8000-000000000294","recipientName":"T29 B","postalCode":"1000002","prefectureCode":13,"city":"千代田区","street":"2-2","building":null,"isDefault":false},"items":[{"productId":"00000000-0000-4000-8000-000000000295","sku":"T29-CPU","name":"T29 Atomic CPU","brand":"T29 Labs","category":"cpu","quantity":1,"unitPriceYen":9000,"lineTotalYen":9000,"weightG":500,"packLengthMm":300,"packWidthMm":200,"packHeightMm":100,"specs":{"socket_code":"AM5"}}],"goodsTotalYen":9000,"shipping":{"baseYen":940,"heavyYen":0,"totalYen":940},"taxTotalYen":903,"grandTotalYen":9940,"shippingSettingsVersion":"initial-v1","compatibility":[]}'::jsonb);
    raise exception 'T29 injected write failure did not fire';
  exception when others then
    if sqlerrm = 'T29 injected write failure did not fire' then raise; end if;
    if sqlerrm <> 'T29 injected payment-attempt failure' then raise; end if;
  end;
  if exists(select 1 from public.orders where checkout_quote_id='00000000-0000-4000-8000-000000000297')
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000295') <> 1
     or exists(select 1 from public.payment_attempts pa join public.orders o on o.id=pa.order_id
       where o.checkout_quote_id='00000000-0000-4000-8000-000000000297') then
    raise exception 'failed RPC left partial order, payment, or stock allocation writes';
  end if;
end $$;
select set_config('t29.fail_payment_attempt','off',true);
do $$ declare r jsonb; replay jsonb; different_key jsonb; begin
  r := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
    '00000000-0000-4000-8000-000000000298',
    '{"address":{"id":"00000000-0000-4000-8000-000000000293","recipientName":"T29 A","postalCode":"1000001","prefectureCode":13,"city":"千代田区","street":"1-1","building":null,"isDefault":false},"items":[{"productId":"00000000-0000-4000-8000-000000000295","sku":"T29-CPU","name":"T29 Atomic CPU","brand":"T29 Labs","category":"cpu","quantity":1,"unitPriceYen":9000,"lineTotalYen":9000,"weightG":500,"packLengthMm":300,"packWidthMm":200,"packHeightMm":100,"specs":{"socket_code":"AM5"}}],"goodsTotalYen":9000,"shipping":{"baseYen":940,"heavyYen":0,"totalYen":940},"taxTotalYen":903,"grandTotalYen":9940,"shippingSettingsVersion":"initial-v1","compatibility":[]}'::jsonb);
  if r->>'status' <> 'created' or (r->>'amountYen')::integer <> 9940 then
    raise exception 'valid checkout was not atomically created: %',r;
  end if;
  if (select unit_price_yen from public.order_items where order_id=(r->>'orderId')::uuid) <> 9000
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000295') <> 1
     or (select amount_yen from public.payment_attempts where order_id=(r->>'orderId')::uuid) <> 9940
     or not exists(select 1 from public.stock_allocations where order_id=(r->>'orderId')::uuid
       and state='active' and expires_at between now()+interval '29 minutes' and now()+interval '31 minutes') then
    raise exception 'current-price snapshot, payment amount, or 30-minute stock allocation was incorrect';
  end if;
  if (select spec_snapshot->>'core_count' from public.order_items where order_id=(r->>'orderId')::uuid) <> '8' then
    raise exception 'full current product specification was not snapshotted';
  end if;
  replay := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
    '00000000-0000-4000-8000-000000000298',
    '{"address":{},"items":[],"shipping":{},"compatibility":[]}'::jsonb);
  different_key := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
    '00000000-0000-4000-8000-000000000299',
    '{"address":{},"items":[],"shipping":{},"compatibility":[]}'::jsonb);
  if replay->>'status' <> 'already_created' or replay->>'orderId' <> r->>'orderId'
     or different_key->>'status' <> 'already_created' or different_key->>'orderId' <> r->>'orderId'
     or different_key->>'checkoutKey' <> '00000000-0000-4000-8000-000000000298' then
    raise exception 'same key or same quote retry created a second order: %, %',replay,different_key;
  end if;
  if (select count(*) from public.orders where checkout_quote_id='00000000-0000-4000-8000-000000000296') <> 1
     or (select count(*) from public.stock_allocations where order_id=(r->>'orderId')::uuid) <> 1 then
    raise exception 'idempotent retry duplicated order allocations';
  end if;
  update public.checkout_quotes set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes'
    where id='00000000-0000-4000-8000-000000000296';
  delete from public.checkout_quotes where id='00000000-0000-4000-8000-000000000296';
  replay := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
    '00000000-0000-4000-8000-000000000298','{}'::jsonb);
  different_key := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000291','00000000-0000-4000-8000-000000000296',
    '00000000-0000-4000-8000-000000000299','{}'::jsonb);
  if replay->>'status' <> 'already_created' or different_key->>'status' <> 'already_created'
     or replay->>'orderId' <> r->>'orderId' or different_key->>'orderId' <> r->>'orderId' then
    raise exception 'quote cleanup broke same-key/quote idempotency';
  end if;
end $$;

-- A changed current price returns old/current values and creates nothing.
update public.products set price_tax_included_yen=9500 where id='00000000-0000-4000-8000-000000000295';
do $$ declare r jsonb; begin
  r := public.create_checkout_order(
    '00000000-0000-4000-8000-000000000292','00000000-0000-4000-8000-000000000297',
    '00000000-0000-4000-8000-000000000300',
    '{"address":{"id":"00000000-0000-4000-8000-000000000294","recipientName":"T29 B","postalCode":"1000002","prefectureCode":13,"city":"千代田区","street":"2-2","building":null,"isDefault":false},"items":[{"productId":"00000000-0000-4000-8000-000000000295","sku":"T29-CPU","name":"T29 Atomic CPU","brand":"T29 Labs","category":"cpu","quantity":1,"unitPriceYen":9500,"lineTotalYen":9500,"weightG":500,"packLengthMm":300,"packWidthMm":200,"packHeightMm":100,"specs":{"socket_code":"AM5"}}],"goodsTotalYen":9500,"shipping":{"baseYen":940,"heavyYen":0,"totalYen":940},"taxTotalYen":949,"grandTotalYen":10440,"shippingSettingsVersion":"initial-v1","compatibility":[]}'::jsonb);
  if r->>'status' <> 'quote_changed' or not (r->'differences' @> '[{"field":"price","quotedYen":9000,"currentYen":9500}]'::jsonb)
     or not (r->'differences' @> '[{"field":"tax","quotedYen":903,"currentYen":949}]'::jsonb)
     or r->>'nextAction' <> 'create_new_quote' then
    raise exception 'price/tax change did not return a safe difference and re-quote action: %',r;
  end if;
  if exists(select 1 from public.orders where checkout_quote_id='00000000-0000-4000-8000-000000000297')
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000295') <> 1 then
    raise exception 'changed quote created an order or allocated stock';
  end if;
end $$;

-- A quote owned by another member is indistinguishable from an absent quote.
do $$ declare r jsonb; begin
  r := public.create_checkout_order('00000000-0000-4000-8000-000000000291',
    '00000000-0000-4000-8000-000000000297','00000000-0000-4000-8000-000000000301','{}'::jsonb);
  if r->>'status' <> 'not_found' then raise exception 'cross-member quote was disclosed: %',r; end if;
end $$;
reset role;
drop trigger t29_reject_payment_attempt on public.payment_attempts;
drop function public.t29_reject_payment_attempt();

rollback;
