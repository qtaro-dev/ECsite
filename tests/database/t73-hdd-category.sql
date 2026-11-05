\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-4000-8000-000000000734','authenticated','authenticated','t73-admin@example.test',now(),now());
insert into public.admin_memberships(user_id,granted_by)
values ('00000000-0000-4000-8000-000000000734',null);

insert into storage.objects(bucket_id,name)
values ('product-images','00000000-0000-4000-8000-000000000735/00000000-0000-4000-8000-000000000737.png');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare
  fields jsonb := '{"category_slug":"hdd","slug":"t73-hdd","sku":"T73-HDD","name":"T73 HDD","brand":"T73 fixture","description":"Synthetic HDD","beginner_note":"Test fixture","price_tax_included_yen":10000,"status":"draft","weight_g":1000,"pack_length_mm":300,"pack_width_mm":200,"pack_height_mm":100}';
  specs jsonb := '{"capacity_gb":4000,"interface":"SATA","form_factor":"3.5 inch"}';
  admin_id uuid := '00000000-0000-4000-8000-000000000734';
begin
  perform public.admin_save_product('00000000-0000-4000-8000-000000000735',null,
    fields,specs,'{}','[]',admin_id,'t73-save-draft');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000735',0,
    fields || '{"status":"published"}',specs,'{}',
    '[{"storage_path":"00000000-0000-4000-8000-000000000735/00000000-0000-4000-8000-000000000737.png","alt_text":"T73 synthetic placeholder","sort_order":0}]',
    admin_id,'t73-publish-hdd');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000736',null,
    fields || '{"slug":"t73-hdd-draft","sku":"T73-HDD-DRAFT"}',specs,'{}','[]',admin_id,'t73-save-hidden-draft');
end $$;
reset role;

insert into public.inventory(product_id,on_hand) values ('00000000-0000-4000-8000-000000000735',5);

do $$ begin
  begin
    update public.products set category_id=(select id from public.categories where slug='ssd')
      where slug='t73-hdd-draft';
    raise exception 'HDD specification allowed recategorization as SSD';
  exception when check_violation then null; end;
  begin
    insert into public.hdd_specs(product_id,capacity_gb,interface,form_factor)
      select id,4000,'SATA','3.5 inch' from public.products where slug='t11-ssd';
    raise exception 'SSD accepted an HDD specification row';
  exception when check_violation then null; end;
  update public.products set status='draft' where slug='t73-hdd';
  delete from public.hdd_specs where product_id='00000000-0000-4000-8000-000000000735';
  begin
    update public.products set status='published' where slug='t73-hdd';
    raise exception 'HDD was published without its specification';
  exception when check_violation then null; end;
  insert into public.hdd_specs values ('00000000-0000-4000-8000-000000000735',4000,'SATA','3.5 inch');
  update public.products set status='published' where slug='t73-hdd';
end $$;

set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ declare catalog_result record; detail jsonb; begin
  if (select count(*) from public.hdd_specs) <> 1
    or has_table_privilege(current_user,'public.hdd_specs','INSERT')
    or has_table_privilege('authenticated','public.hdd_specs','UPDATE') then
    raise exception 'HDD RLS exposed a draft or allowed direct writes';
  end if;
  select * into catalog_result from public.search_published_products(category_slug => 'hdd',spec_filter => '{"capacity_gb":4000}');
  if catalog_result.total is distinct from 1 or catalog_result.items->0->>'slug' is distinct from 't73-hdd' then
    raise exception 'HDD search filter did not return only the published HDD';
  end if;
  select * into catalog_result from public.search_published_products(category_slug => 'ssd');
  if catalog_result.total is distinct from 1 or catalog_result.items->0->>'slug' is distinct from 't11-ssd' then
    raise exception 'SSD list changed or included an HDD';
  end if;
  detail := public.get_published_product_detail('t73-hdd');
  if detail->>'category' is distinct from 'hdd' or detail->'specifications'->>'interface' is distinct from 'SATA'
    or public.get_published_product_detail('t73-hdd-draft') is not null then
    raise exception 'HDD detail omitted specifications or exposed a draft';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000734',true);
do $$ begin
  if (select count(*) from public.hdd_specs) <> 2 then
    raise exception 'Administrator cannot read the draft HDD specifications';
  end if;
end $$;
reset role;

-- Allocate one HDD and verify that the complete HDD specifications enter the order snapshot.
insert into auth.users(id,aud,role,email,created_at,updated_at)
values ('00000000-0000-4000-8000-000000000730','authenticated','authenticated','t73@example.test',now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street)
values ('00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-000000000730','T73 Demo','1000001',13,'架空市','デモ専用');
insert into public.carts(user_id) values ('00000000-0000-4000-8000-000000000730');
do $$ declare v_product_id uuid; product_price integer; product_sku text; product_name text; specs jsonb;
  quote_id uuid := '00000000-0000-4000-8000-000000000732'; result jsonb; v_order_id uuid; tax integer;
  payload jsonb; begin
  select p.id,p.price_tax_included_yen,p.sku,p.name,to_jsonb(s)-'product_id'
    into v_product_id,product_price,product_sku,product_name,specs
    from public.products p join public.categories c on c.id=p.category_id join public.hdd_specs s on s.product_id=p.id
    where p.slug='t73-hdd';
  tax := floor(product_price::numeric/11)::integer;
  insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
    select id,v_product_id,1,product_price from public.carts where user_id='00000000-0000-4000-8000-000000000730';
  insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
    shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
  values (quote_id,'00000000-0000-4000-8000-000000000730','00000000-0000-4000-8000-000000000731',
    jsonb_build_array(jsonb_build_object('productId',v_product_id,'quantity',1,'unitPriceYen',product_price,'lineTotalYen',product_price)),
    product_price,0,0,tax,product_price,'initial-v1');
  payload := jsonb_build_object(
    'address',jsonb_build_object('id','00000000-0000-4000-8000-000000000731','recipientName','T73 Demo','postalCode','1000001',
      'prefectureCode',13,'city','架空市','street','デモ専用','building',null,'isDefault',false),
    'items',jsonb_build_array(jsonb_build_object('productId',v_product_id,'sku',product_sku,'name',product_name,
      'brand','T73 fixture','category','hdd','quantity',1,'unitPriceYen',product_price,'lineTotalYen',product_price,
      'weightG',1000,'packLengthMm',300,'packWidthMm',200,'packHeightMm',100,'specs',specs)),
    'goodsTotalYen',product_price,'shipping',jsonb_build_object('baseYen',0,'heavyYen',0,'totalYen',0),
    'taxTotalYen',tax,'grandTotalYen',product_price,'shippingSettingsVersion','initial-v1','compatibility','[]'::jsonb);
  perform set_config('request.jwt.claim.role','service_role',true);
  result := public.create_checkout_order('00000000-0000-4000-8000-000000000730',quote_id,
    '00000000-0000-4000-8000-000000000733',payload);
  if result->>'status' is distinct from 'created' then raise exception 'T73 HDD order creation failed: %',result; end if;
  v_order_id := (result->>'orderId')::uuid;
  if (select count(*) from public.order_items oi where oi.order_id=v_order_id) <> 1
     or (select oi.spec_snapshot from public.order_items oi where oi.order_id=v_order_id) is distinct from specs
     or (select allocated from public.inventory where public.inventory.product_id=v_product_id) <> 1
     or (select count(*) from public.stock_allocations sa where sa.order_id=v_order_id and sa.product_id=v_product_id and sa.state='active') <> 1 then
    raise exception 'T73 order did not snapshot the HDD specifications and allocate the HDD SKU';
  end if;
  if (select pa.expires_at from public.payment_attempts pa where pa.order_id=v_order_id)
       is distinct from (select o.created_at+interval '35 minutes' from public.orders o where o.id=v_order_id)
     or (select sa.expires_at from public.stock_allocations sa where sa.order_id=v_order_id and sa.product_id=v_product_id)
       is distinct from (select o.created_at+interval '35 minutes' from public.orders o where o.id=v_order_id) then
    raise exception 'T73 checkout function no longer aligns attempt and inventory expiry with 35-minute approved hold';
  end if;
end $$;

rollback;
