-- T58: strict nested component validation and an isolated administrator RPC.
create or replace function public.valid_prebuilt_pc_components(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object'
    and value ?& array['cpu','gpu','memory','ssd']
    and (value - array['cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase']) = '{}'::jsonb
    and (select bool_and(case when jsonb_typeof(value->component_key) is distinct from 'object' then false else
      (value->component_key - array['label','details']) = '{}'::jsonb
      and jsonb_object_length(value->component_key) = 2
      and jsonb_typeof(value->component_key->'label') = 'string'
      and length(btrim(value->component_key->>'label')) between 1 and 120
      and jsonb_typeof(value->component_key->'details') = 'string'
      and length(btrim(value->component_key->>'details')) between 1 and 300 end)
      from unnest(array['cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase']) as keys(component_key)
      where value ? component_key);
$$;
revoke all on function public.valid_prebuilt_pc_components(jsonb) from public, anon, authenticated;

-- Re-evaluate existing rows under the tightened nested-key contract.
alter table public.prebuilt_pc_specs drop constraint prebuilt_pc_specs_components_check;
alter table public.prebuilt_pc_specs add constraint prebuilt_pc_specs_components_check
  check (public.valid_prebuilt_pc_components(components));

create or replace function public.validate_audit_summary()
returns trigger language plpgsql set search_path = '' as $$
declare item record; field_name text; summary_key text;
begin
  for item in select key,value from jsonb_each(new.change_summary) loop
    summary_key := item.key;
    if summary_key not in ('changed_fields','reason_code') then
      raise exception 'audit summary only accepts field names and reason codes' using errcode = '23514';
    end if;
    if summary_key = 'changed_fields' then
      if jsonb_typeof(item.value) <> 'array' then raise exception 'changed_fields must be an array' using errcode = '23514'; end if;
      for field_name in select jsonb_array_elements_text(item.value) loop
        if field_name not in ('price_tax_included_yen','status','category_id','product_image','stock_on_hand',
          'shipping_base_fee_yen','shipping_free_threshold_yen','shipping_heavy_threshold_g','shipping_rate_table',
          'shipping_origin_prefecture_code','smtp_host','smtp_port','smtp_tls_mode','smtp_sender_address',
          'smtp_sender_name','smtp_username','smtp_secret_ref','admin_membership','order_status','payment_state',
          'product_details','prebuilt_pc_components','product_use_cases') then
          raise exception 'audit field name is not allowlisted' using errcode = '23514';
        end if;
      end loop;
    elsif jsonb_typeof(item.value) <> 'string' or item.value #>> '{}' not in
      ('manual_update','connection_test','stock_adjustment','product_change','order_exception','role_change',
       'configuration_change','reconciliation','privacy_unlink') then
      raise exception 'audit reason code is not allowlisted' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.admin_save_prebuilt_pc(
  p_product_id uuid,
  p_expected_version integer,
  p_fields jsonb,
  p_components jsonb,
  p_use_cases text[],
  p_images jsonb,
  p_actor_id uuid,
  p_request_id text
) returns table(product_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_product_id;
  v_category_id uuid;
  v_current_version integer;
  v_old public.products%rowtype;
  v_before public.products%rowtype;
  v_old_components jsonb;
  v_old_use_cases text[];
  v_old_images jsonb := '[]'::jsonb;
  v_new_images jsonb := '[]'::jsonb;
  v_components jsonb := p_components;
  v_status text := coalesce(p_fields->>'status','draft');
  v_changed_fields text[] := array[]::text[];
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501', message='service role required'; end if;
  if p_actor_id is null or not exists(select 1 from public.admin_memberships m where m.user_id=p_actor_id and m.revoked_at is null) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_product_id is null or (p_expected_version is not null and p_expected_version<0)
     or jsonb_typeof(p_fields) is distinct from 'object'
     or jsonb_typeof(coalesce(p_images,'[]'::jsonb)) is distinct from 'array'
     or (p_components is not null and not public.valid_prebuilt_pc_components(p_components))
     or v_status not in ('draft','published','hidden') then
    raise exception 'invalid prebuilt PC fields' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_fields) as field(key) where field.key not in
    ('slug','sku','name','brand','description','beginner_note','price_tax_included_yen','status',
     'weight_g','pack_length_mm','pack_width_mm','pack_height_mm')) then
    raise exception 'unknown prebuilt PC field' using errcode='22023';
  end if;
  if exists(select 1 from unnest(coalesce(p_use_cases,array[]::text[])) as cases(value)
    where cases.value not in ('gaming','daily','editing'))
     or cardinality(coalesce(p_use_cases,array[]::text[])) <>
        (select count(distinct cases.value) from unnest(coalesce(p_use_cases,array[]::text[])) as cases(value)) then
    raise exception 'invalid prebuilt PC use case' using errcode='22023';
  end if;
  if v_status='published' and cardinality(coalesce(p_use_cases,array[]::text[]))=0 then
    raise exception 'published prebuilt PC requires a use case' using errcode='23514';
  end if;

  select id into v_category_id from public.categories where slug='prebuilt-pc';
  if v_category_id is null then raise exception 'prebuilt PC category unavailable' using errcode='22023'; end if;
  if p_expected_version is null then
    insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,
      tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
    values(v_id,v_category_id,p_fields->>'slug',p_fields->>'sku',coalesce(p_fields->>'name',''),
      coalesce(p_fields->>'brand',''),coalesce(p_fields->>'description',''),coalesce(p_fields->>'beginner_note',''),
      nullif(p_fields->>'price_tax_included_yen','')::integer,1000,'draft',
      nullif(p_fields->>'weight_g','')::integer,nullif(p_fields->>'pack_length_mm','')::integer,
      nullif(p_fields->>'pack_width_mm','')::integer,nullif(p_fields->>'pack_height_mm','')::integer)
    returning * into v_old;
    v_before := null;
  else
    select * into v_old from public.products where id=p_product_id for update;
    if not found then raise exception 'product not found' using errcode='P0002'; end if;
    if v_old.version<>p_expected_version then raise exception 'stale product version' using errcode='P0001'; end if;
    if v_old.category_id<>v_category_id or v_old.deleted_at is not null then raise exception 'product category cannot be changed' using errcode='22023'; end if;
    v_before := v_old;
    select s.components into v_old_components from public.prebuilt_pc_specs s where s.product_id=p_product_id for update;
    select coalesce(array_agg(u.use_case order by u.use_case),array[]::text[]) into v_old_use_cases
      from public.product_use_cases u where u.product_id=p_product_id;
    select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
      order by i.sort_order,i.storage_path),'[]'::jsonb) into v_old_images from public.product_images i where i.product_id=p_product_id;
    -- T53 forbids removing a published PC's configuration; move it to draft first inside this transaction.
    update public.products set status='draft' where id=p_product_id;
    update public.products set slug=p_fields->>'slug',sku=p_fields->>'sku',name=coalesce(p_fields->>'name',''),
      brand=coalesce(p_fields->>'brand',''),description=coalesce(p_fields->>'description',''),
      beginner_note=coalesce(p_fields->>'beginner_note',''),
      price_tax_included_yen=nullif(p_fields->>'price_tax_included_yen','')::integer,
      weight_g=nullif(p_fields->>'weight_g','')::integer,pack_length_mm=nullif(p_fields->>'pack_length_mm','')::integer,
      pack_width_mm=nullif(p_fields->>'pack_width_mm','')::integer,pack_height_mm=nullif(p_fields->>'pack_height_mm','')::integer,
      version=version+1 where id=p_product_id returning * into v_old;
  end if;

  if v_components is null then
    delete from public.prebuilt_pc_specs where product_id=v_id;
  else
    insert into public.prebuilt_pc_specs(product_id,components) values(v_id,v_components)
      on conflict(product_id) do update set components=excluded.components;
  end if;
  delete from public.product_use_cases where product_id=v_id;
  insert into public.product_use_cases(product_id,use_case)
    select v_id,cases.value from unnest(coalesce(p_use_cases,array[]::text[])) as cases(value);

  if exists(select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint)
      where i.storage_path is null or i.alt_text is null or btrim(i.alt_text)='' or char_length(i.alt_text)>240 or i.sort_order is null or i.sort_order<0) then
    raise exception 'invalid image metadata' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      where i.storage_path is null or i.storage_path not like v_id::text||'/%'
        or not exists(select 1 from storage.objects o where o.bucket_id='product-images' and o.name=i.storage_path)) then
    raise exception 'uploaded image object not found' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      join public.product_images existing on existing.storage_path=i.storage_path where existing.product_id<>v_id) then
    raise exception 'image path is already associated with another product' using errcode='23505';
  end if;
  delete from public.product_images existing where existing.product_id=v_id and not exists(
    select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as submitted(storage_path text) where submitted.storage_path=existing.storage_path);
  insert into public.product_images(product_id,storage_path,alt_text,sort_order)
    select v_id,i.storage_path,i.alt_text,i.sort_order from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint)
    on conflict(storage_path) do update set alt_text=excluded.alt_text,sort_order=excluded.sort_order where public.product_images.product_id=v_id;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as submitted(storage_path text)
      where not exists(select 1 from public.product_images i where i.product_id=v_id and i.storage_path=submitted.storage_path)) then
    raise exception 'image path is already associated with another product' using errcode='23505';
  end if;

  if v_status='published' and (coalesce(nullif(p_fields->>'weight_g','')::integer>30000,false)
      or coalesce(nullif(p_fields->>'pack_length_mm','')::integer+nullif(p_fields->>'pack_width_mm','')::integer+nullif(p_fields->>'pack_height_mm','')::integer>2000,false)
      or coalesce(nullif(p_fields->>'pack_length_mm','')::integer>1700,false)
      or coalesce(nullif(p_fields->>'pack_width_mm','')::integer>1700,false)
      or coalesce(nullif(p_fields->>'pack_height_mm','')::integer>1700,false)) then
    raise exception 'Yamato handling limit exceeded' using errcode='23514';
  end if;
  update public.products set status=v_status where id=v_id;

  select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
    order by i.sort_order,i.storage_path),'[]'::jsonb) into v_new_images
    from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint);
  if p_expected_version is null then
    v_changed_fields:=array_append(v_changed_fields,'product_details');
  end if;
  if p_expected_version is not null and (v_before.slug is distinct from p_fields->>'slug' or v_before.sku is distinct from p_fields->>'sku'
    or v_before.name is distinct from coalesce(p_fields->>'name','') or v_before.brand is distinct from coalesce(p_fields->>'brand','')
    or v_before.description is distinct from coalesce(p_fields->>'description','') or v_before.beginner_note is distinct from coalesce(p_fields->>'beginner_note','')
    or v_before.weight_g is distinct from nullif(p_fields->>'weight_g','')::integer
    or v_before.pack_length_mm is distinct from nullif(p_fields->>'pack_length_mm','')::integer
    or v_before.pack_width_mm is distinct from nullif(p_fields->>'pack_width_mm','')::integer
    or v_before.pack_height_mm is distinct from nullif(p_fields->>'pack_height_mm','')::integer) then
    v_changed_fields:=array_append(v_changed_fields,'product_details');
  end if;
  if v_before.price_tax_included_yen is distinct from nullif(p_fields->>'price_tax_included_yen','')::integer then v_changed_fields:=array_append(v_changed_fields,'price_tax_included_yen'); end if;
  if v_before.status is distinct from v_status then v_changed_fields:=array_append(v_changed_fields,'status'); end if;
  if v_old_components is distinct from v_components then v_changed_fields:=array_append(v_changed_fields,'prebuilt_pc_components'); end if;
  if coalesce(v_old_use_cases,array[]::text[]) is distinct from coalesce(p_use_cases,array[]::text[]) then v_changed_fields:=array_append(v_changed_fields,'product_use_cases'); end if;
  if v_old_images is distinct from v_new_images then v_changed_fields:=array_append(v_changed_fields,'product_image'); end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
    values(p_actor_id,'admin.product.saved','product',v_id,jsonb_build_object('changed_fields',to_jsonb(v_changed_fields),'reason_code','product_change'),p_request_id);
  return query select p.id,p.version from public.products p where p.id=v_id;
end;
$$;
revoke all on function public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text) to service_role;
