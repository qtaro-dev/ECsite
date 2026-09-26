\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000261','authenticated','authenticated','t26-member@example.test',now(),now());
do $$ begin
  if has_table_privilege('anon','public.cart_items','UPDATE') or
     has_table_privilege('authenticated','public.cart_items','UPDATE') or
     has_column_privilege('authenticated','public.cart_items','unit_price_at_add_yen','UPDATE') then
    raise exception 'browser roles can change server-owned cart reference price';
  end if;
end $$;

insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,status)
values ((select id from public.categories where slug='cpu'),'t26-reference-product','T26-P','T26 Reference Product','Maker',
  'T26 synthetic fixture','T26 synthetic fixture',1299,500,300,200,100,'draft');
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,'T26',8,3000,65 from public.products where slug='t26-reference-product';
insert into public.product_images(product_id,storage_path,alt_text)
select id,'t26-reference-product.png','T26 synthetic fixture' from public.products where slug='t26-reference-product';
update public.products set status='published' where slug='t26-reference-product';
insert into public.inventory(product_id,on_hand,allocated)
select id,4,0 from public.products where slug='t26-reference-product';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.cart_put(repeat('c',64),(select id from public.products where slug='t26-reference-product'),2);
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(repeat('c',64));
  if (current_cart#>>'{items,0,unitPriceAtAddYen}')::integer <> 1299 then
    raise exception 'cart line did not record server current price at first insertion';
  end if;
  if current_cart#>>'{items,0,name}' <> 'T26 Reference Product' or
     current_cart#>>'{items,0,availabilityState}' <> 'available' or
     current_cart#>>'{items,0,imagePath}' <> 't26-reference-product.png' then
    raise exception 'cart projection omitted owner-scoped display metadata or availability';
  end if;
end $$;
reset role;

-- A later quantity update retains the initial reference price, while the
-- projection shows the fresh product price used for the current cart total.
update public.products set price_tax_included_yen=1400 where slug='t26-reference-product';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.cart_put(repeat('c',64),(select id from public.products where slug='t26-reference-product'),3);
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(repeat('c',64));
  if (current_cart#>>'{items,0,unitPriceAtAddYen}')::integer <> 1299 or
     (current_cart#>>'{items,0,unitPriceYen}')::integer <> 1400 or
     (current_cart#>>'{items,0,lineTotalYen}')::integer <> 4200 or
     (current_cart->>'goodsTotalYen')::integer <> 4200 then
    raise exception 'quantity update changed reference price or failed to use current price';
  end if;
end $$;
reset role;

-- A member line that already exists keeps its own reference price when the
-- anonymous cart is merged, while quantities are combined atomically.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000261',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000261","role":"authenticated"}',true);
select public.cart_put(null,(select id from public.products where slug='t26-reference-product'),1);
select public.cart_merge(repeat('c',64));
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(null);
  if (current_cart#>>'{items,0,quantity}')::integer <> 4 or
     (current_cart#>>'{items,0,unitPriceAtAddYen}')::integer <> 1400 then
    raise exception 'merge did not preserve the existing member line reference price';
  end if;
end $$;
reset role;

-- Unpublished/deleted products remain visible only in the owner cart projection
-- as unavailable, with no stale price presented as current.
update public.products set status='draft',name='Private Admin Notes',brand='Private Brand',sku='PRIVATE-SKU'
where slug='t26-reference-product';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000261',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000261","role":"authenticated"}',true);
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(null);
  if current_cart#>>'{items,0,availabilityState}' is distinct from 'unavailable' or
     current_cart#>>'{items,0,name}' is distinct from '販売終了した商品' or
     current_cart#>'{items,0,slug}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,brand}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,sku}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,imagePath}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,unitPriceAtAddYen}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,unitPriceYen}' is distinct from 'null'::jsonb or
     current_cart#>'{items,0,lineTotalYen}' is distinct from 'null'::jsonb or
     (current_cart#>>'{items,0,availableQuantity}')::integer <> 0 then
    raise exception 'unavailable product leaked private metadata or was not shown generically';
  end if;
end $$;
reset role;

rollback;
