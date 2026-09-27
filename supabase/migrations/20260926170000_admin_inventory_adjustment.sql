-- T38: serialize stock adjustments, protect active allocations, and audit every
-- successful adjustment in the same transaction as the inventory change.
create or replace function public.admin_adjust_inventory(
  p_product_id uuid,
  p_delta integer,
  p_reason text,
  p_expected_version bigint,
  p_actor_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inventory public.inventory%rowtype;
  v_adjustment_id uuid;
  v_audit_id uuid;
  v_adjusted_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (select 1 from public.admin_memberships m
      where m.user_id = p_actor_id and m.revoked_at is null) then
    raise exception using errcode = '42501', message = 'active admin membership required';
  end if;
  if p_product_id is null or p_delta is null or p_delta = 0 or p_reason is null
     or char_length(btrim(p_reason)) not between 1 and 500 or p_expected_version is null
     or p_expected_version < 0 or p_actor_id is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_.:-]{1,128}$' then
    raise exception using errcode = '22023', message = 'invalid inventory adjustment';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.deleted_at is null) then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.inventory(product_id) values (p_product_id) on conflict (product_id) do nothing;
  select * into v_inventory from public.inventory i where i.product_id = p_product_id for update;

  if v_inventory.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'productId', p_product_id,
      'onHand', v_inventory.on_hand, 'allocated', v_inventory.allocated,
      'available', v_inventory.on_hand - v_inventory.allocated, 'version', v_inventory.version);
  end if;
  if p_delta < -v_inventory.on_hand then
    return jsonb_build_object('status', 'below_zero', 'productId', p_product_id,
      'onHand', v_inventory.on_hand, 'allocated', v_inventory.allocated,
      'available', v_inventory.on_hand - v_inventory.allocated, 'version', v_inventory.version);
  end if;
  if p_delta > 0 and p_delta > 2147483647 - v_inventory.on_hand then
    return jsonb_build_object('status', 'above_maximum', 'productId', p_product_id,
      'onHand', v_inventory.on_hand, 'allocated', v_inventory.allocated,
      'available', v_inventory.on_hand - v_inventory.allocated, 'version', v_inventory.version);
  end if;
  if v_inventory.on_hand + p_delta < v_inventory.allocated then
    return jsonb_build_object('status', 'below_allocated', 'productId', p_product_id,
      'onHand', v_inventory.on_hand, 'allocated', v_inventory.allocated,
      'available', v_inventory.on_hand - v_inventory.allocated, 'version', v_inventory.version);
  end if;
  update public.inventory
    set on_hand = on_hand + p_delta, version = version + 1
    where product_id = p_product_id
    returning * into v_inventory;
  insert into public.inventory_adjustments(product_id, delta, reason, actor_id)
    values (p_product_id, p_delta, btrim(p_reason), p_actor_id)
    returning id, created_at into v_adjustment_id, v_adjusted_at;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, change_summary, request_id)
    values (p_actor_id, 'admin.inventory.adjusted', 'inventory', p_product_id,
      jsonb_build_object('changed_fields', jsonb_build_array('stock_on_hand'), 'reason_code', 'stock_adjustment'),
      p_request_id)
    returning id into v_audit_id;

  return jsonb_build_object('status', 'updated', 'productId', p_product_id,
    'onHand', v_inventory.on_hand, 'allocated', v_inventory.allocated,
    'available', v_inventory.on_hand - v_inventory.allocated, 'version', v_inventory.version,
    'adjustmentId', v_adjustment_id, 'auditId', v_audit_id, 'createdAt', v_adjusted_at);
end;
$$;

revoke all on function public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text)
  to service_role;
comment on function public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text) is
  'Service-only inventory adjustment. Locks inventory, checks expected version and allocation floor, then writes inventory, adjustment history, and audit atomically.';
