\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000281','authenticated','authenticated','t28-member-a@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000282','authenticated','authenticated','t28-member-b@example.test',now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street) values
 ('00000000-0000-4000-8000-000000000283','00000000-0000-4000-8000-000000000281','T28 A','1000001',13,'千代田区','1-1'),
 ('00000000-0000-4000-8000-000000000284','00000000-0000-4000-8000-000000000282','T28 B','1000002',13,'千代田区','2-2');

do $$ begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.checkout_quotes'::regclass) then
    raise exception 'checkout_quotes must have forced RLS';
  end if;
  if has_table_privilege('anon','public.checkout_quotes','SELECT') or
     has_table_privilege('authenticated','public.checkout_quotes','SELECT') or
     has_table_privilege('anon','public.checkout_quotes','INSERT') or
     has_table_privilege('authenticated','public.checkout_quotes','INSERT') or
     has_table_privilege('authenticated','public.checkout_quote_rate_limits','SELECT') or
     has_function_privilege('anon','public.checkout_quote_rate_limit(uuid)','EXECUTE') or
     has_function_privilege('authenticated','public.checkout_quote_rate_limit(uuid)','EXECUTE') then
    raise exception 'browser roles have quote table or rate limit RPC privileges';
  end if;
end $$;

set local role anon;
do $$ begin
  begin perform public.checkout_quote_rate_limit('00000000-0000-4000-8000-000000000281');
    raise exception 'anon executed the rate limit RPC'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.checkout_quotes;
    raise exception 'anon selected quotes'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000281',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000281","role":"authenticated"}',true);
do $$ begin
  begin perform public.checkout_quote_rate_limit('00000000-0000-4000-8000-000000000281');
    raise exception 'member executed the rate limit RPC'; exception when insufficient_privilege then null; end;
  begin insert into public.checkout_quotes(user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
      shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,expires_at)
    values ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000283',
      '[{"productId":"00000000-0000-4000-8000-000000000285","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]',
      1000,940,0,176,1940,'v1',now()+interval '1 minute');
    raise exception 'member inserted a quote'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result record; i integer; begin
  for i in 1..5 loop
    select * into result from public.checkout_quote_rate_limit('00000000-0000-4000-8000-000000000281');
    if not result.allowed then raise exception 'member quote request % was rate-limited too early', i; end if;
  end loop;
  select * into result from public.checkout_quote_rate_limit('00000000-0000-4000-8000-000000000281');
  if result.allowed or result.retry_after_seconds not between 1 and 60 then
    raise exception 'sixth quote request must be rate-limited with retry guidance';
  end if;
  update public.checkout_quote_rate_limits set window_started_at=clock_timestamp()-interval '61 seconds'
    where user_id='00000000-0000-4000-8000-000000000281';
  select * into result from public.checkout_quote_rate_limit('00000000-0000-4000-8000-000000000281');
  if not result.allowed then raise exception 'expired rate limit window was not reset'; end if;
end $$;

insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
  shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,expires_at)
values ('00000000-0000-4000-8000-000000000286','00000000-0000-4000-8000-000000000281',
  '00000000-0000-4000-8000-000000000283',
  '[{"productId":"00000000-0000-4000-8000-000000000285","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]',
  1000,940,0,176,1940,'shipping-v1',now()+interval '15 minutes');
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
  shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,created_at,expires_at)
values ('00000000-0000-4000-8000-000000000287','00000000-0000-4000-8000-000000000282',
  '00000000-0000-4000-8000-000000000284',
  '[{"productId":"00000000-0000-4000-8000-000000000285","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]',
  1000,940,0,176,1940,'shipping-v1',now()-interval '20 minutes',now()-interval '5 minutes');
insert into public.checkout_quote_rate_limits(user_id,window_started_at,request_count)
values ('00000000-0000-4000-8000-000000000282',now(),1);
do $$ begin
  if not exists(select 1 from public.checkout_quotes where id='00000000-0000-4000-8000-000000000286'
    and user_id='00000000-0000-4000-8000-000000000281' and address_id='00000000-0000-4000-8000-000000000283'
    and expires_at <= created_at + interval '15 minutes') then raise exception 'server could not persist a valid expiring quote'; end if;
  if not exists(select 1 from public.checkout_quotes where id='00000000-0000-4000-8000-000000000287' and expires_at < now()) then
    raise exception 'a quote older than 15 minutes must be distinguishable as expired for T29';
  end if;
  begin
    insert into public.checkout_quotes(user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
      shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,expires_at)
    values ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000283','[]',0,0,0,0,0,'v1',now()+interval '1 minute');
    raise exception 'empty quote snapshot accepted'; exception when check_violation then null; end;
  begin
    insert into public.checkout_quotes(user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
      shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,expires_at)
    values ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000283',
      '[{"productId":"00000000-0000-4000-8000-000000000285","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]',
      1000,940,0,176,1940,'v1',now()+interval '16 minutes');
    raise exception 'quote longer than 15 minutes accepted'; exception when check_violation then null; end;
  begin
    insert into public.checkout_quotes(user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
      shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
    values ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000283','{}',0,0,0,0,0,'v1');
    raise exception 'non-array quote snapshot accepted'; exception when check_violation then null; end;
  begin
    insert into public.checkout_quotes(user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
      shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
    values ('00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000283',
      '[{"productId":"00000000-0000-4000-8000-000000000285","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}]',
      1000,0,0,0,1000,'v1');
    raise exception 'incorrect inclusive tax accepted'; exception when check_violation then null; end;
end $$;
reset role;

-- Deleting an address immediately invalidates its quote without retaining address text.
delete from public.addresses where id='00000000-0000-4000-8000-000000000283';
do $$ begin
  if exists(select 1 from public.checkout_quotes where id='00000000-0000-4000-8000-000000000286') then
    raise exception 'address deletion did not cascade to its quote';
  end if;
end $$;
delete from auth.users where id='00000000-0000-4000-8000-000000000282';
do $$ begin
  if exists(select 1 from public.checkout_quotes where id='00000000-0000-4000-8000-000000000287') or
     exists(select 1 from public.checkout_quote_rate_limits where user_id='00000000-0000-4000-8000-000000000282') then
    raise exception 'user deletion did not cascade to quote and rate-limit records';
  end if;
end $$;

rollback;
