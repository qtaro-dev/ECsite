-- T61: selected catalog parts are references; the PC remains its own price and stock unit.
create or replace function public.valid_prebuilt_pc_components(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object'
    and value ?& array['cpu','gpu','memory','ssd']
    and (value - array['cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase','cpuCooler']) = '{}'::jsonb
    and (select bool_and(case when jsonb_typeof(value->component_key) is distinct from 'object' then false else
      ((value->component_key) - array['label','details']) = '{}'::jsonb
      and jsonb_typeof(value->component_key->'label') = 'string'
      and length(btrim(value->component_key->>'label')) between 1 and 120
      and jsonb_typeof(value->component_key->'details') = 'string'
      and length(btrim(value->component_key->>'details')) between 1 and 300 end)
      from unnest(array['cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase','cpuCooler']) as keys(component_key)
      where value ? component_key);
$$;

create table public.prebuilt_pc_component_parts (
  prebuilt_product_id uuid not null references public.products(id) on delete cascade,
  slot text not null check (slot in ('cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase','cpuCooler')),
  part_product_id uuid not null references public.products(id) on delete restrict,
  primary key (prebuilt_product_id,slot),
  unique (prebuilt_product_id,part_product_id)
);
create index prebuilt_pc_component_parts_part_idx on public.prebuilt_pc_component_parts(part_product_id);
alter table public.prebuilt_pc_component_parts enable row level security;
alter table public.prebuilt_pc_component_parts force row level security;
create policy prebuilt_component_parts_public_read on public.prebuilt_pc_component_parts for select to anon,authenticated
  using (exists (select 1 from public.products pc where pc.id=prebuilt_product_id and pc.status='published' and pc.deleted_at is null)
    and exists (select 1 from public.products part where part.id=part_product_id and part.status='published' and part.deleted_at is null));
create policy prebuilt_component_parts_admin_read on public.prebuilt_pc_component_parts for select to authenticated using (private.is_active_admin());
revoke all on public.prebuilt_pc_component_parts from public,anon,authenticated;
grant select on public.prebuilt_pc_component_parts to anon,authenticated;

create or replace function public.validate_prebuilt_component_part()
returns trigger language plpgsql set search_path = '' as $$
declare pc_category text; part_category text; expected_category text; part_status text; part_deleted timestamptz;
begin
  select c.slug into pc_category from public.products p join public.categories c on c.id=p.category_id where p.id=new.prebuilt_product_id;
  expected_category := case new.slot when 'powerSupply' then 'power-supply' when 'pcCase' then 'pc-case' when 'cpuCooler' then 'cpu-cooler' else new.slot end;
  select c.slug,p.status,p.deleted_at into part_category,part_status,part_deleted
    from public.products p join public.categories c on c.id=p.category_id where p.id=new.part_product_id;
  if pc_category is distinct from 'prebuilt-pc' or part_category is distinct from expected_category
     or part_status is distinct from 'published' or part_deleted is not null then
    raise exception 'invalid selected part' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger prebuilt_component_part_guard before insert or update on public.prebuilt_pc_component_parts
  for each row execute function public.validate_prebuilt_component_part();

-- The snapshot uses stable, catalog-derived text. Historical snapshots are never regenerated.
create or replace function private.prebuilt_part_details(p_id uuid,p_slot text)
returns text language sql stable security definer set search_path = '' as $$
  select left(concat_ws(' · ', nullif(p.brand,''),
    case p_slot
      when 'cpu' then (select concat_ws(' / ',s.socket_code,case when s.core_count is not null then s.core_count||'コア' end) from public.cpu_specs s where s.product_id=p_id)
      when 'gpu' then (select concat_ws(' / ',s.chipset,s.vram_gb||'GB') from public.gpu_specs s where s.product_id=p_id)
      when 'memory' then (select concat_ws(' / ',s.ddr_generation,s.capacity_gb||'GB',s.module_count||'枚') from public.memory_specs s where s.product_id=p_id)
      when 'ssd' then (select concat_ws(' / ',s.capacity_gb||'GB',s.interface,s.form_factor) from public.ssd_specs s where s.product_id=p_id)
      when 'motherboard' then (select concat_ws(' / ',s.socket_code,s.ddr_generation,s.form_factor) from public.motherboard_specs s where s.product_id=p_id)
      when 'powerSupply' then (select concat_ws(' / ',s.rated_w||'W',s.efficiency_grade) from public.psu_specs s where s.product_id=p_id)
      when 'pcCase' then (select concat_ws(' / ',s.outer_length_mm||'×'||s.outer_width_mm||'×'||s.outer_height_mm||'mm') from public.case_specs s where s.product_id=p_id)
      when 'cpuCooler' then (select concat_ws(' / ',s.cooling_type,s.height_mm||'mm') from public.cooler_specs s where s.product_id=p_id)
    end,
    'SKU: '||p.sku),300) from public.products p where p.id=p_id;
$$;
revoke all on function private.prebuilt_part_details(uuid,text) from public,anon,authenticated;
grant execute on function private.prebuilt_part_details(uuid,text) to service_role;

create or replace function public.admin_save_prebuilt_pc_v2(
  p_product_id uuid,p_expected_version integer,p_fields jsonb,p_part_ids jsonb,
  p_use_cases text[],p_images jsonb,p_actor_id uuid,p_request_id text
) returns table(product_id uuid,version integer)
language plpgsql security definer set search_path = '' as $$
declare item record; v_part_id uuid; v_part public.products%rowtype; v_category text;
  v_expected text; v_components jsonb := '{}'::jsonb; v_saved record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_part_ids is not null and jsonb_typeof(p_part_ids) is distinct from 'object' then
    raise exception 'part selection must be an object' using errcode='22023';
  end if;
  if p_part_ids is not null and p_part_ids <> '{}'::jsonb then
    if not p_part_ids ?& array['cpu','gpu','memory','ssd'] then
      raise exception 'CPU, graphics card, memory and SSD are required together' using errcode='22023';
    end if;
    for item in select key,value from jsonb_each(p_part_ids) loop
      if item.key not in ('cpu','gpu','memory','ssd','motherboard','powerSupply','pcCase','cpuCooler')
         or jsonb_typeof(item.value) is distinct from 'string'
         or item.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid part selection' using errcode='22023';
      end if;
      v_part_id := (item.value #>> '{}')::uuid;
      v_expected := case item.key when 'powerSupply' then 'power-supply' when 'pcCase' then 'pc-case' when 'cpuCooler' then 'cpu-cooler' else item.key end;
      select p.* into v_part from public.products p where p.id=v_part_id for share;
      select c.slug into v_category from public.categories c where c.id=v_part.category_id;
      if not found or v_part.id is null or v_part.status<>'published' or v_part.deleted_at is not null or v_category is distinct from v_expected then
        raise exception 'selected part unavailable or category mismatched' using errcode='23514';
      end if;
      v_components := v_components || jsonb_build_object(item.key,jsonb_build_object(
        'label',left(v_part.name,120),'details',private.prebuilt_part_details(v_part_id,item.key)));
    end loop;
  end if;
  if p_fields->>'status'='published' and v_components='{}'::jsonb then
    raise exception 'published PC requires selected parts' using errcode='23514';
  end if;
  if p_expected_version is not null and v_components='{}'::jsonb
    and exists(select 1 from public.prebuilt_pc_specs s where s.product_id=p_product_id)
    and not exists(select 1 from public.prebuilt_pc_component_parts r where r.prebuilt_product_id=p_product_id) then
    raise exception 'legacy PC requires part reselection before update' using errcode='23514';
  end if;
  select * into v_saved from public.admin_save_prebuilt_pc(p_product_id,p_expected_version,p_fields,
    nullif(v_components,'{}'::jsonb),p_use_cases,p_images,p_actor_id,p_request_id);
  delete from public.prebuilt_pc_component_parts where prebuilt_product_id=p_product_id;
  insert into public.prebuilt_pc_component_parts(prebuilt_product_id,slot,part_product_id)
    select p_product_id,key,(value #>> '{}')::uuid from jsonb_each(coalesce(p_part_ids,'{}'::jsonb));
  return query select v_saved.product_id,v_saved.version;
end;
$$;
revoke all on function public.admin_save_prebuilt_pc_v2(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_save_prebuilt_pc_v2(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text) to service_role;
-- Only migration-owner code may invoke the legacy free-text function. API service role uses v2.
revoke execute on function public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text) from service_role;
