-- T25: cart operations are exposed only through owner-checked RPCs. Direct
-- table writes remain revoked by T10; anonymous ownership uses a keyed token hash.

create or replace function public.cart_projection(p_cart_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with line_rows as (
    select ci.product_id, ci.quantity, p.price_tax_included_yen as unit_price_yen,
      coalesce(ai.available_quantity, 0)::integer as available_quantity,
      p.weight_g, p.pack_length_mm, p.pack_width_mm, p.pack_height_mm,
      (p.price_tax_included_yen::bigint * ci.quantity) as line_total_yen
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    left join public.available_inventory ai on ai.product_id = p.id
    where ci.cart_id = p_cart_id and p.status = 'published' and p.deleted_at is null
      and p.price_tax_included_yen is not null
  ), totals as (
    select coalesce(sum(line_total_yen), 0)::bigint as goods_total_yen,
      bool_or(weight_g >= (select heavy_threshold_g from public.shipping_settings where is_active limit 1)) as has_heavy
    from line_rows
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'productId', product_id, 'quantity', quantity, 'unitPriceYen', unit_price_yen,
      'lineTotalYen', line_total_yen, 'availableQuantity', available_quantity
    ) order by product_id) from line_rows), '[]'::jsonb),
    'goodsTotalYen', goods_total_yen,
    'estimatedShippingYen', case when goods_total_yen = 0 then 0
      when not exists (select 1 from public.shipping_settings where is_active) then null
      when has_heavy then null
      when goods_total_yen >= (select free_threshold_yen from public.shipping_settings where is_active limit 1) then 0
      else (select base_fee_yen from public.shipping_settings where is_active limit 1) end
  ) from totals;
$$;

create or replace function public.cart_get(p_anonymous_token_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_cart_id uuid;
begin
  if v_user is not null then
    insert into public.carts(user_id) values (v_user) on conflict (user_id) where user_id is not null do nothing;
    select id into v_cart_id from public.carts where user_id = v_user;
  else
    if p_anonymous_token_hash is null or p_anonymous_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023', message='invalid cart owner'; end if;
    insert into public.carts(anonymous_token_hash) values (p_anonymous_token_hash)
      on conflict (anonymous_token_hash) where anonymous_token_hash is not null do nothing;
    select id into v_cart_id from public.carts where anonymous_token_hash = p_anonymous_token_hash;
  end if;
  return public.cart_projection(v_cart_id);
end;
$$;

create or replace function public.cart_put(p_anonymous_token_hash text, p_product_id uuid, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_cart_id uuid; v_available integer;
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
  select coalesce(ai.available_quantity,0)::integer into v_available
    from public.products p left join public.available_inventory ai on ai.product_id=p.id
    where p.id=p_product_id and p.status='published' and p.deleted_at is null and p.price_tax_included_yen is not null;
  if not found then raise exception using errcode='P0002', message='cart product unavailable'; end if;
  if p_quantity > v_available then raise exception using errcode='P0001', message='cart stock conflict'; end if;
  insert into public.cart_items(cart_id,product_id,quantity) values (v_cart_id,p_product_id,p_quantity)
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
  for v_item in select product_id,quantity from public.cart_items where cart_id=v_guest_cart order by product_id loop
    select quantity into v_existing from public.cart_items where cart_id=v_member_cart and product_id=v_item.product_id for update;
    v_existing := coalesce(v_existing,0);
    select coalesce(ai.available_quantity,0)::integer into v_available
      from public.products p left join public.available_inventory ai on ai.product_id=p.id
      where p.id=v_item.product_id and p.status='published' and p.deleted_at is null and p.price_tax_included_yen is not null;
    if not found then v_target := 0;
    else v_quantity := least(v_existing + v_item.quantity,10); v_target := least(v_quantity,v_available); end if;
    if v_target > 0 then
      insert into public.cart_items(cart_id,product_id,quantity) values(v_member_cart,v_item.product_id,v_target)
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

create or replace function public.cart_remove(p_anonymous_token_hash text, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_cart_id uuid;
begin
  if v_user is not null then
    select id into v_cart_id from public.carts where user_id=v_user for update;
  else
    if p_anonymous_token_hash is null or p_anonymous_token_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023', message='invalid cart owner'; end if;
    select id into v_cart_id from public.carts where anonymous_token_hash=p_anonymous_token_hash for update;
  end if;
  if v_cart_id is not null then
    delete from public.cart_items where cart_id=v_cart_id and product_id=p_product_id;
    update public.carts set updated_at=now() where id=v_cart_id;
  end if;
  if v_cart_id is null then return public.cart_get(p_anonymous_token_hash); end if;
  return public.cart_projection(v_cart_id);
end;
$$;

revoke all on function public.cart_projection(uuid), public.cart_get(text), public.cart_put(text,uuid,integer), public.cart_merge(text), public.cart_remove(text,uuid) from public, anon, authenticated;
grant execute on function public.cart_get(text), public.cart_put(text,uuid,integer), public.cart_remove(text,uuid) to authenticated, service_role;
grant execute on function public.cart_merge(text) to authenticated;

comment on function public.cart_get(text) is 'T25 owner-scoped cart projection. Anonymous hash is derived from a signed HttpOnly cookie on the server.';
comment on function public.cart_put(text,uuid,integer) is 'T25 owner-scoped quantity replacement using current published price and available inventory.';
comment on function public.cart_merge(text) is 'T25 atomic login merge. Sums duplicates, clamps to quantity and stock, returns adjustment notices.';
comment on function public.cart_remove(text,uuid) is 'T25 owner-scoped cart item removal.';
