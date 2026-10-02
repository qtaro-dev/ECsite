\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000581','authenticated','authenticated','t58-admin@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000582','authenticated','authenticated','t58-member@example.test',now(),now());
insert into public.admin_memberships(user_id) values ('00000000-0000-4000-8000-000000000581');

do $$ begin
  if has_function_privilege('anon','public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE')
     or has_function_privilege('service_role','public.admin_save_prebuilt_pc(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)','EXECUTE') then
    raise exception 'legacy T58 RPC must be restricted to migration owner after T61';
  end if;
  if public.valid_prebuilt_pc_components('{"cpu":{"label":"CPU","details":"spec","extra":"reject"},"gpu":{"label":"GPU","details":"spec"},"memory":{"label":"RAM","details":"spec"},"ssd":{"label":"SSD","details":"spec"}}'::jsonb) then
    raise exception 'nested component unknown key was accepted';
  end if;
  if public.valid_prebuilt_pc_components('{"cpu":"invalid","gpu":{"label":"GPU","details":"spec"},"memory":{"label":"RAM","details":"spec"},"ssd":{"label":"SSD","details":"spec"}}'::jsonb) then
    raise exception 'non-object component was accepted';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000581',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000581","role":"authenticated"}',true);
do $$ begin
  begin
    insert into public.prebuilt_pc_specs(product_id,components)
    values('00000000-0000-4000-8000-000000000580','{}'::jsonb);
    raise exception 'authenticated admin wrote prebuilt component row directly';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',null,'{}',null,'{}','[]',
      '00000000-0000-4000-8000-000000000581','t58-auth-rpc-denied');
    raise exception 'authenticated admin executed service-only RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Historical v1 RPC regression is now internal-only. The active service_role endpoint is v2.
set local role postgres;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  components jsonb := '{"cpu":{"label":"T58 CPU Original","details":"8 core synthetic"},"gpu":{"label":"T58 GPU","details":"12 GB synthetic"},"memory":{"label":"T58 memory","details":"32 GB synthetic"},"ssd":{"label":"T58 SSD","details":"1 TB synthetic"}}'::jsonb;
  revised jsonb := '{"cpu":{"label":"T58 CPU Revised Secret","details":"16 core synthetic"},"gpu":{"label":"T58 GPU","details":"12 GB synthetic"},"memory":{"label":"T58 memory","details":"32 GB synthetic"},"ssd":{"label":"T58 SSD","details":"1 TB synthetic"}}'::jsonb;
  fields jsonb := '{"slug":"t58-prebuilt","sku":"T58-PC-01","name":"T58 Synthetic PC","brand":"T58 Fixture","description":"Synthetic prebuilt system","beginner_note":"Fixture only","price_tax_included_yen":10999,"status":"published","weight_g":15000,"pack_length_mm":600,"pack_width_mm":250,"pack_height_mm":550}'::jsonb;
  image jsonb := '[{"storage_path":"00000000-0000-4000-8000-000000000580/00000000-0000-4000-8000-000000000590.png","alt_text":"Synthetic prebuilt PC","sort_order":0}]'::jsonb;
  v_version integer;
  v_conflicted boolean;
  v_snapshot jsonb;
  v_inventory_before jsonb;
begin
  perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',null,fields,components,ARRAY['gaming'],image,
    '00000000-0000-4000-8000-000000000581','t58-create-published');
  select p.version into v_version from public.products p where p.id='00000000-0000-4000-8000-000000000580';
  if v_version<>0 or not exists(select 1 from public.prebuilt_pc_specs s where s.product_id='00000000-0000-4000-8000-000000000580') then
    raise exception 'T58 create did not persist version zero and component data';
  end if;
  if exists(select 1 from public.inventory i where i.product_id='00000000-0000-4000-8000-000000000580') then
    raise exception 'T58 product save created or modified independent SKU inventory';
  end if;

  -- A saved order item keeps its component snapshot after the catalog changes.
  insert into public.orders(id,user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,grand_total_yen,
    shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
  values('00000000-0000-4000-8000-000000000583','00000000-0000-4000-8000-000000000582',10999,0,0,0,999,10999,
    't58-test','{}','{}','00000000-0000-4000-8000-000000000584');
  insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen,spec_snapshot)
  values('00000000-0000-4000-8000-000000000583','00000000-0000-4000-8000-000000000580','T58-PC-01','T58 Synthetic PC','T58 Fixture',10999,1,10999,
    jsonb_build_object('components',components));
  select i.spec_snapshot into v_snapshot from public.order_items i where i.order_id='00000000-0000-4000-8000-000000000583';

  fields := jsonb_set(jsonb_set(fields,'{name}','"T58 Revised PC"'),'{price_tax_included_yen}','11999');
  perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',0,fields,revised,ARRAY['editing'],image,
    '00000000-0000-4000-8000-000000000581','t58-update');
  select p.version into v_version from public.products p where p.id='00000000-0000-4000-8000-000000000580';
  if v_version<>1 or (select s.components from public.prebuilt_pc_specs s where s.product_id='00000000-0000-4000-8000-000000000580') is distinct from revised then
    raise exception 'T58 update did not save components and increment version';
  end if;
  if (select i.spec_snapshot from public.order_items i where i.order_id='00000000-0000-4000-8000-000000000583') is distinct from v_snapshot then
    raise exception 'T58 catalog edit changed immutable order item configuration snapshot';
  end if;
  if exists(select 1 from public.audit_logs a where a.request_id='t58-update' and a.change_summary::text like '%T58 CPU Revised Secret%')
     or not exists(select 1 from public.audit_logs a where a.request_id='t58-update'
       and a.change_summary->'changed_fields' @> '["prebuilt_pc_components","product_use_cases","product_details","price_tax_included_yen"]'::jsonb) then
    raise exception 'T58 audit recorded data values or omitted field-name markers';
  end if;

  v_conflicted:=false;
  begin
    perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',1,
      jsonb_set(fields,'{weight_g}','30001'),revised,ARRAY['gaming'],image,
      '00000000-0000-4000-8000-000000000581','t58-yamato-reject');
  exception when check_violation then v_conflicted:=true; end;
  if not v_conflicted or (select p.version from public.products p where p.id='00000000-0000-4000-8000-000000000580')<>1 then
    raise exception 'T58 published Yamato limit failure was accepted or left partial changes';
  end if;

  v_conflicted:=false;
  begin
    perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',1,fields,revised,ARRAY[]::text[],image,
      '00000000-0000-4000-8000-000000000581','t58-use-case-reject');
  exception when check_violation then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'T58 published PC without a use case was accepted'; end if;

  v_conflicted:=false;
  begin
    perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',0,fields,revised,ARRAY['gaming'],image,
      '00000000-0000-4000-8000-000000000581','t58-stale-version');
  exception when sqlstate 'P0001' then v_conflicted:=true; end;
  if not v_conflicted or (select p.version from public.products p where p.id='00000000-0000-4000-8000-000000000580')<>1 then
    raise exception 'T58 stale version did not fail atomically';
  end if;

  -- The migration's check constraint also rejects nested unknown component keys.
  v_conflicted:=false;
  begin
    update public.prebuilt_pc_specs as spec set components=jsonb_set(revised,'{cpu,unexpected}','"x"')
      where spec.product_id='00000000-0000-4000-8000-000000000580';
  exception when check_violation then v_conflicted:=true; end;
  if not v_conflicted then raise exception 'T58 DB constraint accepted unknown nested component keys'; end if;

  -- A published row can be cleared only after the RPC has moved the product to draft.
  fields := jsonb_set(fields,'{status}','"draft"');
  perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',1,fields,null,ARRAY[]::text[],image,
    '00000000-0000-4000-8000-000000000581','t58-clear-draft-components');
  if exists(select 1 from public.prebuilt_pc_specs s where s.product_id='00000000-0000-4000-8000-000000000580')
     or (select p.status from public.products p where p.id='00000000-0000-4000-8000-000000000580')<>'draft' then
    raise exception 'T58 draft config clear failed';
  end if;

  update public.admin_memberships as membership set revoked_at=now() where membership.user_id='00000000-0000-4000-8000-000000000581';
  v_conflicted:=false;
  begin
    perform public.admin_save_prebuilt_pc('00000000-0000-4000-8000-000000000580',2,
      jsonb_set(fields,'{name}','"revoked"'),null,ARRAY[]::text[],image,
      '00000000-0000-4000-8000-000000000581','t58-revoked-admin');
  exception when insufficient_privilege then v_conflicted:=true; end;
  if not v_conflicted or (select p.version from public.products p where p.id='00000000-0000-4000-8000-000000000580')<>2 then
    raise exception 'T58 revoked administrator retained RPC write access or left partial state';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  if exists(select 1 from public.audit_logs a where a.request_id in ('t58-yamato-reject','t58-use-case-reject','t58-stale-version','t58-revoked-admin')) then
    raise exception 'T58 failed requests left audit rows';
  end if;
end $$;
rollback;
