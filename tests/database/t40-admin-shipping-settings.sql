\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000401','authenticated','authenticated','t40-admin@example.test',now(),now()),
 ('00000000-0000-0000-0000-000000000402','authenticated','authenticated','t40-member@example.test',now(),now());
insert into public.admin_memberships(user_id,granted_by)
values ('00000000-0000-0000-0000-000000000401',null);

insert into public.orders(user_id,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
 tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
select '00000000-0000-0000-0000-000000000401',5000,940,0,940,540,5940,s.version,
  jsonb_build_object('origin_prefecture_code',s.origin_prefecture_code,'shipping_base_yen',s.base_fee_yen),
  '{"postal_code":"1000001"}'::jsonb,'00000000-0000-0000-0000-000000000410'
from public.shipping_settings s where s.is_active;

do $$ begin
  if has_function_privilege('anon',
    'public.admin_update_shipping_settings(text,smallint,integer,integer,integer,jsonb,text,timestamp with time zone,uuid,text)','EXECUTE') then
    raise exception 'anonymous role must not execute shipping update RPC';
  end if;
  if has_function_privilege('authenticated',
    'public.admin_update_shipping_settings(text,smallint,integer,integer,integer,jsonb,text,timestamp with time zone,uuid,text)','EXECUTE') then
    raise exception 'authenticated role must not execute shipping update RPC';
  end if;
  if not has_function_privilege('service_role',
    'public.admin_update_shipping_settings(text,smallint,integer,integer,integer,jsonb,text,timestamp with time zone,uuid,text)','EXECUTE') then
    raise exception 'server service role must execute shipping update RPC';
  end if;
  if has_table_privilege('authenticated','public.shipping_settings','UPDATE') then
    raise exception 'authenticated role must not update shipping versions directly';
  end if;
end $$;

set local role service_role;
do $$
declare v_expected text;
begin
  select version into v_expected from public.shipping_settings where is_active;
  perform public.admin_update_shipping_settings(
    v_expected,13,950,10000,20000,
    '{"rates":[{"originPrefectureCode":13,"destinationPrefectureCode":13,"sizeCode":160,"feeYen":2500}]}'::jsonb,
    'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',now(),
    '00000000-0000-0000-0000-000000000401','t40-update-001'
  );
end $$;
reset role;

do $$
declare v_new public.shipping_settings%rowtype; v_old public.shipping_settings%rowtype; v_expected text;
begin
  select * into v_new from public.shipping_settings where is_active;
  select * into v_old from public.shipping_settings where version='initial-v1';
  if v_new.id is null or v_new.version='initial-v1' or not v_new.version like 'shipping-%' then
    raise exception 'shipping update must create a new version';
  end if;
  if v_old.id is null or v_old.is_active or v_old.base_fee_yen<>940 or v_old.heavy_rule_json<>'{}'::jsonb then
    raise exception 'previous settings version must remain unchanged and inactive';
  end if;
  if v_new.base_fee_yen<>950 or v_new.free_threshold_yen<>10000 or v_new.heavy_threshold_g<>20000
    or jsonb_array_length(v_new.heavy_rule_json->'rates')<>1 then
    raise exception 'new active settings do not match the submitted configuration';
  end if;
  if not exists(select 1 from public.audit_logs where request_id='t40-update-001'
    and actor_id='00000000-0000-0000-0000-000000000401'
    and action='shipping.settings.updated' and entity_type='shipping_settings'
    and entity_id=v_new.id and change_summary->'changed_fields' @> '["shipping_base_fee_yen","shipping_rate_table"]'::jsonb
    and change_summary->>'reason_code'='configuration_change') then
    raise exception 'shipping update audit entry is missing or incomplete';
  end if;
  if not exists(select 1 from public.orders where checkout_key='00000000-0000-0000-0000-000000000410'
    and shipping_rule_version='initial-v1' and shipping_base_yen=940 and origin_snapshot->>'shipping_base_yen'='940') then
    raise exception 'shipping settings update must not alter existing order snapshots';
  end if;
  select version into v_expected from public.shipping_settings where version='initial-v1';
  set_config('t40.expected_version',v_expected,true);
end $$;

set local role service_role;
do $$
declare v_expected text := current_setting('t40.expected_version'); v_actor uuid := '00000000-0000-0000-0000-000000000401'; v_conflicted boolean := false;
begin
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,20000,
      '{"rates":[]}'::jsonb,'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',null,v_actor,'t40-stale-001');
  exception when sqlstate 'P0001' then v_conflicted := true;
  end;
  if not v_conflicted then raise exception 'stale settings update should conflict'; end if;
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,20000,
      '{"rates":[]}','https://evil.example/rates',null,v_actor,'t40-url-001');
    raise exception 'non-Yamato source URL should fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,20000,
      '{"rates":[{"originPrefectureCode":13,"destinationPrefectureCode":13,"sizeCode":999,"feeYen":100}]}'::jsonb,
      'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',now(),v_actor,'t40-size-001');
    raise exception 'unsupported Yamato size should fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,20000,
      '{"rates":[{"originPrefectureCode":13,"destinationPrefectureCode":13,"sizeCode":160,"feeYen":2147483648}]}'::jsonb,
      'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',now(),v_actor,'t40-fee-001');
    raise exception 'out-of-range fee should fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,19999,'{"rates":[]}'::jsonb,
      'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',null,v_actor,'t40-weight-001');
    raise exception 'fixed 20kg threshold should not change';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_update_shipping_settings(v_expected,13,951,10000,20000,'{"rates":[]}'::jsonb,
      'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',null,
      '00000000-0000-0000-0000-000000000402','t40-nonadmin-001');
    raise exception 'non-admin actor should fail';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
do $$ begin
  if (select count(*) from public.shipping_settings) <> 0 then
    raise exception 'ordinary member must not read shipping settings';
  end if;
  begin
    update public.shipping_settings set is_active=true where version='initial-v1';
    raise exception 'ordinary member must not update shipping settings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
