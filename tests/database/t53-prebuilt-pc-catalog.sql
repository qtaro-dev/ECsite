\set ON_ERROR_STOP on
begin;

do $$ declare result record; components jsonb; begin
  if (select array_agg(sort_order::integer order by sort_order) from public.categories where sort_order <= 8) <> array[1,2,3,4,5,6,7,8]::integer[] then
    raise exception 'T53 changed the established eight category order';
  end if;
  if (select sort_order from public.categories where slug='prebuilt-pc') <> 9 then
    raise exception 'T53 prebuilt category order is not appended';
  end if;
  if (select count(*) from public.products p join public.categories c on c.id=p.category_id
      where c.slug='prebuilt-pc' and p.status='published' and p.deleted_at is null) <> 6 then
    raise exception 'T53 must seed six published demo builds';
  end if;
  if exists(select 1 from (values ('gaming'),('daily'),('editing')) expected(use_case)
      where (select count(*) from public.product_use_cases u join public.products p on p.id=u.product_id
        join public.categories c on c.id=p.category_id
        where c.slug='prebuilt-pc' and p.status='published' and u.use_case=expected.use_case) < 2) then
    raise exception 'T53 has fewer than two prebuilt builds for a use case';
  end if;
  if exists(select 1 from public.products p join public.categories c on c.id=p.category_id
      where c.slug='prebuilt-pc' and p.status='published' and (
        not exists(select 1 from public.prebuilt_pc_specs s where s.product_id=p.id)
        or not exists(select 1 from public.product_images i where i.product_id=p.id)
        or not exists(select 1 from public.inventory i where i.product_id=p.id and i.on_hand>0 and i.allocated=0))) then
    raise exception 'T53 published build lacks configuration, placeholder, or sellable independent stock';
  end if;
  if exists(select 1 from public.prebuilt_pc_specs s join public.products p on p.id=s.product_id
      join public.categories c on c.id=p.category_id where c.slug='prebuilt-pc'
      and not (s.components ?& array['cpu','gpu','memory','ssd'])) then
    raise exception 'T53 configuration must contain CPU, GPU, memory, and SSD';
  end if;
  select * into result from public.search_published_products(category_slug => 'prebuilt-pc',usage_case => 'gaming');
  if result.total <> 2 or jsonb_array_length(result.items) <> 2
     or not (result.items->0->'specifications'->'components' ?& array['cpu','gpu','memory','ssd']) then
    raise exception 'T53 public search omitted the complete prebuilt configuration';
  end if;
  components := public.get_published_product_detail('demo-gaming-pc-01')->'specifications'->'components';
  if not (components ?& array['cpu','gpu','memory','ssd']) then
    raise exception 'T53 public detail omitted the complete prebuilt configuration';
  end if;
end $$;

-- A category row without a complete specification must not be published.
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,
  status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
select id,'t53-incomplete','T53-INCOMPLETE','T53 incomplete','T53 fixture','synthetic','synthetic',10000,
  'draft',1000,300,200,100 from public.categories where slug='prebuilt-pc';
insert into public.product_images(product_id,storage_path,alt_text)
select id,'placeholders/prebuilt-pc/t53-incomplete.svg','T53 synthetic placeholder'
from public.products where slug='t53-incomplete';
do $$ begin
  begin
    update public.products set status='published' where slug='t53-incomplete';
    raise exception 'T53 published a build without required components';
  exception when check_violation then null; end;
end $$;

set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ declare found_count integer; begin
  select count(*) into found_count from public.products p join public.categories c on c.id=p.category_id
    where c.slug='prebuilt-pc' and p.status='published';
  if found_count <> 6 then raise exception 'anon cannot read all published prebuilt products'; end if;
  if (select count(*) from public.prebuilt_pc_specs s join public.products p on p.id=s.product_id where p.status='published') <> 6 then
    raise exception 'anon cannot read published prebuilt specifications';
  end if;
  if has_table_privilege(current_user,'public.prebuilt_pc_specs','INSERT')
     or has_table_privilege(current_user,'public.prebuilt_pc_specs','UPDATE') then
    raise exception 'anon can mutate prebuilt configuration';
  end if;
end $$;
reset role;

-- Buy one complete system. Only its SKU inventory is allocated, and its complete
-- configuration is copied into the immutable order item snapshot.
insert into auth.users(id,aud,role,email,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000530','authenticated','authenticated','t53@example.test',now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street)
values ('00000000-0000-4000-8000-000000000531','00000000-0000-4000-8000-000000000530','T53 Demo','1000001',13,'架空市','デモ専用');
insert into public.carts(user_id) values ('00000000-0000-4000-8000-000000000530');
do $$ declare v_product_id uuid; product_price integer; product_sku text; product_name text; components jsonb;
  quote_id uuid := '00000000-0000-4000-8000-000000000532'; result jsonb; v_order_id uuid; tax integer;
  payload jsonb; begin
  select p.id,p.price_tax_included_yen,p.sku,p.name,s.components
    into v_product_id,product_price,product_sku,product_name,components
    from public.products p join public.categories c on c.id=p.category_id join public.prebuilt_pc_specs s on s.product_id=p.id
    where p.slug='demo-gaming-pc-01';
  tax := floor(product_price::numeric/11)::integer;
  insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
    select id,v_product_id,1,product_price from public.carts where user_id='00000000-0000-4000-8000-000000000530';
  insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
    shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
  values (quote_id,'00000000-0000-4000-8000-000000000530','00000000-0000-4000-8000-000000000531',
    jsonb_build_array(jsonb_build_object('productId',v_product_id,'quantity',1,'unitPriceYen',product_price,'lineTotalYen',product_price)),
    product_price,0,0,tax,product_price,'initial-v1');
  payload := jsonb_build_object(
    'address',jsonb_build_object('id','00000000-0000-4000-8000-000000000531','recipientName','T53 Demo','postalCode','1000001',
      'prefectureCode',13,'city','架空市','street','デモ専用','building',null,'isDefault',false),
    'items',jsonb_build_array(jsonb_build_object('productId',v_product_id,'sku',product_sku,'name',product_name,
      'brand','ECsite Demo Build','category','prebuilt-pc','quantity',1,'unitPriceYen',product_price,'lineTotalYen',product_price,
      'weightG',15000,'packLengthMm',600,'packWidthMm',250,'packHeightMm',550,'specs',jsonb_build_object('components',components))),
    'goodsTotalYen',product_price,'shipping',jsonb_build_object('baseYen',0,'heavyYen',0,'totalYen',0),
    'taxTotalYen',tax,'grandTotalYen',product_price,'shippingSettingsVersion','initial-v1','compatibility','[]'::jsonb);
  perform set_config('request.jwt.claim.role','service_role',true);
  result := public.create_checkout_order('00000000-0000-4000-8000-000000000530',quote_id,
    '00000000-0000-4000-8000-000000000533',payload);
  if result->>'status' <> 'created' then raise exception 'T53 prebuilt order creation failed: %',result; end if;
  v_order_id := (result->>'orderId')::uuid;
  if (select count(*) from public.order_items oi where oi.order_id=v_order_id) <> 1
     or (select oi.spec_snapshot->'components' from public.order_items oi where oi.order_id=v_order_id) is distinct from components
     or (select allocated from public.inventory where public.inventory.product_id=v_product_id) <> 1
     or (select count(*) from public.stock_allocations sa where sa.order_id=v_order_id and sa.product_id=v_product_id and sa.state='active') <> 1 then
    raise exception 'T53 order did not snapshot/configure and allocate only the complete system SKU';
  end if;
  if (select pa.expires_at from public.payment_attempts pa where pa.order_id=v_order_id)
       is distinct from (select o.created_at+interval '35 minutes' from public.orders o where o.id=v_order_id)
     or (select sa.expires_at from public.stock_allocations sa where sa.order_id=v_order_id and sa.product_id=v_product_id)
       is distinct from (select o.created_at+interval '35 minutes' from public.orders o where o.id=v_order_id) then
    raise exception 'T53 checkout function no longer aligns attempt and inventory expiry with 35-minute approved hold';
  end if;
end $$;

rollback;
