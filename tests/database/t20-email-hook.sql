\set ON_ERROR_STOP on
begin;

do $$
declare
  secret_id uuid;
  returned_password text;
begin
  -- Local/CI-only dummy secret; never use a real credential in this test.
  select vault.create_secret('t20-test-smtp-password', 't20-test-smtp-secret') into secret_id;
  insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,secret_ref,is_active)
  values ('smtp.example.test',587,'starttls','store@example.test','Store','test-user','vault://' || secret_id::text,true);

  if has_function_privilege('anon','public.get_active_smtp_delivery_settings()','EXECUTE') then
    raise exception 'anonymous must not execute the SMTP secret RPC';
  end if;
  if has_function_privilege('authenticated','public.get_active_smtp_delivery_settings()','EXECUTE') then
    raise exception 'authenticated must not execute the SMTP secret RPC';
  end if;
  if not has_function_privilege('service_role','public.get_active_smtp_delivery_settings()','EXECUTE') then
    raise exception 'service_role must execute the SMTP secret RPC';
  end if;
  -- Schema USAGE alone does not reveal data. Require browser roles to have
  -- no Vault namespace access, and test SELECT on the decrypted view below
  -- independently for every application role (including service_role).
  raise notice 'Vault ACL diagnostic: schema USAGE anon=%, authenticated=%, service_role=%; decrypted view SELECT anon=%, authenticated=%, service_role=%',
    has_schema_privilege('anon','vault','USAGE'),
    has_schema_privilege('authenticated','vault','USAGE'),
    has_schema_privilege('service_role','vault','USAGE'),
    has_table_privilege('anon','vault.decrypted_secrets','SELECT'),
    has_table_privilege('authenticated','vault.decrypted_secrets','SELECT'),
    has_table_privilege('service_role','vault.decrypted_secrets','SELECT');
  if has_schema_privilege('anon','vault','USAGE')
     or has_schema_privilege('authenticated','vault','USAGE') then
    raise exception 'browser roles must not access the Vault schema';
  end if;
  if has_table_privilege('anon','vault.decrypted_secrets','SELECT')
     or has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
     or has_table_privilege('service_role','vault.decrypted_secrets','SELECT') then
    raise exception 'application roles must not select decrypted Vault secrets directly';
  end if;
  if has_column_privilege('anon','vault.decrypted_secrets','decrypted_secret','SELECT')
     or has_column_privilege('authenticated','vault.decrypted_secrets','decrypted_secret','SELECT')
     or has_column_privilege('service_role','vault.decrypted_secrets','decrypted_secret','SELECT') then
    raise exception 'application roles must not select the decrypted_secret column directly';
  end if;

  set local role service_role;
  select smtp_password into returned_password from public.get_active_smtp_delivery_settings();
  if returned_password is distinct from 't20-test-smtp-password' then
    raise exception 'SMTP secret was not resolved from the protected Vault reference';
  end if;
end;
$$;

rollback;
