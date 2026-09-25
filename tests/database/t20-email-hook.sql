\set ON_ERROR_STOP on
begin;

do $$
declare
  secret_id uuid;
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
  if has_schema_privilege('anon','vault','USAGE')
     or has_schema_privilege('authenticated','vault','USAGE')
     or has_table_privilege('anon','vault.decrypted_secrets','SELECT')
     or has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') then
    raise exception 'browser roles must not select decrypted Vault secrets';
  end if;
  if not has_schema_privilege('service_role','vault','USAGE')
     or not has_table_privilege('service_role','vault.decrypted_secrets','SELECT') then
    raise exception 'Supabase service_role Vault view access was not preserved';
  end if;
  perform set_config('t20.test_secret_id', secret_id::text, true);
end;
$$;

set local role anon;
do $$ begin
  begin
    perform 1 from vault.decrypted_secrets limit 1;
    raise exception 'anon read the decrypted Vault view';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform 1 from vault.decrypted_secrets limit 1;
    raise exception 'authenticated read the decrypted Vault view';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Exercise the platform-provided direct service_role view permission and the
-- narrower SMTP delivery RPC using the same local dummy secret.
set local role service_role;
do $$
declare
  returned_password text;
  returned_vault_password text;
  secret_id uuid := current_setting('t20.test_secret_id')::uuid;
begin
  select decrypted_secret into returned_vault_password
  from vault.decrypted_secrets where id = secret_id;
  if returned_vault_password is distinct from 't20-test-smtp-password' then
    raise exception 'service_role could not read its standard Vault view permission';
  end if;
  select smtp_password into returned_password from public.get_active_smtp_delivery_settings();
  if returned_password is distinct from returned_vault_password then
    raise exception 'SMTP delivery RPC did not resolve the Vault password';
  end if;
end;
$$;
reset role;

rollback;
