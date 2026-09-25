\set ON_ERROR_STOP on
begin;

insert into public.admin_memberships(user_id,granted_by)
select id,null from auth.users where email='t36-admin@example.test';

insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
select null,'admin_membership.granted','admin_membership',id,
  '{"changed_fields":["admin_membership"],"reason_code":"role_change"}'::jsonb,'t36-fixture-admin-grant'
from auth.users where email='t36-admin@example.test';

do $$ begin
  if (select count(*) from auth.users where email in ('t36-admin@example.test','t36-member@example.test')) <> 2 then
    raise exception 'T36 Auth fixtures must be created before applying membership fixture';
  end if;
  if not exists (select 1 from public.admin_memberships m join auth.users u on u.id=m.user_id
    where u.email='t36-admin@example.test' and m.revoked_at is null) then
    raise exception 'T36 active admin membership fixture was not created';
  end if;
  if exists (select 1 from public.admin_memberships m join auth.users u on u.id=m.user_id
    where u.email='t36-member@example.test') then
    raise exception 'T36 regular member must not receive admin membership';
  end if;
end $$;

commit;
