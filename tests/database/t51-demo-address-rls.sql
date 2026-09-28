\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000511','authenticated','authenticated',now(),now()),
 ('00000000-0000-0000-0000-000000000512','authenticated','authenticated',now(),now()),
 ('00000000-0000-0000-0000-000000000513','authenticated','authenticated',now(),now());
insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street) values
 ('00000000-0000-0000-0000-000000000511','デモ購入者','0000000',13,'架空市','デモ専用1番地'),
 ('00000000-0000-0000-0000-000000000512','デモ購入者','0000000',1,'架空市','デモ専用1番地');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000511',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000511","role":"authenticated","is_anonymous":true}',true);
do $$ declare affected integer; begin
  if (select count(*) from public.addresses) <> 1 then raise exception 'demo A saw another address'; end if;
  begin
    insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
      values ('00000000-0000-0000-0000-000000000511','実名','1000001',13,'実在市','実住所');
    raise exception 'demo inserted free-form address';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
      values ('00000000-0000-0000-0000-000000000511','デモ購入者','0000000',13,'架空市','デモ専用1番地');
    raise exception 'demo directly inserted fixture';
  exception when insufficient_privilege then null; end;
  update public.addresses set recipient_name = '実名';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'demo updated address'; end if;
  delete from public.addresses;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'demo deleted address'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000512',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000512","role":"authenticated","is_anonymous":true}',true);
do $$ begin
  if (select count(*) from public.addresses) <> 1 then raise exception 'demo B saw another address'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000513',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000513","role":"authenticated","is_anonymous":false}',true);
insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
  values ('00000000-0000-0000-0000-000000000513','通常会員','1000001',13,'千代田区','千代田1-1');
do $$ begin
  if (select count(*) from public.addresses) <> 1 then raise exception 'normal member address regression'; end if;
end $$;
reset role;
rollback;
