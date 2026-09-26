-- T26: retain the server observed unit price from the first insertion of a
-- cart line for comparison only. Current product prices remain authoritative.
alter table public.cart_items
  add column unit_price_at_add_yen integer
  constraint cart_items_unit_price_at_add_nonnegative
  check (unit_price_at_add_yen is null or unit_price_at_add_yen >= 0);

create or replace function public.cart_projection(p_cart_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with line_rows as (
    select ci.product_id, ci.quantity,
      case when p.status='published' and p.deleted_at is null then ci.unit_price_at_add_yen end as unit_price_at_add_yen,
      case when p.status='published' and p.deleted_at is null then p.price_tax_included_yen end as unit_price_yen,
      case when p.status='published' and p.deleted_at is null then coalesce(ai.available_quantity,0)::integer else 0 end as available_quantity,
      p.weight_g, p.pack_length_mm, p.pack_width_mm, p.pack_height_mm,
      case when p.status='published' and p.deleted_at is null then p.name else '販売終了した商品' end as name,
      case when p.status='published' and p.deleted_at is null then p.slug end as slug,
      case when p.status='published' and p.deleted_at is null then p.brand end as brand,
      case when p.status='published' and p.deleted_at is null then p.sku end as sku,
      (select i.storage_path from public.product_images i where i.product_id=p.id
        and p.status='published' and p.deleted_at is null order by i.sort_order,i.id limit 1) as image_path,
      case when p.id is null or p.status<>'published' or p.deleted_at is not null then 'unavailable'
        when coalesce(ai.available_quantity,0)<=0 then 'sold_out' else 'available' end as availability_state,
      case when p.status='published' and p.deleted_at is null and p.price_tax_included_yen is not null
        then (p.price_tax_included_yen::bigint * ci.quantity) end as line_total_yen
    from public.cart_items ci
    left join public.products p on p.id = ci.product_id
    left join public.available_inventory ai on ai.product_id = p.id
    where ci.cart_id = p_cart_id
  ), totals as (
    select coalesce(sum(line_total_yen), 0)::bigint as goods_total_yen,
      bool_or(weight_g >= (select heavy_threshold_g from public.shipping_settings where is_active limit 1)
        and line_total_yen is not null) as has_heavy
    from line_rows
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'productId', product_id, 'quantity', quantity, 'unitPriceYen', unit_price_yen,
      'lineTotalYen', line_total_yen, 'availableQuantity', available_quantity,
      'unitPriceAtAddYen', unit_price_at_add_yen, 'name', name, 'slug', slug,
      'brand', brand, 'sku', sku, 'imagePath', image_path, 'availabilityState', availability_state
    ) order by product_id) from line_rows), '[]'::jsonb),
    'goodsTotalYen', goods_total_yen,
    'estimatedShippingYen', case when goods_total_yen = 0 then 0
      when not exists (select 1 from public.shipping_settings where is_active) then null
      when has_heavy then null
      when goods_total_yen >= (select free_threshold_yen from public.shipping_settings where is_active limit 1) then 0
      else (select base_fee_yen from public.shipping_settings where is_active limit 1) end
  ) from totals;
$$;

create or replace function public.cart_put(p_anonymous_token_hash text, p_product_id uuid, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_cart_id uuid; v_available integer; v_price integer;
begin
  if p_quantity not between 1 and 10 then raise exception using errcode='22023', message='invalid cart quantity'; end if;
  if v_user is not null then
    insert into public.carts(user_id) values (v_user) on conflict (user_id) where user_id is not null do nothing;
    select id into v_cart_id from public.carts where user_id = v_user for update;
  else
    if p_anonymous_token_hash is null or p_anonymous_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023', message='invalid cart owner'; end if;
    insert into public.carts(anonymous_token_hash) values (p_anonymous_token_hash)
      on conflict (anonymous_token_hash) where anonymous_token_hash is not null do nothing;
    select id into v_cart_id from public.carts where anonymous_token_hash = p_anonymous_token_hash for update;
  end if;
  select coalesce(ai.available_quantity,0)::integer, p.price_tax_included_yen into v_available, v_price
    from public.products p left join public.available_inventory ai on ai.product_id=p.id
    where p.id=p_product_id and p.status='published' and p.deleted_at is null and p.price_tax_included_yen is not null;
  if not found then raise exception using errcode='P0002', message='cart product unavailable'; end if;
  if p_quantity > v_available then raise exception using errcode='P0001', message='cart stock conflict'; end if;
  insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
    values (v_cart_id,p_product_id,p_quantity,v_price)
    on conflict (cart_id,product_id) do update set quantity=excluded.quantity,updated_at=now();
  update public.carts set updated_at=now() where id=v_cart_id;
  return public.cart_projection(v_cart_id);
end;
$$;

create or replace function public.cart_merge(p_anonymous_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_member_cart uuid; v_guest_cart uuid; v_adjustments jsonb := '[]'::jsonb;
  v_item record; v_existing integer; v_available integer; v_quantity integer; v_target integer;
begin
  if v_user is null then raise exception using errcode='42501', message='member authentication required'; end if;
  if p_anonymous_token_hash is null or p_anonymous_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023', message='invalid cart owner'; end if;
  insert into public.carts(user_id) values (v_user) on conflict (user_id) where user_id is not null do nothing;
  select id into v_member_cart from public.carts where user_id=v_user for update;
  select id into v_guest_cart from public.carts where anonymous_token_hash=p_anonymous_token_hash for update;
  if v_guest_cart is null then return jsonb_build_object('cart',public.cart_projection(v_member_cart),'adjustments','[]'::jsonb); end if;
  for v_item in select product_id,quantity,unit_price_at_add_yen from public.cart_items where cart_id=v_guest_cart order by product_id loop
    select quantity into v_existing from public.cart_items where cart_id=v_member_cart and product_id=v_item.product_id for update;
    v_existing := coalesce(v_existing,0);
    select coalesce(ai.available_quantity,0)::integer into v_available
      from public.products p left join public.available_inventory ai on ai.product_id=p.id
      where p.id=v_item.product_id and p.status='published' and p.deleted_at is null and p.price_tax_included_yen is not null;
    if not found then v_target := 0;
    else v_quantity := least(v_existing + v_item.quantity,10); v_target := least(v_quantity,v_available); end if;
    if v_target > 0 then
      insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
        values(v_member_cart,v_item.product_id,v_target,v_item.unit_price_at_add_yen)
        on conflict(cart_id,product_id) do update set quantity=excluded.quantity,updated_at=now();
    else delete from public.cart_items where cart_id=v_member_cart and product_id=v_item.product_id;
    end if;
    if v_target <> v_existing + v_item.quantity then
      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object('productId',v_item.product_id,'quantity',v_target));
    end if;
  end loop;
  delete from public.carts where id=v_guest_cart;
  update public.carts set updated_at=now() where id=v_member_cart;
  return jsonb_build_object('cart',public.cart_projection(v_member_cart),'adjustments',v_adjustments);
end;
$$;

comment on column public.cart_items.unit_price_at_add_yen is
  'Server-observed reference price when this cart line was first added. Informational only; checkout must re-read the current price.';
