\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000211','authenticated','authenticated','t21-a@example.test',now(),now()),
 ('00000000-0000-0000-0000-000000000212','authenticated','authenticated','t21-b@example.test',now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,is_default)
values ('00000000-0000-0000-0000-000000000221','00000000-0000-0000-0000-000000000211','T21 A','1000001',13,'千代田区','1-1',true),
       ('00000000-0000-0000-0000-000000000222','00000000-0000-0000-0000-000000000211','T21 A2','1000002',13,'千代田区','2-2',false),
       ('00000000-0000-0000-0000-000000000223','00000000-0000-0000-0000-000000000212','T21 B','1500001',13,'渋谷区','1-1',true);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000211',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000211","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.addresses) <> 2 then raise exception 'member A does not see exactly own addresses'; end if;
  update public.addresses set is_default=true where id='00000000-0000-0000-0000-000000000222';
  if (select count(*) from public.addresses where user_id=auth.uid() and is_default) <> 1 or
     not exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000222' and is_default) or
     exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000221' and is_default) then
    raise exception 'trigger did not atomically replace default under RLS';
  end if;
  begin insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000212','forbidden','1000001',13,'X','Y');
    raise exception 'cross-owner insert succeeded'; exception when insufficient_privilege then null; end;
  begin update public.addresses set street='forbidden' where id='00000000-0000-0000-0000-000000000223';
    if exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000223' and street='forbidden') then raise exception 'cross-owner update succeeded'; end if; end;
  delete from public.addresses where id='00000000-0000-0000-0000-000000000223';
  delete from public.addresses where id='00000000-0000-0000-0000-000000000222';
  if exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000222') then raise exception 'own address delete failed'; end if;
end $$;
reset role;

do $$ begin
  if not exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000223') then raise exception 'member A deleted member B address'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000212',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000212","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.addresses) <> 1 or not exists(select 1 from public.addresses where recipient_name='T21 B') then
    raise exception 'member B cannot see exactly own address';
  end if;
  if exists(select 1 from public.addresses where id='00000000-0000-0000-0000-000000000221') then raise exception 'member B read member A address'; end if;
end $$;
reset role;

do $$ begin
  begin insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000211','Bad','100-001',13,'X','Y');
    raise exception 'malformed postal code accepted'; exception when check_violation then null; end;
  begin insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000211',repeat('x',81),'1000001',13,'X','Y');
    raise exception 'overlong recipient accepted'; exception when check_violation then null; end;
end $$;
rollback;
