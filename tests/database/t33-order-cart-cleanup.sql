\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000330','authenticated','authenticated','t33-a@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000331','authenticated','authenticated','t33-b@example.test',now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
 price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm) values
 ('00000000-0000-4000-8000-000000000332',(select id from public.categories where slug='cpu'),'t33-old-product','T33-OLD','Original product','Original brand','fixture','fixture',1100,1000,'draft',500,300,200,100),
 ('00000000-0000-4000-8000-000000000333',(select id from public.categories where slug='cpu'),'t33-changed-product','T33-CHANGED','Changed product','Fixture brand','fixture','fixture',1100,1000,'draft',500,300,200,100),
 ('00000000-0000-4000-8000-000000000334',(select id from public.categories where slug='cpu'),'t33-new-product','T33-NEW','New product','Fixture brand','fixture','fixture',1100,1000,'draft',500,300,200,100);
insert into public.carts(id,user_id) values
 ('00000000-0000-4000-8000-000000000335','00000000-0000-4000-8000-000000000330'),
 ('00000000-0000-4000-8000-000000000336','00000000-0000-4000-8000-000000000331');
insert into public.cart_items(cart_id,product_id,quantity,updated_at) values
 ('00000000-0000-4000-8000-000000000335','00000000-0000-4000-8000-000000000332',1,now()-interval '2 hours'),
 ('00000000-0000-4000-8000-000000000335','00000000-0000-4000-8000-000000000333',2,now()),
 ('00000000-0000-4000-8000-000000000335','00000000-0000-4000-8000-000000000334',1,now()),
 ('00000000-0000-4000-8000-000000000336','00000000-0000-4000-8000-000000000332',1,now()-interval '2 hours');
insert into public.orders(id,user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
 shipping_total_yen,tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,
 checkout_key,created_at,paid_at) values
 ('00000000-0000-4000-8000-000000000337','00000000-0000-4000-8000-000000000330','paid',3300,0,0,0,300,3300,'t33','{}','{"recipientName":"Original recipient"}','00000000-0000-4000-8000-000000000337',now()-interval '1 hour',now()),
 ('00000000-0000-4000-8000-000000000338','00000000-0000-4000-8000-000000000331','paid',1100,0,0,0,100,1100,'t33','{}','{}','00000000-0000-4000-8000-000000000338',now()-interval '1 hour',now());
insert into public.order_items(id,order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen) values
 ('00000000-0000-4000-8000-000000000341','00000000-0000-4000-8000-000000000337','00000000-0000-4000-8000-000000000332','OLD-SKU','Original order item','Original brand',1100,1,1100),
 ('00000000-0000-4000-8000-000000000342','00000000-0000-4000-8000-000000000337','00000000-0000-4000-8000-000000000333','CHANGED-SKU','Order-time item','Original brand',1100,2,2200),
 ('00000000-0000-4000-8000-000000000343','00000000-0000-4000-8000-000000000338','00000000-0000-4000-8000-000000000332','OTHER-SKU','Other member item','Other brand',1100,1,1100);

do $$ declare r jsonb; begin
  if has_function_privilege('anon','public.clear_paid_order_cart(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.clear_paid_order_cart(uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.clear_paid_order_cart(uuid,uuid)','EXECUTE') then
    raise exception 'cart cleanup RPC grants are not service-only';
  end if;
  r := public.clear_paid_order_cart('00000000-0000-4000-8000-000000000331','00000000-0000-4000-8000-000000000337');
  if r->>'status'<>'not_found' then raise exception 'other member order exposed: %',r; end if;
  r := public.clear_paid_order_cart('00000000-0000-4000-8000-000000000330','00000000-0000-4000-8000-000000000337');
  if r->>'status'<>'cleared' or (r->>'clearedLines')::integer<>1 then
    raise exception 'original unchanged line was not cleared exactly once: %',r;
  end if;
  if exists(select 1 from public.cart_items where cart_id='00000000-0000-4000-8000-000000000335'
      and product_id='00000000-0000-4000-8000-000000000332') then
    raise exception 'purchased original line survived';
  end if;
  if (select count(*) from public.cart_items where cart_id='00000000-0000-4000-8000-000000000335')<>2
     or (select count(*) from public.cart_items where cart_id='00000000-0000-4000-8000-000000000336')<>1 then
    raise exception 'new/modified/other-member cart line was deleted';
  end if;
  r := public.clear_paid_order_cart('00000000-0000-4000-8000-000000000330','00000000-0000-4000-8000-000000000337');
  if r->>'status'<>'unchanged' or (r->>'clearedLines')::integer<>0 then raise exception 'cleanup replay changed cart: %',r; end if;
  if (select address_snapshot->>'recipientName' from public.orders where id='00000000-0000-4000-8000-000000000337')<>'Original recipient'
     or (select name_snapshot from public.order_items where id='00000000-0000-4000-8000-000000000341')<>'Original order item' then
    raise exception 'order-time snapshot changed after cleanup';
  end if;
end $$;

-- A newer checkout must protect the user's current cart, including an
-- unchanged product that otherwise matches the old paid order.
insert into public.cart_items(cart_id,product_id,quantity,updated_at)
 values ('00000000-0000-4000-8000-000000000335','00000000-0000-4000-8000-000000000332',1,now()-interval '2 hours');
insert into public.orders(id,user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
 shipping_total_yen,tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,
 checkout_key,created_at) values
 ('00000000-0000-4000-8000-000000000339','00000000-0000-4000-8000-000000000330','payment_pending',1100,0,0,0,100,1100,'t33','{}','{}','00000000-0000-4000-8000-000000000339',now());
do $$ declare r jsonb; begin
  r := public.clear_paid_order_cart('00000000-0000-4000-8000-000000000330','00000000-0000-4000-8000-000000000337');
  if r->>'status'<>'later_order' or not exists(select 1 from public.cart_items
      where cart_id='00000000-0000-4000-8000-000000000335' and product_id='00000000-0000-4000-8000-000000000332') then
    raise exception 'later checkout cart was erased: %',r;
  end if;
  r := public.clear_paid_order_cart('00000000-0000-4000-8000-000000000330','00000000-0000-4000-8000-000000000339');
  if r->>'status'<>'not_found' then raise exception 'unpaid order cleared cart: %',r; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000330',true);
do $$ begin
  if exists(select 1 from public.orders where id='00000000-0000-4000-8000-000000000338')
     or exists(select 1 from public.order_items where id='00000000-0000-4000-8000-000000000343') then
    raise exception 'other member order details exposed through RLS';
  end if;
end $$;
reset role;
rollback;
