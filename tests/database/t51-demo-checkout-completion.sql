\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000511','authenticated','authenticated',true,now(),now()),
 ('00000000-0000-4000-8000-000000000512','authenticated','authenticated',true,now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,building,is_default) values
 ('00000000-0000-4000-8000-000000000513','00000000-0000-4000-8000-000000000511','デモ購入者','0000000',13,'架空市','デモ専用1番地',null,false);
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ('00000000-0000-4000-8000-000000000514',(select id from public.categories where slug='cpu'),
  't51-demo-checkout','T51-DEMO','T51 Demo CPU','T51 Labs','fixture','fixture',1000,1000,'draft',500,300,200,100);
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
values ('00000000-0000-4000-8000-000000000514','AM5',4,3000,65);
insert into public.product_images(product_id,storage_path,alt_text)
values ('00000000-0000-4000-8000-000000000514','t51/t51-demo-checkout.png','T51 fictional demo checkout fixture');
update public.products set status='published' where id='00000000-0000-4000-8000-000000000514';
insert into public.inventory(product_id,on_hand,allocated)
values ('00000000-0000-4000-8000-000000000514',3,0);
insert into public.carts(user_id) values ('00000000-0000-4000-8000-000000000511');
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
select id,'00000000-0000-4000-8000-000000000514',1,1000 from public.carts where user_id='00000000-0000-4000-8000-000000000511';
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
  shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
select '00000000-0000-4000-8000-000000000515','00000000-0000-4000-8000-000000000511',
  '00000000-0000-4000-8000-000000000513',
  '[{"productId":"00000000-0000-4000-8000-000000000514","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]'::jsonb,
  1000,940,0,176,1940,version from public.shipping_settings where is_active limit 1;

do $$ begin
  if has_function_privilege('anon','public.complete_demo_checkout(uuid,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.complete_demo_checkout(uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'browser roles may execute the demo completion RPC';
  end if;
  if not has_function_privilege('service_role','public.complete_demo_checkout(uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'service_role cannot execute the demo completion RPC';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
  begin
    perform public.complete_demo_checkout('00000000-0000-4000-8000-000000000511',
      '00000000-0000-4000-8000-000000000515',null);
    raise exception 'authenticated member executed service-only demo completion';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  v_version text;
  v_snapshot jsonb;
  v_result jsonb;
  v_cart_id uuid;
begin
  select version into v_version from public.shipping_settings where is_active limit 1;
  v_snapshot := jsonb_build_object(
    'address',jsonb_build_object('id','00000000-0000-4000-8000-000000000513','recipientName','デモ購入者',
      'postalCode','0000000','prefectureCode',13,'city','架空市','street','デモ専用1番地','building',null,'isDefault',false),
    'items',jsonb_build_array(jsonb_build_object('productId','00000000-0000-4000-8000-000000000514',
      'sku','T51-DEMO','name','T51 Demo CPU','brand','T51 Labs','category','cpu','quantity',1,
      'unitPriceYen',1000,'lineTotalYen',1000,'weightG',500,'packLengthMm',300,'packWidthMm',200,
      'packHeightMm',100,'specs',jsonb_build_object('socket_code','AM5'))),
    'goodsTotalYen',1000,'shipping',jsonb_build_object('baseYen',940,'heavyYen',0,'totalYen',940),
    'taxTotalYen',176,'grandTotalYen',1940,'shippingSettingsVersion',v_version,'compatibility','[]'::jsonb);

  v_result := public.complete_demo_checkout('00000000-0000-4000-8000-000000000511',
    '00000000-0000-4000-8000-000000000515',v_snapshot);
  if v_result->>'status' <> 'completed' then raise exception 'demo completion failed: %',v_result; end if;
  if not exists(select 1 from public.checkout_quotes where id='00000000-0000-4000-8000-000000000515' and demo_completed_at is not null) then
    raise exception 'demo quote completion marker missing';
  end if;
  if exists(select 1 from public.cart_items ci join public.carts c on c.id=ci.cart_id where c.user_id='00000000-0000-4000-8000-000000000511') then
    raise exception 'demo completion did not clear the cart';
  end if;
  if exists(select 1 from public.orders where checkout_quote_id='00000000-0000-4000-8000-000000000515')
     or exists(select 1 from public.payment_attempts pa join public.orders o on o.id=pa.order_id where o.user_id='00000000-0000-4000-8000-000000000511')
     or exists(select 1 from public.stock_allocations sa join public.orders o on o.id=sa.order_id where o.user_id='00000000-0000-4000-8000-000000000511')
     or (select allocated from public.inventory where product_id='00000000-0000-4000-8000-000000000514') <> 0 then
    raise exception 'demo completion created payment/order or changed inventory';
  end if;

  -- A replay must not delete a new cart created after the first completion.
  select id into v_cart_id from public.carts where user_id='00000000-0000-4000-8000-000000000511';
  insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
    values (v_cart_id,'00000000-0000-4000-8000-000000000514',1,1000);
  v_result := public.complete_demo_checkout('00000000-0000-4000-8000-000000000511',
    '00000000-0000-4000-8000-000000000515',null);
  if v_result->>'status' <> 'already_completed' then raise exception 'demo replay did not resolve idempotently: %',v_result; end if;
  if (select count(*) from public.cart_items where cart_id=v_cart_id) <> 1 then
    raise exception 'demo replay cleared a later cart';
  end if;

  -- The existing Stripe RPC must not consume a quote already completed by demo.
  v_result := public.create_checkout_order('00000000-0000-4000-8000-000000000511',
    '00000000-0000-4000-8000-000000000515','00000000-0000-4000-8000-000000000516',v_snapshot);
  if v_result->>'status' <> 'demo_checkout_completed' then
    raise exception 'Stripe order RPC accepted a demo-completed quote: %',v_result;
  end if;
  if exists(select 1 from public.orders where checkout_quote_id='00000000-0000-4000-8000-000000000515') then
    raise exception 'Stripe order was created for a demo-completed quote';
  end if;

  v_result := public.complete_demo_checkout('00000000-0000-4000-8000-000000000512',
    '00000000-0000-4000-8000-000000000515',null);
  if v_result->>'status' <> 'not_found' then raise exception 'another member read the quote: %',v_result; end if;
end $$;
reset role;
rollback;
