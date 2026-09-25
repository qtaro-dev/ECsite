\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000251','authenticated','authenticated','t25-a@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000252','authenticated','authenticated','t25-b@example.test',now(),now());
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,status)
values ((select id from public.categories where slug='cpu'),'t25-cart-product','T25-P','T25 Cart Product','Maker',
  'T25 synthetic fixture','T25 synthetic fixture',1299,500,300,200,100,'draft');
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,'T25',8,3000,65 from public.products where slug='t25-cart-product';
insert into public.product_images(product_id,storage_path,alt_text)
select id,'t25-cart-product.png','T25 synthetic fixture' from public.products where slug='t25-cart-product';
update public.products set status='published' where slug='t25-cart-product';
insert into public.inventory(product_id,on_hand,allocated)
select id,4,0 from public.products where slug='t25-cart-product';

-- Anonymous callers have no direct cart table or cart RPC access.
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ declare current_cart jsonb; begin
  if has_table_privilege(current_user,'public.carts','SELECT') or has_table_privilege(current_user,'public.cart_items','INSERT') then
    raise exception 'anonymous role received direct cart table access';
  end if;
  if has_function_privilege(current_user,'public.cart_get(text)','EXECUTE') or
     has_function_privilege(current_user,'public.cart_put(text,uuid,integer)','EXECUTE') or
     has_function_privilege(current_user,'public.cart_remove(text,uuid)','EXECUTE') or
     has_function_privilege(current_user,'public.cart_merge(text)','EXECUTE') then
    raise exception 'anonymous role can execute a cart RPC';
  end if;
end $$;
reset role;

-- Only the trusted server role invokes anonymous RPCs, after verifying the
-- signed HttpOnly cookie. The DB still isolates data by the derived token hash.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.cart_put(repeat('a',64),(select id from public.products where slug='t25-cart-product'),3);
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(repeat('a',64));
  if (current_cart#>>'{items,0,unitPriceYen}')::integer <> 1299 or
     (current_cart#>>'{items,0,availableQuantity}')::integer <> 4 or
     (current_cart->>'goodsTotalYen')::integer <> 3897 or
     (current_cart->>'estimatedShippingYen')::integer <> 940 then
    raise exception 'cart did not return current initial price, stock, or shipping';
  end if;
  if (public.cart_get(repeat('b',64))->>'goodsTotalYen')::integer <> 0 then raise exception 'different token read anonymous cart'; end if;
  if (public.cart_get(repeat('b',64))->>'estimatedShippingYen')::integer <> 0 then raise exception 'empty cart had nonzero estimated shipping'; end if;
  begin
    perform public.cart_put(repeat('a',64),(select id from public.products where slug='t25-cart-product'),5);
    raise exception 'out of stock cart quantity succeeded' using errcode='P9999';
  exception when sqlstate 'P0001' then null; end;
end $$;
reset role;

-- Price and available stock are fetched fresh for every read/update.
update public.products set price_tax_included_yen=1400 where slug='t25-cart-product';
update public.inventory set allocated=1 where product_id=(select id from public.products where slug='t25-cart-product');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare current_cart jsonb; begin
  current_cart := public.cart_get(repeat('a',64));
  if (current_cart#>>'{items,0,unitPriceYen}')::integer <> 1400 or
     (current_cart#>>'{items,0,availableQuantity}')::integer <> 3 or
     (current_cart->>'goodsTotalYen')::integer <> 4200 or
     (current_cart->>'estimatedShippingYen')::integer <> 940 then
    raise exception 'cart did not re-read current price, stock, or estimated base shipping';
  end if;
  begin
    perform public.cart_put(repeat('a',64),(select id from public.products where slug='t25-cart-product'),4);
    raise exception 'quantity above current stock succeeded' using errcode='P9999';
  exception when sqlstate 'P0001' then null; end;
end $$;
reset role;

-- Member cart is selected from auth.uid(), not a caller-supplied owner. Merge
-- sums duplicates, clamps to current stock, and emits an adjustment.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000251',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000251","role":"authenticated"}',true);
select public.cart_put(null,(select id from public.products where slug='t25-cart-product'),2);
do $$ declare result jsonb; begin
  result := public.cart_merge(repeat('a',64));
  if (result#>>'{cart,items,0,quantity}')::integer <> 3 then raise exception 'merge did not clamp to available stock'; end if;
  if (result#>>'{adjustments,0,quantity}')::integer <> 3 then raise exception 'merge adjustment was not returned'; end if;
  if (select count(*) from public.carts where anonymous_token_hash=repeat('a',64)) <> 0 then raise exception 'anonymous cart was not consumed'; end if;
  if not has_table_privilege(current_user,'public.carts','SELECT') then raise exception 'member self cart read privilege missing'; end if;
  if (select count(*) from public.carts where user_id='00000000-0000-4000-8000-000000000252') <> 0 then raise exception 'member read another cart'; end if;
end $$;

rollback;
