\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000071','authenticated','authenticated','t07-user-a@example.test',now(),now()),
  ('00000000-0000-0000-0000-000000000072','authenticated','authenticated','t07-user-b@example.test',now(),now());

insert into public.products(category_id,slug,sku,name,brand,price_tax_included_yen)
values ((select id from public.categories where slug='cpu'),'t07-product','T07-PRODUCT','Snapshot CPU','Maker',5000),
  ((select id from public.categories where slug='cpu'),'t07-audit-product','T07-AUDIT','Adjusted CPU','Maker',5000);

insert into public.inventory(product_id,on_hand,allocated)
values ((select id from public.products where slug='t07-product'),1,1);
insert into public.inventory_adjustments(product_id,delta,reason,actor_id)
select id,1,'initial-count','00000000-0000-0000-0000-000000000071' from public.products where slug='t07-audit-product';

insert into public.carts(user_id) values ('00000000-0000-0000-0000-000000000071');
insert into public.carts(anonymous_token_hash) values ('sha256-test-hash');

do $$ begin
  begin
    insert into public.inventory(product_id,on_hand,allocated)
    values ((select id from public.products where slug='t07-product'),1,2);
    raise exception 'expected allocated > on_hand to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.inventory(product_id,on_hand,allocated)
    values ((select id from public.products where slug='t07-audit-product'),-1,0);
    raise exception 'expected negative on_hand to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.carts(user_id,anonymous_token_hash)
    values ('00000000-0000-0000-0000-000000000071','both-owners');
    raise exception 'expected cart with two owners to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.carts default values;
    raise exception 'expected ownerless cart to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.carts(anonymous_token_hash) values ('sha256-test-hash');
    raise exception 'expected duplicate anonymous cart token to fail';
  exception when unique_violation then null;
  end;

  begin
    insert into public.cart_items(cart_id,product_id,quantity)
    values ((select id from public.carts where user_id='00000000-0000-0000-0000-000000000071'),
      (select id from public.products where slug='t07-product'),0);
    raise exception 'expected non-positive cart quantity to fail';
  exception when check_violation then null;
  end;
end $$;

insert into public.orders(user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
  tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
values ('00000000-0000-0000-0000-000000000071','payment_pending',5000,940,500,1440,585,6440,'t07-v1',
  '{"prefecture_code":13}'::jsonb,'{"postal_code":"1000001"}'::jsonb,'00000000-0000-0000-0000-000000000701');

insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen,
  spec_snapshot,weight_g_snapshot,pack_snapshot)
select o.id,p.id,p.sku,p.name,p.brand,5000,1,5000,'{"socket":"AM5"}'::jsonb,500,'{"length_mm":100,"width_mm":100,"height_mm":50}'::jsonb
from public.orders o cross join public.products p where o.checkout_key='00000000-0000-0000-0000-000000000701' and p.slug='t07-product';

insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
select o.id,p.id,1,now()+interval '30 minutes' from public.orders o cross join public.products p
where o.checkout_key='00000000-0000-0000-0000-000000000701' and p.slug='t07-product';

insert into public.payment_attempts(order_id,attempt_no,amount_yen,expires_at)
select id,1,6440,now()+interval '30 minutes' from public.orders where checkout_key='00000000-0000-0000-0000-000000000701';
insert into public.payment_events(stripe_event_id,event_type) values ('evt_t07_duplicate','checkout.session.completed');

do $$ begin
  begin
    insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,
      grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
    values ('00000000-0000-0000-0000-000000000071',-1,0,0,0,0,-1,'t07-v1','{}','{}',
      '00000000-0000-0000-0000-000000000704');
    raise exception 'expected negative order amount to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,
      grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
    values ('00000000-0000-0000-0000-000000000071',5000,0,0,0,454,5000,'t07-v1','{}','{}',
      '00000000-0000-0000-0000-000000000701');
    raise exception 'expected duplicate checkout key to fail';
  exception when unique_violation then null;
  end;

  begin
    insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,
      grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
    values ('00000000-0000-0000-0000-000000000071',5000,940,500,0,585,6440,'t07-v1','{}','{}',
      '00000000-0000-0000-0000-000000000702');
    raise exception 'expected inconsistent shipping total to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,
      grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
    values ('00000000-0000-0000-0000-000000000071',5000,940,500,1440,0,6440,'t07-v1','{}','{}',
      '00000000-0000-0000-0000-000000000703');
    raise exception 'expected inconsistent tax total to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.order_items(order_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen)
    values ((select id from public.orders where checkout_key='00000000-0000-0000-0000-000000000701'),'X','X','X',5000,2,5000);
    raise exception 'expected inconsistent line total to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
    select o.id,p.id,1,now()+interval '30 minutes' from public.orders o cross join public.products p
    where o.checkout_key='00000000-0000-0000-0000-000000000701' and p.slug='t07-product';
    raise exception 'expected duplicate order/product allocation to fail';
  exception when unique_violation then null;
  end;

  begin
    insert into public.payment_attempts(order_id,attempt_no,amount_yen,expires_at)
    select id,2,-1,now()+interval '30 minutes' from public.orders where checkout_key='00000000-0000-0000-0000-000000000701';
    raise exception 'expected negative payment amount to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.payment_attempts(order_id,attempt_no,amount_yen,expires_at)
    select id,1,6440,now()+interval '30 minutes' from public.orders where checkout_key='00000000-0000-0000-0000-000000000701';
    raise exception 'expected duplicate attempt number to fail';
  exception when unique_violation then null;
  end;

  begin
    insert into public.payment_attempts(order_id,attempt_no,amount_yen,expires_at)
    select id,2,6440,now()+interval '30 minutes' from public.orders where checkout_key='00000000-0000-0000-0000-000000000701';
    raise exception 'expected second open payment attempt to fail';
  exception when unique_violation then null;
  end;

  begin
    update public.orders set status='payment_pending' where checkout_key='00000000-0000-0000-0000-000000000701';
  exception when check_violation then
    raise exception 'same-state order update should be valid';
  end;

  begin
    update public.orders set status='expired' where checkout_key='00000000-0000-0000-0000-000000000701';
    update public.orders set status='paid',paid_at=now() where checkout_key='00000000-0000-0000-0000-000000000701';
    raise exception 'expected terminal order transition to fail';
  exception when check_violation then null;
  end;

  begin
    update public.payment_attempts set state='succeeded' where order_id=(select id from public.orders where checkout_key='00000000-0000-0000-0000-000000000701');
    raise exception 'expected created to succeeded direct transition to fail';
  exception when check_violation then null;
  end;

  begin
    update public.stock_allocations set state='released',resolved_at=now()
    where order_id=(select id from public.orders where checkout_key='00000000-0000-0000-0000-000000000701');
    update public.stock_allocations set state='active',resolved_at=null
    where order_id=(select id from public.orders where checkout_key='00000000-0000-0000-0000-000000000701');
    raise exception 'expected terminal allocation transition to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.payment_events(stripe_event_id,event_type) values ('evt_t07_duplicate','checkout.session.completed');
    raise exception 'expected duplicate Stripe event id to fail';
  exception when unique_violation then null;
  end;
end $$;

-- Active allocations protect stock from a hard product deletion. Once resolved,
-- the inventory projection cascades and its historical FK becomes null.
do $$ begin
  begin
    delete from public.products where slug='t07-product';
    raise exception 'expected active allocation to prevent product deletion';
  exception when check_violation then null;
  end;
end $$;
update public.stock_allocations set state='released',resolved_at=now()
where order_id=(select id from public.orders where checkout_key='00000000-0000-0000-0000-000000000701');
update public.inventory set allocated=0 where product_id=(select id from public.products where slug='t07-product');
do $$ begin
  begin
    delete from public.products where slug='t07-audit-product';
    raise exception 'expected inventory adjustment audit to prevent product deletion';
  exception when foreign_key_violation then null;
  end;
end $$;
delete from public.products where slug='t07-product';
do $$ begin
  if not exists(select 1 from public.order_items where sku_snapshot='T07-PRODUCT' and product_id is null
      and name_snapshot='Snapshot CPU' and unit_price_yen=5000 and spec_snapshot->>'socket'='AM5') then
    raise exception 'order item snapshot did not survive product deletion';
  end if;
  if not exists(select 1 from public.stock_allocations where product_id is null and state='released') then
    raise exception 'resolved allocation did not survive product deletion';
  end if;
  if not exists(select 1 from public.inventory_adjustments a join public.products p on p.id=a.product_id
      where p.slug='t07-audit-product' and a.delta=1 and a.reason='initial-count') then
    raise exception 'inventory adjustment audit lost its product reference';
  end if;
  if exists(select 1 from public.inventory where product_id=(select id from public.products where slug='t07-product')) then
    raise exception 'inventory projection was not removed with product';
  end if;
  if (select count(*) from public.payment_events where stripe_event_id='evt_t07_duplicate') <> 1 then
    raise exception 'event uniqueness check did not hold';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('inventory','carts','cart_items','orders','order_items','stock_allocations',
        'payment_attempts','payment_events','inventory_adjustments') and c.relrowsecurity) <> 9 then
    raise exception 'RLS is not enabled on every T07 table';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('inventory','carts','cart_items','orders',
      'order_items','stock_allocations','payment_attempts','payment_events','inventory_adjustments')) then
    raise exception 'T07 must leave every new table default-deny for direct access';
  end if;
end $$;

-- T10 owns member read policies. T07 is deliberately default-deny for both owners.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000071',true);
do $$ begin
  if (select count(*) from public.orders) <> 0 then raise exception 'T07 must default-deny direct order reads'; end if;
  if (select count(*) from public.order_items) <> 0 then raise exception 'T07 must default-deny direct order item reads'; end if;
  if (select count(*) from public.payment_attempts) <> 0 then raise exception 'T07 must default-deny direct payment reads'; end if;
  if (select count(*) from public.inventory) <> 0 then raise exception 'inventory is directly readable'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000072',true);
do $$ begin
  if (select count(*) from public.orders) <> 0 then raise exception 'another member can read the order'; end if;
  if (select count(*) from public.order_items) <> 0 then raise exception 'another member can read the order item'; end if;
  if (select count(*) from public.payment_attempts) <> 0 then raise exception 'another member can read the payment attempt'; end if;
end $$;

rollback;
