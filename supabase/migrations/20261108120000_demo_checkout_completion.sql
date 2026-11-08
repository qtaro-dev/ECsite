-- Public demo checkout records only that the fictional demonstration finished.
-- It never inserts an order/payment attempt or changes inventory allocations.
alter table public.checkout_quotes
  add column demo_completed_at timestamptz;

comment on column public.checkout_quotes.demo_completed_at is
  'Short-lived, idempotent completion marker for a fictional demo checkout; does not represent an order or payment.';

-- Keep the existing Stripe transaction unchanged except for a guard immediately
-- after it has locked and loaded the quote. pg_get_functiondef lets this
-- additive migration preserve the complete, reviewed T29 implementation.
do $migration$
declare
  v_function text;
  v_anchor text := '  -- A concurrent request may have created the order while this request waited' || E'\n';
  v_guard text := '  if v_quote.demo_completed_at is not null then' || E'\n'
    || '    return jsonb_build_object(''status'',''demo_checkout_completed'');' || E'\n'
    || '  end if;' || E'\n';
  v_replaced text;
begin
  v_function := pg_catalog.pg_get_functiondef('public.create_checkout_order(uuid,uuid,uuid,jsonb)'::regprocedure);
  if position(v_anchor in v_function) = 0 then
    raise exception 'create_checkout_order lock anchor not found; refusing unsafe migration';
  end if;
  v_replaced := pg_catalog.replace(v_function, v_anchor, v_guard || v_anchor);
  if v_replaced = v_function then
    raise exception 'create_checkout_order demo guard was not installed';
  end if;
  execute v_replaced;
end;
$migration$;

create or replace function public.complete_demo_checkout(
  p_user_id uuid,
  p_quote_id uuid,
  p_current_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quote public.checkout_quotes%rowtype;
  v_cart_id uuid;
  v_line record;
  v_product public.products%rowtype;
  v_category_slug text;
  v_specs jsonb;
  v_spec_key text;
  v_inventory public.inventory%rowtype;
  v_address public.addresses%rowtype;
  v_settings public.shipping_settings%rowtype;
  v_snapshot_item jsonb;
  v_quote_lines jsonb;
  v_cart_lines jsonb;
  v_payload_lines jsonb;
  v_goods integer := 0;
  v_available integer;
  v_base integer;
  v_heavy integer;
  v_total_shipping integer;
  v_tax integer;
  v_grand integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_user_id is null or p_quote_id is null then
    raise exception using errcode = '22023', message = 'member and quote are required';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.is_anonymous is true) then
    return jsonb_build_object('status','not_found');
  end if;

  -- This row lock is shared with create_checkout_order. It serializes Stripe
  -- order creation and demo completion for the same quote.
  select * into v_quote from public.checkout_quotes q
    where q.id = p_quote_id and q.user_id = p_user_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_quote.demo_completed_at is not null then
    -- Never clear the cart on replay: the visitor may have added new products.
    return jsonb_build_object('status','already_completed');
  end if;
  if v_quote.expires_at <= pg_catalog.clock_timestamp() then
    return jsonb_build_object('status','quote_expired');
  end if;
  if exists(select 1 from public.demo_retention_queue q where q.user_id = p_user_id) then
    return jsonb_build_object('status','deletion_pending');
  end if;

  if exists(select 1 from public.orders o where o.checkout_quote_id = p_quote_id) then
    return jsonb_build_object('status','checkout_started');
  end if;
  if p_current_snapshot is null or jsonb_typeof(p_current_snapshot) is distinct from 'object' then
    return jsonb_build_object('status','cart_changed');
  end if;
  if jsonb_typeof(p_current_snapshot->'items') is distinct from 'array' then
    return jsonb_build_object('status','cart_changed');
  end if;
  if jsonb_array_length(p_current_snapshot->'items') = 0 then
    return jsonb_build_object('status','cart_changed');
  end if;

  select c.id into v_cart_id from public.carts c where c.user_id = p_user_id for update;
  if not found then return jsonb_build_object('status','cart_changed'); end if;
  perform 1 from public.cart_items ci where ci.cart_id = v_cart_id order by ci.product_id for update;

  select coalesce(jsonb_agg(jsonb_build_object('productId',ci.product_id,'quantity',ci.quantity)
      order by ci.product_id),'[]'::jsonb)
    into v_cart_lines from public.cart_items ci where ci.cart_id = v_cart_id;
  select coalesce(jsonb_agg(jsonb_build_object('productId',x->>'productId','quantity',(x->>'quantity')::integer)
      order by x->>'productId'),'[]'::jsonb)
    into v_quote_lines from jsonb_array_elements(v_quote.items_snapshot) x;
  select coalesce(jsonb_agg(jsonb_build_object('productId',x->>'productId','quantity',(x->>'quantity')::integer)
      order by x->>'productId'),'[]'::jsonb)
    into v_payload_lines from jsonb_array_elements(p_current_snapshot->'items') x;
  if v_cart_lines is distinct from v_quote_lines or v_cart_lines is distinct from v_payload_lines then
    return jsonb_build_object('status','cart_changed');
  end if;

  select * into v_address from public.addresses a
    where a.id = v_quote.address_id and a.user_id = p_user_id for share;
  if not found then return jsonb_build_object('status','address_unavailable'); end if;
  if v_address.recipient_name <> 'デモ購入者' or v_address.postal_code <> '0000000'
     or v_address.city <> '架空市' or v_address.street <> 'デモ専用1番地'
     or v_address.building is not null or v_address.prefecture_code not between 1 and 47
     or (p_current_snapshot#>>'{address,id}') is distinct from v_address.id::text
     or (p_current_snapshot#>>'{address,recipientName}') is distinct from v_address.recipient_name
     or (p_current_snapshot#>>'{address,postalCode}') is distinct from v_address.postal_code
     or ((p_current_snapshot#>>'{address,prefectureCode}')::integer) is distinct from v_address.prefecture_code
     or (p_current_snapshot#>>'{address,city}') is distinct from v_address.city
     or (p_current_snapshot#>>'{address,street}') is distinct from v_address.street
     or (p_current_snapshot#>'{address,building}') is distinct from 'null'::jsonb then
    return jsonb_build_object('status','address_changed');
  end if;

  for v_line in select ci.product_id,ci.quantity from public.cart_items ci
      where ci.cart_id = v_cart_id order by ci.product_id
  loop
    select p.* into v_product from public.products p where p.id = v_line.product_id for share;
    if not found or v_product.status <> 'published' or v_product.deleted_at is not null
       or v_product.price_tax_included_yen is null or v_product.tax_rate_basis_points <> 1000 then
      return jsonb_build_object('status','product_unavailable','productId',v_line.product_id);
    end if;
    select c.slug into v_category_slug from public.categories c where c.id = v_product.category_id;
    v_specs := '{}'::jsonb;
    case v_category_slug
      when 'cpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cpu_specs s where s.product_id=v_product.id for share;
      when 'gpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.gpu_specs s where s.product_id=v_product.id for share;
      when 'motherboard' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.motherboard_specs s where s.product_id=v_product.id for share;
      when 'memory' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.memory_specs s where s.product_id=v_product.id for share;
      when 'ssd' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.ssd_specs s where s.product_id=v_product.id for share;
      when 'hdd' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.hdd_specs s where s.product_id=v_product.id for share;
      when 'power-supply' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.psu_specs s where s.product_id=v_product.id for share;
      when 'pc-case' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.case_specs s where s.product_id=v_product.id for share;
      when 'cpu-cooler' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cooler_specs s where s.product_id=v_product.id for share;
      when 'prebuilt-pc' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.prebuilt_pc_specs s where s.product_id=v_product.id for share;
      else return jsonb_build_object('status','product_unavailable','productId',v_line.product_id);
    end case;
    v_specs := coalesce(v_specs,'{}'::jsonb);
    select x into v_snapshot_item from jsonb_array_elements(p_current_snapshot->'items') x
      where x->>'productId' = v_product.id::text;
    if v_snapshot_item is null or v_snapshot_item->>'sku' is distinct from v_product.sku
       or v_snapshot_item->>'name' is distinct from v_product.name
       or v_snapshot_item->>'brand' is distinct from v_product.brand
       or (v_snapshot_item->>'unitPriceYen')::integer is distinct from v_product.price_tax_included_yen
       or (v_snapshot_item->>'quantity')::integer is distinct from v_line.quantity
       or (v_snapshot_item->>'lineTotalYen')::integer is distinct from v_product.price_tax_included_yen*v_line.quantity
       or v_snapshot_item->'weightG' is distinct from coalesce(pg_catalog.to_jsonb(v_product.weight_g),'null'::jsonb)
       or v_snapshot_item->'packLengthMm' is distinct from coalesce(pg_catalog.to_jsonb(v_product.pack_length_mm),'null'::jsonb)
       or v_snapshot_item->'packWidthMm' is distinct from coalesce(pg_catalog.to_jsonb(v_product.pack_width_mm),'null'::jsonb)
       or v_snapshot_item->'packHeightMm' is distinct from coalesce(pg_catalog.to_jsonb(v_product.pack_height_mm),'null'::jsonb)
       or jsonb_typeof(v_snapshot_item->'specs') is distinct from 'object' then
      return jsonb_build_object('status','quote_changed');
    end if;
    for v_spec_key in select key from jsonb_each(v_snapshot_item->'specs') loop
      if (v_specs->v_spec_key) is distinct from (v_snapshot_item->'specs'->v_spec_key) then
        return jsonb_build_object('status','quote_changed');
      end if;
    end loop;

    if not exists(select 1 from jsonb_array_elements(v_quote.items_snapshot) q
      where q->>'productId' = v_product.id::text
        and (q->>'unitPriceYen')::integer = v_product.price_tax_included_yen
        and (q->>'quantity')::integer = v_line.quantity
        and (q->>'lineTotalYen')::integer = v_product.price_tax_included_yen*v_line.quantity) then
      return jsonb_build_object('status','quote_changed');
    end if;

    select * into v_inventory from public.inventory i where i.product_id = v_product.id for update;
    if not found then
      return jsonb_build_object('status','stock_unavailable','productId',v_product.id,'availableQuantity',0);
    end if;
    v_available := v_inventory.on_hand - v_inventory.allocated;
    if v_available < v_line.quantity then
      return jsonb_build_object('status','stock_unavailable','productId',v_product.id,'availableQuantity',v_available);
    end if;
    v_goods := v_goods + v_product.price_tax_included_yen*v_line.quantity;
  end loop;

  select * into v_settings from public.shipping_settings s where s.is_active for share;
  if not found then return jsonb_build_object('status','shipping_unavailable'); end if;
  if v_quote.shipping_settings_version <> v_settings.version
     or p_current_snapshot->>'shippingSettingsVersion' is distinct from v_settings.version then
    return jsonb_build_object('status','quote_changed');
  end if;

  v_base := (p_current_snapshot#>>'{shipping,baseYen}')::integer;
  v_heavy := (p_current_snapshot#>>'{shipping,heavyYen}')::integer;
  v_total_shipping := (p_current_snapshot#>>'{shipping,totalYen}')::integer;
  v_tax := (p_current_snapshot->>'taxTotalYen')::integer;
  v_grand := (p_current_snapshot->>'grandTotalYen')::integer;
  if v_base is null or v_heavy is null or v_total_shipping is null or v_tax is null or v_grand is null
     or v_base < 0 or v_heavy < 0 or v_total_shipping is distinct from v_base+v_heavy
     or v_goods is distinct from v_quote.goods_total_yen
     or v_base is distinct from v_quote.shipping_base_yen or v_heavy is distinct from v_quote.shipping_heavy_yen
     or v_tax is distinct from v_quote.tax_total_yen or v_grand is distinct from v_quote.grand_total_yen
     or v_grand is distinct from v_goods+v_total_shipping
     or v_tax is distinct from pg_catalog.floor(v_grand::numeric/11)::integer
     or ((p_current_snapshot->>'goodsTotalYen')::integer) is distinct from v_goods then
    return jsonb_build_object('status','quote_changed');
  end if;

  update public.checkout_quotes set demo_completed_at = pg_catalog.clock_timestamp()
    where id = p_quote_id and user_id = p_user_id and demo_completed_at is null;
  if not found then return jsonb_build_object('status','already_completed'); end if;
  delete from public.cart_items where cart_id = v_cart_id;
  return jsonb_build_object('status','completed');
end;
$function$;

revoke all on function public.complete_demo_checkout(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_demo_checkout(uuid,uuid,jsonb) to service_role;
comment on function public.complete_demo_checkout(uuid,uuid,jsonb) is
  'Atomically validates and completes a fictional demo quote, marks it for idempotent replay, and clears only that member cart. Never creates orders, payments, or stock allocations.';
