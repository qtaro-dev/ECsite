-- T29: revalidate current checkout facts and atomically create order,
-- immutable snapshots, payment attempt, and stock allocations.

alter table public.orders
  add column checkout_quote_id uuid;
create index orders_checkout_quote_idx on public.orders(checkout_quote_id) where checkout_quote_id is not null;
create unique index orders_one_per_checkout_quote_idx on public.orders(checkout_quote_id) where checkout_quote_id is not null;
comment on column public.orders.checkout_quote_id is
  'Immutable quote identity retained without a foreign key so quote cleanup does not break checkout idempotency.';

create or replace function public.create_checkout_order(
  p_user_id uuid,
  p_quote_id uuid,
  p_checkout_key uuid,
  p_current_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.checkout_quotes%rowtype;
  v_order public.orders%rowtype;
  v_cart_id uuid;
  v_cart_line record;
  v_product public.products%rowtype;
  v_category_slug text;
  v_inventory public.inventory%rowtype;
  v_address public.addresses%rowtype;
  v_settings public.shipping_settings%rowtype;
  v_payload_line jsonb;
  v_quote_item jsonb;
  v_expected_lines jsonb;
  v_quote_lines jsonb;
  v_current_lines jsonb := '[]'::jsonb;
  v_differences jsonb := '[]'::jsonb;
  v_line_snapshot jsonb;
  v_specs jsonb;
  v_spec_key text;
  v_address_snapshot jsonb;
  v_origin_snapshot jsonb;
  v_compatibility jsonb;
  v_requested integer;
  v_available integer;
  v_goods integer := 0;
  v_shipping_base integer;
  v_shipping_heavy integer;
  v_shipping_total integer;
  v_tax integer;
  v_grand integer;
  v_attempt_id uuid;
  v_expiry timestamptz;
  v_found_order_id uuid;
  v_found_user_id uuid;
  v_found_quote_id uuid;
  v_found_attempt_id uuid;
  v_found_amount integer;
  v_found_expiry timestamptz;
  v_found_checkout_key uuid;
  v_changed_fields text[] := array[]::text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_user_id is null or p_quote_id is null or p_checkout_key is null
     or jsonb_typeof(p_current_snapshot) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid checkout snapshot';
  end if;

  -- Serialize duplicate submissions before checking the idempotency key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_checkout_key::text, 0));
  select o.id, o.user_id, o.checkout_quote_id, pa.id, pa.amount_yen, pa.expires_at,o.checkout_key
    into v_found_order_id, v_found_user_id, v_found_quote_id, v_found_attempt_id, v_found_amount, v_found_expiry,v_found_checkout_key
    from public.orders o
    left join public.payment_attempts pa on pa.order_id = o.id and pa.attempt_no = 1
    where o.checkout_key = p_checkout_key;
  if found then
    if v_found_user_id <> p_user_id then
      return jsonb_build_object('status','not_found');
    end if;
    if v_found_quote_id is distinct from p_quote_id then
      return jsonb_build_object('status','key_conflict','nextAction','create_new_quote');
    end if;
    return jsonb_build_object('status','already_created','orderId',v_found_order_id,
      'attemptId',v_found_attempt_id,'amountYen',v_found_amount,'expiresAt',v_found_expiry,
      'checkoutKey',v_found_checkout_key);
  end if;

  -- A quote creates at most one order even if a second browser tab submits a
  -- different checkout key. Keep this check before quote expiry/cleanup logic.
  select o.id,o.user_id,o.checkout_quote_id,pa.id,pa.amount_yen,pa.expires_at,o.checkout_key
    into v_found_order_id,v_found_user_id,v_found_quote_id,v_found_attempt_id,v_found_amount,v_found_expiry,v_found_checkout_key
    from public.orders o left join public.payment_attempts pa on pa.order_id=o.id and pa.attempt_no=1
    where o.checkout_quote_id=p_quote_id;
  if found then
    if v_found_user_id <> p_user_id then return jsonb_build_object('status','not_found'); end if;
    return jsonb_build_object('status','already_created','orderId',v_found_order_id,
      'attemptId',v_found_attempt_id,'amountYen',v_found_amount,'expiresAt',v_found_expiry,
      'checkoutKey',v_found_checkout_key);
  end if;

  select * into v_quote from public.checkout_quotes q
    where q.id = p_quote_id and q.user_id = p_user_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  -- A concurrent request may have created the order while this request waited
  -- for the quote row lock. Resolve it as an idempotent replay, never as 23505.
  select o.id,o.user_id,o.checkout_quote_id,pa.id,pa.amount_yen,pa.expires_at,o.checkout_key
    into v_found_order_id,v_found_user_id,v_found_quote_id,v_found_attempt_id,v_found_amount,v_found_expiry,v_found_checkout_key
    from public.orders o left join public.payment_attempts pa on pa.order_id=o.id and pa.attempt_no=1
    where o.checkout_quote_id=p_quote_id;
  if found then
    if v_found_user_id <> p_user_id then return jsonb_build_object('status','not_found'); end if;
    return jsonb_build_object('status','already_created','orderId',v_found_order_id,
      'attemptId',v_found_attempt_id,'amountYen',v_found_amount,'expiresAt',v_found_expiry,
      'checkoutKey',v_found_checkout_key);
  end if;
  if v_quote.expires_at <= pg_catalog.clock_timestamp() then
    return jsonb_build_object('status','quote_expired','nextAction','create_new_quote');
  end if;
  if jsonb_typeof(p_current_snapshot->'items') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid checkout snapshot';
  end if;
  if jsonb_array_length(p_current_snapshot->'items') = 0 then
    raise exception using errcode = '22023', message = 'invalid checkout snapshot';
  end if;

  select c.id into v_cart_id from public.carts c where c.user_id = p_user_id for update;
  if not found then return jsonb_build_object('status','cart_changed','nextAction','review_cart'); end if;
  perform 1 from public.cart_items ci where ci.cart_id = v_cart_id order by ci.product_id for update;
  select coalesce(jsonb_agg(jsonb_build_object('productId',x.product_id,'quantity',x.quantity)
      order by x.product_id),'[]'::jsonb)
    into v_expected_lines from public.cart_items x where x.cart_id = v_cart_id;
  select coalesce(jsonb_agg(jsonb_build_object('productId',x->>'productId','quantity',(x->>'quantity')::integer)
      order by x->>'productId'),'[]'::jsonb)
    into v_quote_lines from jsonb_array_elements(p_current_snapshot->'items') x;
  if v_expected_lines is distinct from v_quote_lines then
    return jsonb_build_object('status','cart_changed','nextAction','review_cart');
  end if;

  select * into v_address from public.addresses a
    where a.id = v_quote.address_id and a.user_id = p_user_id for share;
  if not found then return jsonb_build_object('status','address_unavailable','nextAction','select_address'); end if;
  v_address_snapshot := jsonb_build_object(
    'id',v_address.id,'recipientName',v_address.recipient_name,'postalCode',v_address.postal_code,
    'prefectureCode',v_address.prefecture_code,'city',v_address.city,'street',v_address.street,
    'building',v_address.building,'isDefault',v_address.is_default
  );
  if p_current_snapshot->'address' is distinct from v_address_snapshot then
    return jsonb_build_object('status','address_changed','nextAction','create_new_quote');
  end if;

  v_goods := 0;
  for v_cart_line in
    select ci.product_id,ci.quantity,ci.unit_price_at_add_yen
      from public.cart_items ci where ci.cart_id = v_cart_id order by ci.product_id
  loop
    select p.* into v_product from public.products p where p.id = v_cart_line.product_id for share;
    if not found or v_product.status <> 'published' or v_product.deleted_at is not null
       or v_product.price_tax_included_yen is null or v_product.tax_rate_basis_points <> 1000 then
      return jsonb_build_object('status','product_unavailable','productId',v_cart_line.product_id,
        'nextAction','review_cart');
    end if;
    select c.slug into v_category_slug from public.categories c where c.id = v_product.category_id;
    v_quote_item := null;
    select x into v_quote_item from jsonb_array_elements(v_quote.items_snapshot) x
      where x->>'productId'=v_product.id::text;
    if v_quote_item is null then
      v_differences := v_differences || jsonb_build_array(jsonb_build_object(
        'field','product_added','productId',v_product.id,'name',v_product.name,
        'quotedQuantity',0,'currentQuantity',v_cart_line.quantity,
        'quotedYen',0,'currentYen',v_product.price_tax_included_yen));
    else
      if (v_quote_item->>'quantity')::integer <> v_cart_line.quantity then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object(
          'field','quantity','productId',v_product.id,'name',v_product.name,
          'quotedQuantity',(v_quote_item->>'quantity')::integer,'currentQuantity',v_cart_line.quantity));
      end if;
      if (v_quote_item->>'unitPriceYen')::integer <> v_product.price_tax_included_yen then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object(
          'field','price','productId',v_product.id,'name',v_product.name,
          'quotedYen',(v_quote_item->>'unitPriceYen')::integer,'currentYen',v_product.price_tax_included_yen));
      end if;
    end if;
    v_specs := '{}'::jsonb;
    case v_category_slug
      when 'cpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cpu_specs s where s.product_id=v_product.id for share;
      when 'gpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.gpu_specs s where s.product_id=v_product.id for share;
      when 'motherboard' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.motherboard_specs s where s.product_id=v_product.id for share;
      when 'memory' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.memory_specs s where s.product_id=v_product.id for share;
      when 'ssd' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.ssd_specs s where s.product_id=v_product.id for share;
      when 'power-supply' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.psu_specs s where s.product_id=v_product.id for share;
      when 'pc-case' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.case_specs s where s.product_id=v_product.id for share;
      when 'cpu-cooler' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cooler_specs s where s.product_id=v_product.id for share;
      else return jsonb_build_object('status','product_unavailable','productId',v_cart_line.product_id,'nextAction','review_cart');
    end case;
    v_specs := coalesce(v_specs,'{}'::jsonb);

    v_payload_line := null;
    select x into v_payload_line from jsonb_array_elements(p_current_snapshot->'items') x
      where x->>'productId'=v_product.id::text;
    if v_payload_line is null
       or v_payload_line->>'sku' is distinct from v_product.sku
       or v_payload_line->>'name' is distinct from v_product.name
       or v_payload_line->>'brand' is distinct from v_product.brand
       or v_payload_line->>'category' is distinct from v_category_slug
       or (v_payload_line->>'unitPriceYen')::integer is distinct from v_product.price_tax_included_yen
       or (v_payload_line->>'quantity')::integer is distinct from v_cart_line.quantity
       or v_payload_line->'weightG' is distinct from pg_catalog.to_jsonb(v_product.weight_g)
       or v_payload_line->'packLengthMm' is distinct from pg_catalog.to_jsonb(v_product.pack_length_mm)
       or v_payload_line->'packWidthMm' is distinct from pg_catalog.to_jsonb(v_product.pack_width_mm)
       or v_payload_line->'packHeightMm' is distinct from pg_catalog.to_jsonb(v_product.pack_height_mm) then
      if v_payload_line is not null and (v_payload_line->>'unitPriceYen')::integer is distinct from v_product.price_tax_included_yen then
        return jsonb_build_object('status','snapshot_stale','differences',jsonb_build_array(jsonb_build_object(
          'field','price','productId',v_product.id,'name',v_product.name,
          'quotedYen',coalesce((v_quote_item->>'unitPriceYen')::integer,(v_payload_line->>'unitPriceYen')::integer),
          'currentYen',v_product.price_tax_included_yen)),'nextAction','create_new_quote');
      end if;
      return jsonb_build_object('status','snapshot_stale','differences',jsonb_build_array(jsonb_build_object(
        'field','product_changed','productId',v_product.id,'name',v_product.name)),
        'nextAction','create_new_quote');
    end if;
    -- Only compatibility-relevant fields were read during quote calculation;
    -- all current specification fields are snapshotted from the locked DB row.
    if jsonb_typeof(v_payload_line->'specs') is distinct from 'object' then
      return jsonb_build_object('status','snapshot_stale','differences',jsonb_build_array(jsonb_build_object(
        'field','product_changed','productId',v_product.id,'name',v_product.name)),
        'nextAction','create_new_quote');
    end if;
    for v_spec_key in select key from jsonb_each(v_payload_line->'specs') loop
      if (v_specs->v_spec_key) is distinct from (v_payload_line->'specs'->v_spec_key) then
        return jsonb_build_object('status','snapshot_stale','differences',jsonb_build_array(jsonb_build_object(
          'field','product_changed','productId',v_product.id,'name',v_product.name)),
          'nextAction','create_new_quote');
      end if;
    end loop;

    select * into v_inventory from public.inventory i where i.product_id=v_product.id for update;
    if not found then
      return jsonb_build_object('status','stock_unavailable','items',jsonb_build_array(jsonb_build_object(
        'productId',v_product.id,'requestedQuantity',v_cart_line.quantity,'availableQuantity',0)),
        'nextAction','review_cart');
    end if;
    v_available := v_inventory.on_hand-v_inventory.allocated;
    if v_available < v_cart_line.quantity then
      return jsonb_build_object('status','stock_unavailable','items',jsonb_build_array(jsonb_build_object(
        'productId',v_product.id,'name',v_product.name,'requestedQuantity',v_cart_line.quantity,'availableQuantity',v_available)),
        'nextAction','review_cart');
    end if;
    v_goods := v_goods + v_product.price_tax_included_yen*v_cart_line.quantity;
    v_line_snapshot := jsonb_build_object(
      'productId',v_product.id,'quantity',v_cart_line.quantity,'unitPriceYen',v_product.price_tax_included_yen,
      'lineTotalYen',v_product.price_tax_included_yen*v_cart_line.quantity
    );
    v_current_lines := v_current_lines || jsonb_build_array(v_line_snapshot);
  end loop;

  for v_quote_item in select x from jsonb_array_elements(v_quote.items_snapshot) x
    where not exists (select 1 from public.cart_items ci where ci.cart_id=v_cart_id and ci.product_id=(x->>'productId')::uuid)
  loop
    v_differences := v_differences || jsonb_build_array(jsonb_build_object(
      'field','product_removed','productId',v_quote_item->>'productId',
      'quotedQuantity',(v_quote_item->>'quantity')::integer,'currentQuantity',0,
      'quotedYen',(v_quote_item->>'unitPriceYen')::integer,'currentYen',0));
  end loop;

  select * into v_settings from public.shipping_settings s where s.is_active for share;
  if not found then return jsonb_build_object('status','shipping_unavailable','nextAction','retry_later'); end if;
  if p_current_snapshot->>'shippingSettingsVersion' is distinct from v_settings.version then
    return jsonb_build_object('status','snapshot_stale','differences',jsonb_build_array(jsonb_build_object(
      'field','shipping_rule','quotedValue',p_current_snapshot->>'shippingSettingsVersion',
      'currentValue',v_settings.version)),'nextAction','create_new_quote');
  end if;
  v_shipping_base := (p_current_snapshot#>>'{shipping,baseYen}')::integer;
  v_shipping_heavy := (p_current_snapshot#>>'{shipping,heavyYen}')::integer;
  v_shipping_total := (p_current_snapshot#>>'{shipping,totalYen}')::integer;
  v_tax := (p_current_snapshot->>'taxTotalYen')::integer;
  v_grand := (p_current_snapshot->>'grandTotalYen')::integer;
  if v_shipping_base < 0 or v_shipping_heavy < 0 or v_shipping_total <> v_shipping_base+v_shipping_heavy
     or v_goods <> (p_current_snapshot->>'goodsTotalYen')::integer
     or v_grand <> v_goods+v_shipping_total
     or v_tax <> pg_catalog.floor(v_grand::numeric/11)::integer then
    raise exception 'invalid checkout totals' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'productId',x->>'productId','quantity',(x->>'quantity')::integer,
      'unitPriceYen',(x->>'unitPriceYen')::integer,'lineTotalYen',(x->>'lineTotalYen')::integer
    ) order by x->>'productId'),'[]'::jsonb)
    into v_quote_lines from jsonb_array_elements(v_quote.items_snapshot) x;
  select coalesce(jsonb_agg(jsonb_build_object(
      'productId',x->>'productId','quantity',(x->>'quantity')::integer,
      'unitPriceYen',(x->>'unitPriceYen')::integer,'lineTotalYen',(x->>'lineTotalYen')::integer
    ) order by x->>'productId'),'[]'::jsonb)
    into v_expected_lines from jsonb_array_elements(v_current_lines) x;
  if v_quote_lines is distinct from v_expected_lines then
    v_changed_fields := array_append(v_changed_fields,'items');
  end if;
  if v_quote.goods_total_yen <> v_goods then
    v_changed_fields := array_append(v_changed_fields,'goods');
    v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','goods_total',
      'quotedYen',v_quote.goods_total_yen,'currentYen',v_goods));
  end if;
  if v_quote.shipping_base_yen <> v_shipping_base or v_quote.shipping_heavy_yen <> v_shipping_heavy then
    v_changed_fields := array_append(v_changed_fields,'shipping');
    if v_quote.shipping_base_yen <> v_shipping_base then
      v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','shipping_base',
        'quotedYen',v_quote.shipping_base_yen,'currentYen',v_shipping_base));
    end if;
    if v_quote.shipping_heavy_yen <> v_shipping_heavy then
      v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','shipping_heavy',
        'quotedYen',v_quote.shipping_heavy_yen,'currentYen',v_shipping_heavy));
    end if;
  end if;
  if v_quote.tax_total_yen <> v_tax then
    v_changed_fields := array_append(v_changed_fields,'tax');
    v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','tax',
      'quotedYen',v_quote.tax_total_yen,'currentYen',v_tax));
  end if;
  if v_quote.grand_total_yen <> v_grand then
    v_changed_fields := array_append(v_changed_fields,'total');
    v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','total',
      'quotedYen',v_quote.grand_total_yen,'currentYen',v_grand));
  end if;
  if v_quote.shipping_settings_version <> v_settings.version then
    v_changed_fields := array_append(v_changed_fields,'shipping_rule');
    v_differences := v_differences || jsonb_build_array(jsonb_build_object('field','shipping_rule',
      'quotedValue',v_quote.shipping_settings_version,'currentValue',v_settings.version));
  end if;
  if p_current_snapshot->>'shippingSettingsVersion' is distinct from v_settings.version
     and not ('shipping_rule' = any(v_changed_fields)) then
    v_changed_fields := array_append(v_changed_fields,'shipping_rule');
  end if;
  if cardinality(v_changed_fields)>0 then
    return jsonb_build_object('status','quote_changed','changedFields',to_jsonb(v_changed_fields),
      'differences',v_differences,
      'quotedTotals',jsonb_build_object('goodsTotalYen',v_quote.goods_total_yen,
        'shippingBaseYen',v_quote.shipping_base_yen,'shippingHeavyYen',v_quote.shipping_heavy_yen,
        'taxTotalYen',v_quote.tax_total_yen,'grandTotalYen',v_quote.grand_total_yen),
      'currentTotals',jsonb_build_object('goodsTotalYen',v_goods,'shippingBaseYen',v_shipping_base,
        'shippingHeavyYen',v_shipping_heavy,'taxTotalYen',v_tax,'grandTotalYen',v_grand),
      'nextAction','create_new_quote');
  end if;

  v_expiry := pg_catalog.clock_timestamp()+interval '30 minutes';
  v_origin_snapshot := jsonb_build_object('prefectureCode',v_settings.origin_prefecture_code,
    'shippingSettingsVersion',v_settings.version,'shippingSourceUrl',v_settings.yamato_source_url,
    'shippingSourceCheckedAt',v_settings.source_checked_at);
  v_compatibility := coalesce(p_current_snapshot->'compatibility','[]'::jsonb);
  insert into public.orders(user_id,status,currency,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
    shipping_total_yen,tax_total_yen,grand_total_yen,tax_rate_basis_points,shipping_rule_version,
    origin_snapshot,address_snapshot,compatibility_snapshot,checkout_key,checkout_quote_id)
  values (p_user_id,'payment_pending','JPY',v_goods,v_shipping_base,v_shipping_heavy,v_shipping_total,
    v_tax,v_grand,1000,v_settings.version,v_origin_snapshot,v_address_snapshot,
    jsonb_build_object('findings',v_compatibility),p_checkout_key,p_quote_id)
  returning * into v_order;

  for v_cart_line in
    select ci.product_id,ci.quantity from public.cart_items ci where ci.cart_id=v_cart_id order by ci.product_id
  loop
    select p.* into v_product from public.products p where p.id=v_cart_line.product_id;
    select c.slug into v_category_slug from public.categories c where c.id=v_product.category_id;
    case v_category_slug
      when 'cpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cpu_specs s where s.product_id=v_product.id;
      when 'gpu' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.gpu_specs s where s.product_id=v_product.id;
      when 'motherboard' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.motherboard_specs s where s.product_id=v_product.id;
      when 'memory' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.memory_specs s where s.product_id=v_product.id;
      when 'ssd' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.ssd_specs s where s.product_id=v_product.id;
      when 'power-supply' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.psu_specs s where s.product_id=v_product.id;
      when 'pc-case' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.case_specs s where s.product_id=v_product.id;
      when 'cpu-cooler' then select coalesce(pg_catalog.to_jsonb(s)-'product_id','{}'::jsonb) into v_specs from public.cooler_specs s where s.product_id=v_product.id;
    end case;
    v_specs := coalesce(v_specs,'{}'::jsonb);
    insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,
      quantity,line_total_yen,tax_rate_basis_points,spec_snapshot,weight_g_snapshot,pack_snapshot)
    values (v_order.id,v_product.id,v_product.sku,v_product.name,v_product.brand,v_product.price_tax_included_yen,
      v_cart_line.quantity,v_product.price_tax_included_yen*v_cart_line.quantity,1000,v_specs,v_product.weight_g,
      jsonb_build_object('lengthMm',v_product.pack_length_mm,'widthMm',v_product.pack_width_mm,'heightMm',v_product.pack_height_mm));
    update public.inventory set allocated=allocated+v_cart_line.quantity,version=version+1
      where product_id=v_product.id;
    insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
      values (v_order.id,v_product.id,v_cart_line.quantity,v_expiry);
  end loop;
  insert into public.payment_attempts(order_id,attempt_no,state,amount_yen,expires_at)
    values (v_order.id,1,'created',v_grand,v_expiry) returning id into v_attempt_id;

  return jsonb_build_object('status','created','orderId',v_order.id,'attemptId',v_attempt_id,
    'amountYen',v_grand,'expiresAt',v_expiry,'checkoutKey',p_checkout_key);
end;
$$;

revoke all on function public.create_checkout_order(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_checkout_order(uuid,uuid,uuid,jsonb) to service_role;
comment on function public.create_checkout_order(uuid,uuid,uuid,jsonb) is
  'Service-only atomic checkout order creation. Revalidates quote, member cart, address, published products, prices, shipping version, and stock; writes immutable snapshots and 30-minute allocations/payment attempt.';
