\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000501','authenticated','authenticated',now(),now()),
 ('00000000-0000-0000-0000-000000000502','authenticated','authenticated',now(),now());
insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street) values
 ('00000000-0000-0000-0000-000000000501','デモA','1000001',13,'千代田区','架空1'),
 ('00000000-0000-0000-0000-000000000502','デモB','1000001',13,'千代田区','架空2');
insert into public.carts(user_id) values
 ('00000000-0000-0000-0000-000000000501'),('00000000-0000-0000-0000-000000000502');
-- Even an accidental membership must not promote an anonymous user.
insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000501');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated","is_anonymous":true}',true);
do $$ begin
  if (select count(*) from public.addresses) <> 1 or (select count(*) from public.carts) <> 1 then raise exception 'demo A ownership read failed'; end if;
  if private.is_active_admin() then raise exception 'anonymous demo gained admin access'; end if;
  if (select count(*) from public.shipping_settings) <> 0 or (select count(*) from public.audit_logs) <> 0 then raise exception 'demo read admin records'; end if;
  begin
    insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000502');
    raise exception 'demo self-promotion succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000502','X','1000001',13,'X','X');
    raise exception 'demo wrote another address';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000502',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated","is_anonymous":true}',true);
do $$ begin
  if (select count(*) from public.addresses) <> 1 or (select count(*) from public.carts) <> 1 then raise exception 'demo B ownership read failed'; end if;
  if private.is_active_admin() then raise exception 'demo B admin access'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000501',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if not private.is_active_admin() then raise exception 'non-anonymous admin denied'; end if;
end $$;
reset role;
rollback;
