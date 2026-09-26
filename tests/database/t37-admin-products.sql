\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000371','authenticated','authenticated','t37-admin@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000372','authenticated','authenticated','t37-member@example.test',now(),now());
insert into public.admin_memberships(user_id,granted_by)
values ('00000000-0000-4000-8000-000000000371',null);

create function pg_temp.t37_fields(
  p_category text,p_slug text,p_sku text,p_status text default 'draft',p_name text default 'T37 fixture',
  p_price integer default 1000,p_weight integer default 500,p_length integer default 100,
  p_width integer default 100,p_height integer default 100
) returns jsonb language sql immutable as $$
  select jsonb_build_object('category_slug',p_category,'slug',p_slug,'sku',p_sku,'name',p_name,
    'brand','T37 Labs','description','Synthetic T37 database fixture','beginner_note','Synthetic fixture only',
    'price_tax_included_yen',p_price,'status',p_status,'weight_g',p_weight,
    'pack_length_mm',p_length,'pack_width_mm',p_width,'pack_height_mm',p_height)
$$;

do $$ begin
  if has_function_privilege('anon','public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE') then
    raise exception 'browser roles may execute the product save RPC';
  end if;
  if not has_function_privilege('service_role','public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE') then
    raise exception 'service_role cannot execute the product save RPC';
  end if;
  if has_table_privilege('anon','public.products','INSERT') or has_table_privilege('anon','public.products','UPDATE')
     or has_table_privilege('authenticated','public.products','INSERT') or has_table_privilege('authenticated','public.products','UPDATE')
     or has_table_privilege('authenticated','public.product_images','INSERT') or has_table_privilege('authenticated','public.cpu_specs','UPDATE') then
    raise exception 'browser role received direct product mutation privileges';
  end if;
  if exists(select 1 from public.products where version<>0) then
    raise exception 'existing products must be backfilled to version zero';
  end if;
end $$;

-- Browser identities cannot write directly, even when the caller is an active administrator.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000371',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000371","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.products where id='00000000-0000-4000-8000-000000000381')<>0 then
    raise exception 'admin draft leaked through the public/admin RLS boundary';
  end if;
  begin
    update public.products set name='browser write' where id='00000000-0000-4000-8000-000000000380';
    raise exception 'authenticated administrator directly updated a product';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,'{}','{}','{}','[]',
      '00000000-0000-4000-8000-000000000371','t37-auth-rpc-denied');
    raise exception 'authenticated administrator executed the service-only RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin
    insert into public.products(category_id,slug,sku,name,brand)
    values((select id from public.categories where slug='cpu'),'t37-anon','T37-ANON','Anon','Anon');
    raise exception 'anonymous role inserted a product';
  exception when insufficient_privilege then null; end;
  if has_function_privilege(current_user,'public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE') then
    raise exception 'anonymous role can execute product save RPC';
  end if;
end $$;
reset role;

-- Trusted server path: create fixtures in every category and an incomplete GPU draft.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_version integer; v_conflicted boolean;
begin
  perform public.admin_save_product('00000000-0000-4000-8000-000000000380',null,
    pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN'),
    '{"socket_code":"AM5","core_count":8,"base_clock_mhz":3600,"tdp_w":65}'::jsonb,ARRAY['gaming'],
    '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000390.png","alt_text":"CPU front","sort_order":0}]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-cpu');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000381',null,
    pg_temp.t37_fields('gpu','t37-gpu-incomplete','T37-GPU-INCOMPLETE'),'{}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-gpu-incomplete');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000382',null,
    pg_temp.t37_fields('motherboard','t37-motherboard','T37-MB'),
    '{"socket_code":"AM5","ddr_generation":"DDR5","form_factor":"ATX"}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-motherboard');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000383',null,
    pg_temp.t37_fields('memory','t37-memory','T37-MEMORY'),
    '{"ddr_generation":"DDR5","capacity_gb":32,"module_count":2,"speed_mt_s":6000}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-memory');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000384',null,
    pg_temp.t37_fields('ssd','t37-ssd','T37-SSD'),
    '{"capacity_gb":1000,"interface":"NVMe","form_factor":"M.2"}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-ssd');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000385',null,
    pg_temp.t37_fields('power-supply','t37-psu','T37-PSU'),
    '{"rated_w":850,"form_factor":"ATX","efficiency_grade":"80 Plus Gold"}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-psu');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000386',null,
    pg_temp.t37_fields('pc-case','t37-case','T37-CASE'),
    '{"max_gpu_length_mm":350,"outer_length_mm":450,"outer_width_mm":220,"outer_height_mm":450,"supported_form_factors":["ATX"]}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-case');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000387',null,
    pg_temp.t37_fields('cpu-cooler','t37-cooler','T37-COOLER'),
    '{"supported_socket_codes":["AM5"],"height_mm":165,"cooling_type":"Air"}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-cooler');
  perform public.admin_save_product('00000000-0000-4000-8000-000000000388',null,
    pg_temp.t37_fields('cpu','t37-cpu-foreign','T37-CPU-FOREIGN'),'{"socket_code":"AM5"}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-create-foreign-product');

  if not exists(select 1 from public.cpu_specs where product_id='00000000-0000-4000-8000-000000000380')
     or exists(select 1 from public.gpu_specs where product_id='00000000-0000-4000-8000-000000000381')
     or not exists(select 1 from public.motherboard_specs where product_id='00000000-0000-4000-8000-000000000382')
     or not exists(select 1 from public.memory_specs where product_id='00000000-0000-4000-8000-000000000383')
     or not exists(select 1 from public.ssd_specs where product_id='00000000-0000-4000-8000-000000000384')
     or not exists(select 1 from public.psu_specs where product_id='00000000-0000-4000-8000-000000000385')
     or not exists(select 1 from public.case_specs where product_id='00000000-0000-4000-8000-000000000386')
     or not exists(select 1 from public.cooler_specs where product_id='00000000-0000-4000-8000-000000000387') then
    raise exception 'typed specification rows did not match the eight categories or incomplete GPU draft';
  end if;

  -- An incomplete new GPU draft has no spec row and cannot publish even when
  -- valid uploaded image metadata is supplied in the same transaction.
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000381',0,
      pg_temp.t37_fields('gpu','t37-gpu-incomplete','T37-GPU-INCOMPLETE','published','T37 GPU'),
      '{}'::jsonb,'{}'::text[],
      '[{"storage_path":"00000000-0000-4000-8000-000000000381/00000000-0000-4000-8000-000000000393.png","alt_text":"GPU","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-publish-incomplete-gpu');
  exception when check_violation then v_conflicted:=true; end;
  if not v_conflicted or (select status from public.products where id='00000000-0000-4000-8000-000000000381')<>'draft'
     or exists(select 1 from public.product_images where product_id='00000000-0000-4000-8000-000000000381') then
    raise exception 'failed incomplete GPU publication left partial product or image metadata';
  end if;

  -- Complete the incomplete GPU draft; its omitted columns preserve prior values.
  perform public.admin_save_product('00000000-0000-4000-8000-000000000381',0,
    pg_temp.t37_fields('gpu','t37-gpu-incomplete','T37-GPU-INCOMPLETE'),
    '{"chipset":"T37 GPU","vram_gb":12,"card_length_mm":300}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-complete-gpu');
  select version into v_version from public.products where id='00000000-0000-4000-8000-000000000381';
  if v_version<>1 then raise exception 'first update must increment version exactly once'; end if;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000381',1,
      pg_temp.t37_fields('gpu','t37-gpu-incomplete','T37-GPU-INCOMPLETE'),
      '{"vram_gb":null}'::jsonb,'{}'::text[],'[]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-null-not-null-spec');
    raise exception 'NOT NULL GPU spec accepted explicit NULL';
  exception when not_null_violation then null; end;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000381',1,
      pg_temp.t37_fields('gpu','t37-gpu-incomplete','T37-GPU-INCOMPLETE'),
      '{"unknown_gpu_field":1}'::jsonb,'{}'::text[],'[]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-unknown-spec');
    raise exception 'unknown category spec field was silently ignored';
  exception when sqlstate '22023' then null; end;

  -- Nullable fields accept NULL while omitted fields on an existing row are preserved.
  perform public.admin_save_product('00000000-0000-4000-8000-000000000382',0,
    pg_temp.t37_fields('motherboard','t37-motherboard','T37-MB'),
    '{"form_factor":null}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-nullable-spec-update');
  if (select socket_code from public.motherboard_specs where product_id='00000000-0000-4000-8000-000000000382')<>'AM5'
     or (select form_factor from public.motherboard_specs where product_id='00000000-0000-4000-8000-000000000382') is not null then
    raise exception 'nullable spec update did not clear nullable field and preserve omitted field';
  end if;
  perform public.admin_save_product('00000000-0000-4000-8000-000000000386',0,
    pg_temp.t37_fields('pc-case','t37-case','T37-CASE'),
    '{"supported_form_factors":null}'::jsonb,'{}'::text[],'[]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-case-nullable-update');
  if (select outer_length_mm from public.case_specs where product_id='00000000-0000-4000-8000-000000000386')<>450
     or (select supported_form_factors from public.case_specs where product_id='00000000-0000-4000-8000-000000000386') is not null then
    raise exception 'PC case dimensions were not preserved during nullable-field update';
  end if;

  -- Prefix, object-existence and cross-product ownership are independent checks.
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN'),'{"socket_code":"AM5"}'::jsonb,ARRAY['gaming'],
      '[{"storage_path":"00000000-0000-4000-8000-000000000380/missing.png","alt_text":"Missing","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-image-missing');
  exception when sqlstate '22023' then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'missing Storage object path was accepted'; end if;
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN'),'{"socket_code":"AM5"}'::jsonb,ARRAY['gaming'],
      '[{"storage_path":"00000000-0000-4000-8000-000000000381/00000000-0000-4000-8000-000000000393.png","alt_text":"Wrong prefix","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-image-prefix');
  exception when sqlstate '22023' then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'Storage path without product UUID prefix was accepted'; end if;
  insert into public.product_images(product_id,storage_path,alt_text,sort_order)
    values('00000000-0000-4000-8000-000000000388',
      '00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000392.png','legacy foreign owner',0);
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN'),'{"socket_code":"AM5"}'::jsonb,ARRAY['gaming'],
      '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000392.png","alt_text":"CPU","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-image-foreign-owner');
  exception when unique_violation then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'image path associated with another product was accepted'; end if;
  delete from public.product_images where product_id='00000000-0000-4000-8000-000000000388';

  -- Category immutability and create/update version branching.
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,
      pg_temp.t37_fields('gpu','t37-cpu-main','T37-CPU-MAIN'),'{"chipset":"X","vram_gb":1}'::jsonb,'{}'::text[],'[]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-category-change');
  exception when sqlstate '22023' then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'existing product category changed'; end if;
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',null,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN'),'{"socket_code":"AM5"}'::jsonb,'{}'::text[],'[]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-create-existing-id');
  exception when unique_violation then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'create path accepted an existing product UUID'; end if;

  -- Publish, replace the last image atomically, and verify live catalog compatibility data.
  perform public.admin_save_product('00000000-0000-4000-8000-000000000380',0,
    pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','T37 CPU'),
    '{"socket_code":"AM5","core_count":8,"base_clock_mhz":3600,"tdp_w":65}'::jsonb,ARRAY['gaming'],
    '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000390.png","alt_text":"CPU front","sort_order":0}]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-publish-cpu');
  select version into v_version from public.products where id='00000000-0000-4000-8000-000000000380';
  if v_version<>1 then raise exception 'publish update did not increment product version once'; end if;
  perform public.admin_save_product('00000000-0000-4000-8000-000000000380',1,
    pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','T37 CPU Updated',1200),
    '{"socket_code":"AM4","core_count":8,"base_clock_mhz":3600,"tdp_w":65}',ARRAY['gaming'],
    '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png","alt_text":"CPU updated","sort_order":0}]'::jsonb,
    '00000000-0000-4000-8000-000000000371','t37-replace-published-image');
  if exists(select 1 from public.product_images where product_id='00000000-0000-4000-8000-000000000380'
      and storage_path='00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000390.png')
     or not exists(select 1 from public.product_images where product_id='00000000-0000-4000-8000-000000000380'
      and storage_path='00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png') then
    raise exception 'published image replacement did not leave only new metadata';
  end if;
  -- Stale optimistic version, Yamato limits, and revoked actor all fail atomically.
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',1,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','stale'),'{"socket_code":"AM5"}'::jsonb,
      ARRAY['gaming'],'[]'::jsonb,'00000000-0000-4000-8000-000000000371','t37-stale-version');
  exception when sqlstate 'P0001' then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'stale product version was accepted'; end if;
  select version into v_version from public.products where id='00000000-0000-4000-8000-000000000380';
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',v_version,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','T37 CPU Updated',1200,30001),
      '{"socket_code":"AM4"}'::jsonb,ARRAY['gaming'],
      '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png","alt_text":"CPU updated","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-yamato-limit');
  exception when check_violation then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'published product exceeded Yamato weight limit'; end if;

  update public.admin_memberships set revoked_at=now() where user_id='00000000-0000-4000-8000-000000000371';
  v_conflicted:=false;
  begin
    perform public.admin_save_product('00000000-0000-4000-8000-000000000380',v_version,
      pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','T37 CPU Updated',1200),
      '{"socket_code":"AM4"}'::jsonb,ARRAY['gaming'],
      '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png","alt_text":"CPU updated","sort_order":0}]'::jsonb,
      '00000000-0000-4000-8000-000000000371','t37-revoked-admin');
  exception when insufficient_privilege then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'revoked administrator retained RPC write access'; end if;
  update public.admin_memberships set revoked_at=null
    where user_id='00000000-0000-4000-8000-000000000371';

  if not exists(select 1 from public.audit_logs where request_id='t37-publish-cpu'
      and actor_id='00000000-0000-4000-8000-000000000371'
      and action='admin.product.saved' and entity_type='product' and entity_id='00000000-0000-4000-8000-000000000380'
      and change_summary->>'reason_code'='product_change'
      and change_summary->'changed_fields' @> '["status"]'::jsonb)
     or not exists(select 1 from public.audit_logs where request_id='t37-replace-published-image'
      and change_summary->'changed_fields' @> '["price_tax_included_yen","product_image"]'::jsonb)
     or exists(select 1 from public.audit_logs where request_id in ('t37-stale-version','t37-yamato-limit','t37-revoked-admin')) then
    raise exception 'audit fields/reasons or failed-save rollback did not match actual state changes';
  end if;
end $$;
reset role;

-- Historical order item snapshots do not follow later catalog edits.
insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
  tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
values ('00000000-0000-4000-8000-000000000372',1000,940,0,940,176,1940,'t37-shipping-v1',
  '{"shipping_base_yen":940}','{"postal_code":"1000001"}','00000000-0000-4000-8000-000000000398');
insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen,spec_snapshot)
select o.id,p.id,'T37-CPU-MAIN','T37 CPU','T37 Labs',1000,1,1000,'{"socket_code":"AM5"}'::jsonb
from public.orders o cross join public.products p
where o.checkout_key='00000000-0000-4000-8000-000000000398' and p.id='00000000-0000-4000-8000-000000000380';
create temporary table t37_order_snapshot_before as
  select to_jsonb(i) as row from public.order_items i join public.orders o on o.id=i.order_id
  where o.checkout_key='00000000-0000-4000-8000-000000000398';
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.admin_save_product('00000000-0000-4000-8000-000000000380',2,
  pg_temp.t37_fields('cpu','t37-cpu-main','T37-CPU-MAIN','published','T37 CPU Later',1500),
  '{"socket_code":"AM4"}'::jsonb,ARRAY['gaming'],
  '[{"storage_path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png","alt_text":"CPU updated","sort_order":0}]'::jsonb,
  '00000000-0000-4000-8000-000000000371','t37-order-snapshot-edit');
reset role;
do $$ begin
  if (select row from t37_order_snapshot_before) is distinct from
     (select to_jsonb(i) from public.order_items i join public.orders o on o.id=i.order_id
       where o.checkout_key='00000000-0000-4000-8000-000000000398') then
    raise exception 'catalog edit changed an immutable historical order item snapshot';
  end if;
end $$;

-- Non-admin authenticated sessions only see published catalog rows and cannot write.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000372',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000372","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.products where id='00000000-0000-4000-8000-000000000380')<>1
     or (select count(*) from public.products where id='00000000-0000-4000-8000-000000000381')<>0 then
    raise exception 'public catalog RLS changed published/draft visibility';
  end if;
  if public.get_published_product_detail('t37-cpu-main')->>'name' is distinct from 'T37 CPU Later'
     or public.get_published_product_detail('t37-cpu-main')->'specifications'->>'socket_code' is distinct from 'AM4'
     or not exists(select 1 from public.search_published_products(category_slug=>'cpu',spec_filter=>' {"socket_code":"AM4"}'::jsonb) s
       cross join lateral jsonb_array_elements(s.items) as entry(value)
       where entry.value->>'id'='00000000-0000-4000-8000-000000000380'
         and entry.value->>'name'='T37 CPU Later'
         and entry.value->'images' @> '[{"path":"00000000-0000-4000-8000-000000000380/00000000-0000-4000-8000-000000000391.png","altText":"CPU updated"}]'::jsonb) then
    raise exception 'T15 detail or T13 compatibility-filter projection regressed after product edit';
  end if;
  begin
    insert into public.product_use_cases(product_id,use_case)
    values('00000000-0000-4000-8000-000000000380','daily');
    raise exception 'authenticated member wrote product use case';
  exception when insufficient_privilege then null; end;
  if has_table_privilege(current_user,'public.products','UPDATE') or has_table_privilege(current_user,'public.cpu_specs','UPDATE')
    or has_table_privilege(current_user,'public.product_images','INSERT') then
    raise exception 'ordinary member has product mutation privilege';
  end if;
end $$;
reset role;

rollback;
