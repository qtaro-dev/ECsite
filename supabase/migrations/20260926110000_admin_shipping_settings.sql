-- T40: append-only shipping rule versions, atomic activation, and audit.

create or replace function private.guard_shipping_settings_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'shipping settings versions are immutable' using errcode = '55000';
  end if;
  if old.is_active and not new.is_active
     and (to_jsonb(new) - 'is_active') = (to_jsonb(old) - 'is_active') then
    return new;
  end if;
  raise exception 'shipping settings versions are immutable' using errcode = '55000';
end;
$$;
revoke all on function private.guard_shipping_settings_version() from public, anon, authenticated, service_role;

create trigger shipping_settings_version_immutable
before update or delete on public.shipping_settings
for each row execute function private.guard_shipping_settings_version();

create or replace function public.admin_update_shipping_settings(
  p_expected_version text,
  p_origin_prefecture_code smallint,
  p_base_fee_yen integer,
  p_free_threshold_yen integer,
  p_heavy_threshold_g integer,
  p_heavy_rule_json jsonb,
  p_yamato_source_url text,
  p_source_checked_at timestamptz,
  p_actor_id uuid,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.shipping_settings%rowtype;
  v_new_id uuid;
  v_new_version text;
  v_rate jsonb;
  v_rate_key text;
  v_rate_keys text[] := array[]::text[];
  v_changed_fields text[] := array[]::text[];
begin
  if p_expected_version is null or btrim(p_expected_version) = ''
     or p_actor_id is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
     or p_origin_prefecture_code is null
     or p_origin_prefecture_code not between 1 and 47
     or p_base_fee_yen is null
     or p_base_fee_yen < 0 or p_free_threshold_yen < 0
     or p_free_threshold_yen is null
     or p_heavy_threshold_g is null
     or p_heavy_threshold_g <> 20000
     or p_heavy_rule_json is null
     or jsonb_typeof(p_heavy_rule_json) <> 'object'
     or not (p_heavy_rule_json ? 'rates')
     or jsonb_typeof(p_heavy_rule_json->'rates') is distinct from 'array'
     or jsonb_array_length(p_heavy_rule_json->'rates') > 17672
     or p_yamato_source_url is null
     or p_yamato_source_url !~ '^https://([a-z0-9-]+\.)*kuronekoyamato\.co\.jp(/|$)' then
    raise exception 'invalid shipping settings' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.admin_memberships m
    where m.user_id = p_actor_id and m.revoked_at is null
  ) then
    raise exception 'active administrator required' using errcode = '42501';
  end if;

  for v_rate in select value from jsonb_array_elements(p_heavy_rule_json->'rates') loop
    if jsonb_typeof(v_rate) <> 'object'
       or (case when jsonb_typeof(v_rate) = 'object'
         then (select count(*) from jsonb_object_keys(v_rate)) else 0 end) <> 4
       or not (v_rate ?& array['originPrefectureCode','destinationPrefectureCode','sizeCode','feeYen'])
       or jsonb_typeof(v_rate->'originPrefectureCode') <> 'number'
       or (v_rate->>'originPrefectureCode') !~ '^[0-9]{1,2}$'
       or (v_rate->>'originPrefectureCode')::integer not between 1 and 47
       or jsonb_typeof(v_rate->'destinationPrefectureCode') <> 'number'
       or (v_rate->>'destinationPrefectureCode') !~ '^[0-9]{1,2}$'
       or (v_rate->>'destinationPrefectureCode')::integer not between 1 and 47
       or jsonb_typeof(v_rate->'sizeCode') <> 'number'
       or (v_rate->>'sizeCode') not in ('60','80','100','120','140','160','180','200')
       or jsonb_typeof(v_rate->'feeYen') <> 'number'
       or (v_rate->>'feeYen') !~ '^[0-9]{1,10}$'
       or (v_rate->>'feeYen')::numeric > 2147483647 then
      raise exception 'invalid shipping rate row' using errcode = '22023';
    end if;
    v_rate_key := (v_rate->>'originPrefectureCode') || ':' || (v_rate->>'destinationPrefectureCode') || ':' || (v_rate->>'sizeCode');
    if v_rate_key = any(v_rate_keys) then
      raise exception 'duplicate shipping rate row' using errcode = '22023';
    end if;
    v_rate_keys := array_append(v_rate_keys, v_rate_key);
  end loop;
  if jsonb_array_length(p_heavy_rule_json->'rates') > 0 and p_source_checked_at is null then
    raise exception 'rate source review date required' using errcode = '22023';
  end if;

  select * into v_current from public.shipping_settings where is_active for update;
  if not found or v_current.version <> p_expected_version then
    raise exception 'shipping settings changed' using errcode = 'P0001';
  end if;
  if v_current.origin_prefecture_code = p_origin_prefecture_code
     and v_current.base_fee_yen = p_base_fee_yen
     and v_current.free_threshold_yen = p_free_threshold_yen
     and v_current.heavy_threshold_g = p_heavy_threshold_g
     and v_current.heavy_rule_json = p_heavy_rule_json
     and v_current.yamato_source_url = p_yamato_source_url
     and v_current.source_checked_at is not distinct from p_source_checked_at then
    raise exception 'shipping settings have no changes' using errcode = '22023';
  end if;

  if v_current.origin_prefecture_code is distinct from p_origin_prefecture_code then
    v_changed_fields := array_append(v_changed_fields, 'shipping_origin_prefecture_code');
  end if;
  if v_current.base_fee_yen is distinct from p_base_fee_yen then
    v_changed_fields := array_append(v_changed_fields, 'shipping_base_fee_yen');
  end if;
  if v_current.free_threshold_yen is distinct from p_free_threshold_yen then
    v_changed_fields := array_append(v_changed_fields, 'shipping_free_threshold_yen');
  end if;
  if v_current.heavy_threshold_g is distinct from p_heavy_threshold_g then
    v_changed_fields := array_append(v_changed_fields, 'shipping_heavy_threshold_g');
  end if;
  if v_current.heavy_rule_json is distinct from p_heavy_rule_json then
    v_changed_fields := array_append(v_changed_fields, 'shipping_rate_table');
  end if;
  if (v_current.yamato_source_url is distinct from p_yamato_source_url
      or v_current.source_checked_at is distinct from p_source_checked_at)
     and not ('shipping_rate_table' = any(v_changed_fields)) then
    v_changed_fields := array_append(v_changed_fields, 'shipping_rate_table');
  end if;

  v_new_version := 'shipping-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-' || substr(pg_catalog.gen_random_uuid()::text, 1, 8);
  update public.shipping_settings set is_active = false where id = v_current.id;
  insert into public.shipping_settings(
    version,origin_prefecture_code,base_fee_yen,free_threshold_yen,heavy_threshold_g,
    heavy_rule_json,yamato_source_url,source_checked_at,is_active,created_by
  ) values (
    v_new_version,p_origin_prefecture_code,p_base_fee_yen,p_free_threshold_yen,p_heavy_threshold_g,
    p_heavy_rule_json,p_yamato_source_url,p_source_checked_at,true,p_actor_id
  ) returning id into v_new_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
  values (
    p_actor_id,'shipping.settings.updated','shipping_settings',v_new_id,
    jsonb_build_object('changed_fields',to_jsonb(v_changed_fields),'reason_code','configuration_change'),
    p_request_id
  );
  return v_new_id;
end;
$$;

revoke all on function public.admin_update_shipping_settings(text,smallint,integer,integer,integer,jsonb,text,timestamptz,uuid,text)
  from public, anon, authenticated;
grant execute on function public.admin_update_shipping_settings(text,smallint,integer,integer,integer,jsonb,text,timestamptz,uuid,text)
  to service_role;
