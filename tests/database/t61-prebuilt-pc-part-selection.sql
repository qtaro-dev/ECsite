\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000611','authenticated','authenticated','t61-admin@example.test',now(),now());
insert into public.admin_memberships(user_id) values ('00000000-0000-4000-8000-000000000611');

do $$ begin
  if (select count(*) from public.products p join public.categories c on c.id=p.category_id
      where c.slug='prebuilt-pc' and p.status='published' and p.deleted_at is null
        and exists(select 1 from public.prebuilt_pc_specs s where s.product_id=p.id)
        and not exists(select 1 from public.prebuilt_pc_component_parts r where r.prebuilt_product_id=p.id)) < 6 then
    raise exception 'legacy demo PCs were changed or automatically mapped';
  end if;
  if has_table_privilege('anon','public.prebuilt_pc_component_parts','INSERT')
    or has_table_privilege('authenticated','public.prebuilt_pc_component_parts','INSERT')
    or has_function_privilege('authenticated','public.admin_save_prebuilt_pc_v2(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE')
    or has_function_privilege('service_role','public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.admin_save_prebuilt_pc_v2(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE') then
    raise exception 'part reference write privilege leaked';
  end if;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare v_cpu uuid; v_gpu uuid; v_memory uuid; v_ssd uuid; v_cooler uuid; v_pc uuid := '00000000-0000-4000-8000-000000000612';
  v_legacy uuid; v_ids jsonb; v_before integer; v_failed boolean;
begin
  select id into v_cpu from public.products where slug='t11-cpu-am5';
  select id into v_gpu from public.products where slug='t11-gpu-300';
  select id into v_memory from public.products where slug='t11-memory-ddr5';
  select id into v_ssd from public.products where slug='t11-ssd';
  select id into v_cooler from public.products where slug='t11-cooler-am5';
  select id into v_legacy from public.products where slug='demo-gaming-pc-01';
  if v_cpu is null or v_gpu is null or v_memory is null or v_ssd is null or v_cooler is null or v_legacy is null then
    raise exception 'seed catalog fixtures are missing';
  end if;
  v_ids := jsonb_build_object('cpu',v_cpu,'gpu',v_gpu,'memory',v_memory,'ssd',v_ssd,'cpuCooler',v_cooler);
  select on_hand into v_before from public.inventory where product_id=v_cpu;
  perform public.admin_save_prebuilt_pc_v2(v_pc,null,
    '{"slug":"t61-part-selected-pc","sku":"T61-PC","name":"T61 Selected PC","brand":"T61 Fixture","status":"draft","price_tax_included_yen":99999}'::jsonb,
    v_ids,array[]::text[],'[]'::jsonb,'00000000-0000-4000-8000-000000000611','t61-create');
  if (select count(*) from public.prebuilt_pc_component_parts where prebuilt_product_id=v_pc)<>5
    or (select components->'cpuCooler'->>'label' from public.prebuilt_pc_specs where product_id=v_pc) is null
    or (select price_tax_included_yen from public.products where id=v_pc)<>99999
    or (select on_hand from public.inventory where product_id=v_cpu) is distinct from v_before then
    raise exception 'selected parts, independent PC price, or part stock changed incorrectly';
  end if;
  v_failed:=false;
  begin
    perform public.admin_save_prebuilt_pc_v2(v_pc,0,
      '{"slug":"t61-part-selected-pc","sku":"T61-PC","name":"Should not persist","brand":"T61 Fixture","status":"draft"}'::jsonb,
      jsonb_set(v_ids,'{cpu}',to_jsonb(v_gpu)),array[]::text[],'[]'::jsonb,
      '00000000-0000-4000-8000-000000000611','t61-wrong-category');
  exception when check_violation then v_failed:=true; end;
  if not v_failed or (select name from public.products where id=v_pc)<>'T61 Selected PC' then
    raise exception 'wrong-category part was accepted or update was partial';
  end if;
  v_failed:=false;
  begin
    perform public.admin_save_prebuilt_pc_v2(v_pc,5,
      '{"slug":"t61-part-selected-pc","sku":"T61-PC","name":"Should not persist","brand":"T61 Fixture","status":"draft"}'::jsonb,
      v_ids,array[]::text[],'[]'::jsonb,'00000000-0000-4000-8000-000000000611','t61-stale');
  exception when sqlstate 'P0001' then v_failed:=true; end;
  if not v_failed or (select name from public.products where id=v_pc)<>'T61 Selected PC' then
    raise exception 'stale save was accepted or update was partial';
  end if;
  if (select components->'cpu'->>'label' from public.prebuilt_pc_specs where product_id=v_legacy) <> 'Demo CPU G1'
     or exists(select 1 from public.prebuilt_pc_component_parts where prebuilt_product_id=v_legacy) then
    raise exception 'legacy published configuration changed';
  end if;
  v_failed:=false;
  begin
    perform public.admin_save_prebuilt_pc_v2(v_legacy,(select version from public.products where id=v_legacy),
      '{"slug":"demo-gaming-pc-01","sku":"ECD-GAME-01","name":"Should not persist","brand":"ECsite Demo Build","status":"draft"}'::jsonb,
      null,array[]::text[],'[]'::jsonb,'00000000-0000-4000-8000-000000000611','t61-legacy-no-selection');
  exception when check_violation then v_failed:=true; end;
  if not v_failed or (select name from public.products where id=v_legacy)='Should not persist' then
    raise exception 'legacy update without reselection was accepted';
  end if;
  -- A published PC can expose only references whose single parts remain published.
  insert into public.prebuilt_pc_component_parts(prebuilt_product_id,slot,part_product_id) values (v_legacy,'cpu',v_cpu);
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  if (select count(*) from public.prebuilt_pc_component_parts)<>1 then
    raise exception 'public reference visibility leaked a draft PC or hid a published reference';
  end if;
  begin
    insert into public.prebuilt_pc_component_parts(prebuilt_product_id,slot,part_product_id)
      values ('00000000-0000-4000-8000-000000000612','gpu','00000000-0000-4000-8000-000000000612');
    raise exception 'anon directly inserted reference';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
