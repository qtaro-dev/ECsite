-- T37: scoped product and category-spec editing for administrators.

alter table public.products
  add column version integer not null default 0 check (version >= 0);

create function public.admin_save_product(
  p_product_id uuid,
  p_expected_version integer,
  p_fields jsonb,
  p_specifications jsonb,
  p_use_cases text[],
  p_images jsonb,
  p_actor_id uuid,
  p_request_id text
) returns table(product_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_product_id;
  v_category_id uuid;
  v_category_slug text;
  v_spec_table text;
  v_current_version integer;
  v_assignments text;
  v_status text := coalesce(p_fields->>'status', 'draft');
  v_changed_fields text[] := array[]::text[];
  v_old_price integer;
  v_old_status text;
  v_old_images jsonb := '[]'::jsonb;
  v_new_images jsonb := '[]'::jsonb;
  v_required_spec_columns text[] := array[]::text[];
  v_has_old_specs boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='service role required';
  end if;
  if not exists (select 1 from public.admin_memberships m
    where m.user_id=p_actor_id and m.revoked_at is null) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_product_id is null or p_expected_version < 0
     or jsonb_typeof(p_fields) is distinct from 'object'
     or jsonb_typeof(coalesce(p_specifications,'{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_images,'[]'::jsonb)) is distinct from 'array' then
    raise exception 'invalid product fields' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_fields) as k(key)
      where k.key not in ('category_slug','slug','sku','name','brand','description','beginner_note',
        'price_tax_included_yen','status','weight_g','pack_length_mm','pack_width_mm','pack_height_mm')) then
    raise exception 'unknown product field' using errcode='22023';
  end if;
  select c.id,c.slug into v_category_id,v_category_slug from public.categories c
    where c.slug=p_fields->>'category_slug';
  if v_category_id is null then raise exception 'invalid category' using errcode='22023'; end if;
  v_spec_table := case v_category_slug
    when 'cpu' then 'cpu_specs' when 'gpu' then 'gpu_specs'
    when 'motherboard' then 'motherboard_specs' when 'memory' then 'memory_specs'
    when 'ssd' then 'ssd_specs' when 'power-supply' then 'psu_specs'
    when 'pc-case' then 'case_specs' when 'cpu-cooler' then 'cooler_specs' end;
  v_required_spec_columns := case v_category_slug
    when 'gpu' then array['chipset','vram_gb']
    when 'ssd' then array['capacity_gb','interface','form_factor']
    when 'power-supply' then array['rated_w','form_factor','efficiency_grade']
    when 'pc-case' then array['outer_length_mm','outer_width_mm','outer_height_mm']
    when 'cpu-cooler' then array['height_mm','cooling_type']
    else array[]::text[] end;
  if v_status not in ('draft','published','hidden') then
    raise exception 'invalid product status' using errcode='22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_use_cases,array[]::text[])) u
    where u not in ('gaming','daily','editing')) then
    raise exception 'invalid product use case' using errcode='22023';
  end if;

  if p_expected_version is null then
    if exists(select 1 from public.products p where p.id=v_id) then
      raise exception 'product id already exists' using errcode='23505';
    end if;
    insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
      price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
    values(v_id,v_category_id,p_fields->>'slug',p_fields->>'sku',coalesce(p_fields->>'name',''),
      coalesce(p_fields->>'brand',''),coalesce(p_fields->>'description',''),coalesce(p_fields->>'beginner_note',''),
      nullif(p_fields->>'price_tax_included_yen','')::integer,1000,'draft',
      nullif(p_fields->>'weight_g','')::integer,nullif(p_fields->>'pack_length_mm','')::integer,
      nullif(p_fields->>'pack_width_mm','')::integer,nullif(p_fields->>'pack_height_mm','')::integer)
    returning id into v_id;
  else
    select p.version,p.category_id,p.price_tax_included_yen,p.status
      into v_current_version,v_category_id,v_old_price,v_old_status
      from public.products p where p.id=p_product_id for update;
    if v_current_version is null then raise exception 'product not found' using errcode='P0002'; end if;
    if v_current_version<>p_expected_version then raise exception 'stale product version' using errcode='P0001'; end if;
    if v_category_id<>(select c.id from public.categories c where c.slug=p_fields->>'category_slug') then
      raise exception 'category cannot be changed after creation' using errcode='22023';
    end if;
    update public.products as product set status='draft' where product.id=p_product_id;
    select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
      order by i.sort_order,i.storage_path),'[]'::jsonb) into v_old_images
      from public.product_images i where i.product_id=p_product_id;
    update public.products as product set slug=p_fields->>'slug',sku=p_fields->>'sku',
      name=coalesce(p_fields->>'name',''),brand=coalesce(p_fields->>'brand',''),
      description=coalesce(p_fields->>'description',''),beginner_note=coalesce(p_fields->>'beginner_note',''),
      price_tax_included_yen=nullif(p_fields->>'price_tax_included_yen','')::integer,
      weight_g=nullif(p_fields->>'weight_g','')::integer,pack_length_mm=nullif(p_fields->>'pack_length_mm','')::integer,
      pack_width_mm=nullif(p_fields->>'pack_width_mm','')::integer,pack_height_mm=nullif(p_fields->>'pack_height_mm','')::integer,
      version=product.version+1 where product.id=p_product_id;
  end if;

  execute format('select exists(select 1 from public.%I s where s.product_id=$1)',v_spec_table)
    into v_has_old_specs using v_id;
  if exists (select 1 from jsonb_object_keys(coalesce(p_specifications,'{}'::jsonb)) as supplied(key)
      where supplied.key='product_id' or not exists (
        select 1 from information_schema.columns c where c.table_schema='public'
          and c.table_name=v_spec_table and c.column_name=supplied.key)) then
    raise exception 'unknown specification field' using errcode='22023';
  end if;
  if v_has_old_specs or not exists(select 1 from unnest(v_required_spec_columns) required_key
      where nullif(btrim(p_specifications->>required_key),'') is null) then
    select pg_catalog.string_agg(pg_catalog.format('%I=excluded.%I',a.attname,a.attname),',' order by a.attnum)
      into v_assignments from pg_attribute a
      where a.attrelid=pg_catalog.format('public.%I',v_spec_table)::regclass
        and a.attnum>0 and not a.attisdropped and a.attname<>'product_id';
    execute format(
      'insert into public.%I select (pg_catalog.jsonb_populate_record((select s from public.%I s where s.product_id=$2),$1 || pg_catalog.jsonb_build_object(''product_id'',$2))).* on conflict (product_id) do update set %s',
      v_spec_table,v_spec_table,v_assignments)
      using coalesce(p_specifications,'{}'::jsonb),v_id;
  end if;
  delete from public.product_use_cases as product_use_case where product_use_case.product_id=v_id;
  insert into public.product_use_cases(product_id,use_case)
    select v_id,u from unnest(coalesce(p_use_cases,array[]::text[])) u;

  -- p_images contains only this product's retained or newly uploaded paths.
  -- The API uploads bytes first; no client can write product_images directly.
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint)
      where i.storage_path is null or i.alt_text is null or btrim(i.alt_text)=''
        or char_length(i.alt_text)>240 or i.sort_order is null or i.sort_order<0) then
    raise exception 'invalid image metadata' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      where i.storage_path is null or i.storage_path not like v_id::text || '/%'
        or not exists(select 1 from storage.objects o
        where o.bucket_id='product-images' and o.name=i.storage_path)) then
    raise exception 'uploaded image object not found' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      join public.product_images old_image on old_image.storage_path=i.storage_path
      where old_image.product_id<>v_id) then
    raise exception 'image path is already associated with another product' using errcode='23505';
  end if;
  if exists(select 1 from public.products where id=v_id and status='published') then
    update public.products as product set status='draft' where product.id=v_id;
  end if;
  delete from public.product_images as product_image where product_image.product_id=v_id and not exists(
    select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as submitted(storage_path text)
      where submitted.storage_path=product_image.storage_path);
  insert into public.product_images(product_id,storage_path,alt_text,sort_order)
    select v_id,i.storage_path,i.alt_text,i.sort_order
    from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint)
    on conflict(storage_path) do update set alt_text=excluded.alt_text,sort_order=excluded.sort_order
      where public.product_images.product_id=v_id;
  -- The ownership precheck above can race with another transaction. Do not let
  -- ON CONFLICT ... WHERE silently omit a path that another product claimed.
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as submitted(storage_path text)
      where not exists (select 1 from public.product_images i
        where i.product_id=v_id and i.storage_path=submitted.storage_path)) then
    raise exception 'image path is already associated with another product' using errcode='23505';
  end if;

  if v_status='published' and (
    coalesce(nullif(p_fields->>'weight_g','')::integer>30000,false)
    or coalesce(nullif(p_fields->>'pack_length_mm','')::integer
      + nullif(p_fields->>'pack_width_mm','')::integer
      + nullif(p_fields->>'pack_height_mm','')::integer>2000,false)
    or coalesce(nullif(p_fields->>'pack_length_mm','')::integer>1700,false)
    or coalesce(nullif(p_fields->>'pack_width_mm','')::integer>1700,false)
    or coalesce(nullif(p_fields->>'pack_height_mm','')::integer>1700,false)) then
    raise exception 'Yamato handling limit exceeded' using errcode='23514';
  end if;
  update public.products as product set status=v_status where product.id=v_id;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
    order by i.sort_order,i.storage_path),'[]'::jsonb) into v_new_images
    from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint);
  if nullif(p_fields->>'price_tax_included_yen','')::integer is distinct from v_old_price then
    v_changed_fields:=array_append(v_changed_fields,'price_tax_included_yen');
  end if;
  if v_status is distinct from v_old_status then
    v_changed_fields:=array_append(v_changed_fields,'status');
  end if;
  if v_new_images is distinct from v_old_images then
    v_changed_fields:=array_append(v_changed_fields,'product_image');
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
    values(p_actor_id,'admin.product.saved','product',v_id,
      jsonb_build_object('changed_fields',to_jsonb(v_changed_fields),'reason_code','product_change'),p_request_id);
  return query select p.id,p.version from public.products p where p.id=v_id;
end;
$$;

revoke all on function public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)
  from public,anon,authenticated;
grant execute on function public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)
  to service_role;
