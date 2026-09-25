\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000081','authenticated','authenticated','t08-user@example.test',now(),now());

do $$ declare sid uuid; aid uuid; begin
  select id into sid from public.shipping_settings where version = 'initial-v1';
  if sid is null then raise exception 'initial shipping settings are missing'; end if;
  if not exists(select 1 from public.shipping_settings where version='initial-v1'
      and origin_prefecture_code=13 and base_fee_yen=940 and free_threshold_yen=10000 and heavy_threshold_g=20000) then
    raise exception 'shipping defaults are incorrect';
  end if;
  if (select count(*) from public.shipping_settings where is_active) <> 1 then
    raise exception 'expected exactly one active shipping rule';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and tablename='shipping_settings'
      and indexname='shipping_settings_version_key') then raise exception 'shipping version is not unique'; end if;

  insert into public.sms_challenges(user_id,purpose,target_session_hash,code_hash,expires_at,delivery_mode)
  values ('00000000-0000-0000-0000-000000000081','register',repeat('a',64),repeat('b',64),now()+interval '5 minutes','mock');
  begin
    insert into public.sms_challenges(user_id,purpose,target_session_hash,code_hash,expires_at,delivery_mode)
    values ('00000000-0000-0000-0000-000000000081','register','plain-session-token','123456',now()+interval '5 minutes','mock');
    raise exception 'expected OTP/session plaintext shape to fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.sms_challenges(user_id,purpose,target_session_hash,code_hash,expires_at,delivery_mode,attempts)
    values ('00000000-0000-0000-0000-000000000081','reset',repeat('a',64),repeat('b',64),now()+interval '5 minutes','mock',6);
    raise exception 'expected attempts limit to fail';
  exception when check_violation then null;
  end;

  insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,secret_ref,is_active)
  values ('smtp.example.test',587,'starttls','store@example.test','Store','user','vault://smtp/current',true);
  begin
    insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,secret_ref,is_active)
    values ('smtp.example.test',587,'starttls','store@example.test','Store','user','vault://smtp/second',true);
    raise exception 'expected second active SMTP configuration to fail';
  exception when unique_violation then null;
  end;
  begin
    insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,is_active)
    values ('smtp.example.test',587,'starttls','store@example.test','Store','user',true);
    raise exception 'expected active SMTP config without secret reference to fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,secret_ref,is_active)
    values ('smtp.example.test',587,'starttls','store@example.test','Store','user','plaintext-password',false);
    raise exception 'expected plaintext credential to fail secret-ref format';
  exception when check_violation then null;
  end;

  insert into public.notification_jobs(kind,recipient_hash,payload_ref)
  values ('order_confirmation',repeat('c',64),'payload://job-1');
  begin
    insert into public.notification_jobs(kind,recipient_hash,payload_ref)
    values ('order_confirmation',repeat('d',64),'alice@example.test');
    raise exception 'expected plaintext payload to fail opaque-reference format';
  exception when check_violation then null;
  end;
  begin
    insert into public.notification_jobs(kind,recipient_hash,payload_ref,attempt_count,state)
    values ('order_confirmation',repeat('d',64),'payload://job-2',10,'retry');
    raise exception 'expected exhausted notification retry to fail';
  exception when check_violation then null;
  end;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
  values ('00000000-0000-0000-0000-000000000081','shipping.settings.updated','shipping_settings',sid,
    '{"changed_fields":["shipping_base_fee_yen"],"reason_code":"configuration_change"}','t08-request') returning id into aid;
  begin
    insert into public.audit_logs(action,entity_type,change_summary)
    values ('shipping.settings.updated','shipping_settings','{"changed_fields":["owner@example.test"]}');
    raise exception 'expected PII-like free-form field to fail allowlist';
  exception when check_violation then null;
  end;
  begin
    insert into public.audit_logs(action,entity_type,change_summary)
    values ('shipping.settings.updated','shipping_settings','{"changed_fields":[{"address":"private"}]}');
    raise exception 'expected nested audit content to fail allowlist';
  exception when check_violation then null;
  end;
  begin
    insert into public.audit_logs(action,entity_type,change_summary)
    values ('shipping.settings.updated','shipping_settings','{"changed_fields":[],"reason_code":"include_secret"}');
    raise exception 'expected free-form reason to fail allowlist';
  exception when check_violation then null;
  end;
  begin
    update public.audit_logs set action='tampered' where id=aid;
    raise exception 'expected audit update to fail';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.audit_logs where id=aid;
    raise exception 'expected audit delete to fail';
  exception when sqlstate '55000' then null;
  end;

  perform set_config('app.audit_actor_unlink','on',true);
  begin
    update public.audit_logs set actor_id=null where id=aid;
    raise exception 'expected caller-set unlink context to fail';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('app.audit_actor_unlink','off',true);

  delete from auth.users where id='00000000-0000-0000-0000-000000000081';
  if not exists(select 1 from public.audit_logs where id=aid and actor_id is null
      and action='shipping.settings.updated' and change_summary->'changed_fields' @> '["shipping_base_fee_yen"]') then
    raise exception 'user deletion must unlink actor id while preserving audit facts';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('sms_challenges','shipping_settings','smtp_settings','notification_jobs','audit_logs')
      and c.relrowsecurity) <> 5 then raise exception 'RLS is not enabled on each T08 table'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename in
      ('shipping_settings','smtp_settings','audit_logs') and policyname like '%admin_read') <> 3 then
    raise exception 'T10 administrator settings/audit read policies are missing';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in
      ('sms_challenges','notification_jobs')) then raise exception 'server-only T08 tables must not have client policies'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000082',true);
do $$ begin
  if (select count(*) from public.shipping_settings) <> 0 then raise exception 'shipping settings are directly exposed'; end if;
  if (select count(*) from public.smtp_settings) <> 0 then raise exception 'SMTP settings are directly exposed'; end if;
  if (select count(*) from public.audit_logs) <> 0 then raise exception 'audit logs are directly exposed'; end if;
end $$;

rollback;
