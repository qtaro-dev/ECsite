\set ON_ERROR_STOP on
begin;

do $$ begin
  if has_function_privilege('anon','public.bootstrap_first_admin(uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.bootstrap_first_admin(uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.consume_admin_setup_attempt(text)','EXECUTE')
     or has_function_privilege('authenticated','public.consume_admin_setup_attempt(text)','EXECUTE') then
    raise exception 'bootstrap and rate limit RPCs must be service-role only';
  end if;
  if has_table_privilege('anon','public.admin_setup_claim','SELECT')
     or has_table_privilege('authenticated','public.admin_setup_attempts','SELECT') then
    raise exception 'bootstrap state must not be browser-readable';
  end if;
end $$;

insert into auth.users(id,aud,role,email,created_at,updated_at,is_anonymous) values
 ('00000000-0000-0000-0000-000000000561','authenticated','authenticated','t56-owner@example.test',now(),now(),false),
 ('00000000-0000-0000-0000-000000000562','authenticated','authenticated','t56-second@example.test',now(),now(),false);

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin
  if not public.bootstrap_first_admin('00000000-0000-0000-0000-000000000561','t56-first') then
    raise exception 'first admin claim should succeed';
  end if;
  if public.bootstrap_first_admin('00000000-0000-0000-0000-000000000562','t56-second') then
    raise exception 'second admin claim should fail';
  end if;
  if not exists (select 1 from public.audit_logs where action='admin_membership.granted'
    and entity_id='00000000-0000-0000-0000-000000000561'
    and change_summary='{"changed_fields":["admin_membership"],"reason_code":"role_change"}'::jsonb) then
    raise exception 'first membership grant must be audited';
  end if;
  if not public.consume_admin_setup_attempt(repeat('a',64)) then raise exception 'rate limit attempt 1 rejected'; end if;
  for i in 2..10 loop
    if not public.consume_admin_setup_attempt(repeat('a',64)) then raise exception 'rate limit closed before attempt 10'; end if;
  end loop;
  if public.consume_admin_setup_attempt(repeat('a',64)) then raise exception 'rate limit accepted attempt 11'; end if;
end $$;
reset role;

-- Deleting the first owner cascades membership rows, but the durable claim keeps setup closed.
delete from auth.users where id='00000000-0000-0000-0000-000000000561';
insert into auth.users(id,aud,role,email,created_at,updated_at,is_anonymous) values
 ('00000000-0000-0000-0000-000000000563','authenticated','authenticated','t56-after-delete@example.test',now(),now(),false);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin
  if public.bootstrap_first_admin('00000000-0000-0000-0000-000000000563','t56-after-delete') then
    raise exception 'deleted owner must not reopen first setup';
  end if;
end $$;
reset role;
rollback;
