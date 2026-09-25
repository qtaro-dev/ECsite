-- T20: expose the active SMTP settings and decrypted password only through a
-- server-only RPC. The service-role key is used only by the email Hook route.
create extension if not exists supabase_vault with schema vault;

revoke all on schema vault from public, anon, authenticated, service_role;
revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role;

create or replace function public.get_active_smtp_delivery_settings()
returns table (
  host text,
  port integer,
  tls_mode text,
  sender_address text,
  sender_name text,
  username text,
  smtp_password text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.host, s.port, s.tls_mode, s.sender_address, s.sender_name, s.username,
         secret.decrypted_secret
  from public.smtp_settings as s
  join lateral (
    select ds.decrypted_secret
    from vault.decrypted_secrets as ds
    where ds.id::text = substring(s.secret_ref from '^vault://(.+)$')
       or ds.name = substring(s.secret_ref from '^vault://(.+)$')
  ) as secret on true
  where s.is_active;
$$;

revoke all on function public.get_active_smtp_delivery_settings() from public, anon, authenticated;
grant execute on function public.get_active_smtp_delivery_settings() to service_role;

comment on function public.get_active_smtp_delivery_settings() is
  'Server-only SMTP delivery configuration. Never call from browser code or return its result to a user.';
