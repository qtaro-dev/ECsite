-- T33: clear only unchanged purchased cart lines after confirmed payment.
-- Keep this outside T31/T32's inventory transaction. Their lock order reaches
-- inventory before orders; cart deletion there would invert checkout's
-- cart -> inventory lock order and could deadlock a concurrent checkout.
create function public.clear_paid_order_cart(p_user_id uuid, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_created_at timestamptz;
  v_cart_id uuid;
  v_deleted integer;
begin
  if p_user_id is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('status','not_found');
  end if;

  -- Check the owner and persisted DB payment state, not a Stripe return URL.
  select o.created_at into v_created_at from public.orders o
    where o.id=p_order_id and o.user_id=p_user_id and o.status='paid';
  if not found then
    return pg_catalog.jsonb_build_object('status','not_found');
  end if;

  -- Serialize against checkout creation, which takes this same cart lock
  -- before it snapshots lines and allocates inventory.
  select c.id into v_cart_id from public.carts c where c.user_id=p_user_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status','unchanged');
  end if;

  -- A later order may already rely on this cart. Even a failed later order
  -- means the user has moved to a newer checkout flow; preserve their cart.
  if exists (select 1 from public.orders newer
      where newer.user_id=p_user_id and newer.id<>p_order_id
        and newer.created_at>=v_created_at) then
    return pg_catalog.jsonb_build_object('status','later_order');
  end if;

  -- The cart row lock above makes this safe against concurrent cart_put/merge.
  -- Delete only lines identical to the purchased snapshot that were untouched
  -- after order creation. New items and changed quantities remain.
  delete from public.cart_items ci using public.order_items oi
    where ci.cart_id=v_cart_id and oi.order_id=p_order_id
      and ci.product_id=oi.product_id and ci.quantity=oi.quantity
      and ci.updated_at<=v_created_at;
  get diagnostics v_deleted = row_count;
  return pg_catalog.jsonb_build_object('status',case when v_deleted>0 then 'cleared' else 'unchanged' end,
    'clearedLines',v_deleted);
end;
$$;

revoke all on function public.clear_paid_order_cart(uuid,uuid) from public, anon, authenticated;
grant execute on function public.clear_paid_order_cart(uuid,uuid) to service_role;
