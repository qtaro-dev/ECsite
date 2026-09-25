\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000101','authenticated','authenticated','t10-a@example.test',now(),now()),
 ('00000000-0000-0000-0000-000000000102','authenticated','authenticated','t10-b@example.test',now(),now()),
 ('00000000-0000-0000-0000-000000000103','authenticated','authenticated','t10-admin@example.test',now(),now());
insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000103');
insert into public.profiles(user_id,display_name) values
 ('00000000-0000-0000-0000-000000000101','A'),('00000000-0000-0000-0000-000000000102','B');
insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
values ('00000000-0000-0000-0000-000000000101','A','1000001',13,'千代田区','A-1'),
       ('00000000-0000-0000-0000-000000000102','B','1000001',13,'千代田区','B-1');
insert into public.products(category_id,slug,sku,name,brand,price_tax_included_yen)
values ((select id from public.categories where slug='cpu'),'t10-product','T10-P','T10 Product','Maker',1000);
insert into public.inventory(product_id,on_hand,allocated)
select id,4,1 from public.products where slug='t10-product';
insert into public.carts(user_id) values
 ('00000000-0000-0000-0000-000000000101'),('00000000-0000-0000-0000-000000000102');
insert into public.cart_items(cart_id,product_id,quantity)
select c.id,p.id,1 from public.carts c cross join public.products p
where c.user_id='00000000-0000-0000-0000-000000000101' and p.slug='t10-product';
insert into public.orders(user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,
 tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,checkout_key)
values ('00000000-0000-0000-0000-000000000101','payment_pending',1000,940,0,940,176,1940,'t10-v1',
 '{"prefecture_code":13}','{"postal_code":"1000001"}','00000000-0000-0000-0000-000000000110');
insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen)
select o.id,p.id,p.sku,p.name,p.brand,1000,1,1000 from public.orders o cross join public.products p
where o.checkout_key='00000000-0000-0000-0000-000000000110' and p.slug='t10-product';
insert into public.payment_attempts(order_id,attempt_no,amount_yen,expires_at)
select id,1,1940,now()+interval '30 minutes' from public.orders where checkout_key='00000000-0000-0000-0000-000000000110';
insert into public.stock_allocations(order_id,product_id,quantity,expires_at)
select o.id,p.id,1,now()+interval '30 minutes' from public.orders o cross join public.products p
where o.checkout_key='00000000-0000-0000-0000-000000000110' and p.slug='t10-product';
insert into public.payment_events(stripe_event_id,event_type) values ('evt_t10','checkout.session.completed');
insert into public.inventory_adjustments(product_id,delta,reason,actor_id)
select id,1,'t10-test','00000000-0000-0000-0000-000000000103' from public.products where slug='t10-product';
insert into public.smtp_settings(host,port,tls_mode,sender_address,sender_name,username,secret_ref,is_active)
values ('smtp.t10.test',587,'starttls','store@example.test','Store','user','vault://t10/secret',true);
insert into public.audit_logs(actor_id,action,entity_type,change_summary)
values ('00000000-0000-0000-0000-000000000103','settings.updated','smtp_settings','{"changed_fields":["smtp_host"]}');

-- Anonymous access cannot see or mutate any member/admin table.
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','addresses','admin_memberships','carts','cart_items','orders',
    'order_items','payment_attempts','inventory','stock_allocations','payment_events','inventory_adjustments',
    'sms_challenges','shipping_settings','smtp_settings','notification_jobs','audit_logs'] loop
    begin execute format('select 1 from public.%I limit 1',table_name);
      raise exception 'anon unexpectedly has SELECT on %',table_name;
    exception when insufficient_privilege then null; end;
  end loop;
  if has_function_privilege(current_user,'private.is_active_admin()','EXECUTE') then raise exception 'anon can execute admin helper'; end if;
end $$;
reset role;

-- Member A can read/update own profile and address, but cannot cross-owner access,
-- move ownership, self-promote, or write order/cart/payment/inventory state.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
do $$ declare own_order uuid; other_address uuid; table_name text; begin
  if (select count(*) from public.profiles) <> 1 or (select display_name from public.profiles) <> 'A' then raise exception 'profile owner read failed'; end if;
  if (select count(*) from public.addresses) <> 1 then raise exception 'address owner read failed'; end if;
  if (select count(*) from public.carts) <> 1 or (select count(*) from public.cart_items) <> 1 then raise exception 'cart owner read failed'; end if;
  select id into own_order from public.orders;
  if own_order is null or (select count(*) from public.order_items) <> 1 or (select count(*) from public.payment_attempts) <> 1 then raise exception 'order child read failed'; end if;
  select id into other_address from public.addresses where user_id='00000000-0000-0000-0000-000000000102';
  if other_address is not null then raise exception 'member A read member B address'; end if;
  if (select count(*) from public.order_items where order_id='ffffffff-ffff-ffff-ffff-ffffffffffff') <> 0 then raise exception 'guessed foreign child id leaked'; end if;
  update public.profiles set display_name='A updated';
  if (select display_name from public.profiles) <> 'A updated' then raise exception 'profile update failed'; end if;
  begin update public.addresses set user_id='00000000-0000-0000-0000-000000000102'; raise exception 'address ownership transfer succeeded'; exception when insufficient_privilege then null; end;
  begin insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000102','X','1000001',13,'X','X');
    raise exception 'cross-owner address insert succeeded'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000101');
    raise exception 'member self-promotion succeeded'; exception when insufficient_privilege then null; end;
  if has_table_privilege(current_user,'public.admin_memberships','SELECT') then raise exception 'member has membership SELECT'; end if;
  foreach table_name in array array['carts','cart_items','orders','order_items','payment_attempts','inventory',
    'stock_allocations','payment_events','inventory_adjustments','shipping_settings','smtp_settings','audit_logs'] loop
    if has_table_privilege(current_user,format('public.%I',table_name),'INSERT') or
       has_table_privilege(current_user,format('public.%I',table_name),'UPDATE') or
       has_table_privilege(current_user,format('public.%I',table_name),'DELETE') then
      raise exception 'member has direct write privilege on %',table_name;
    end if;
  end loop;
  if (select count(*) from public.inventory) <> 0 or (select count(*) from public.stock_allocations) <> 0 then raise exception 'member read internal stock'; end if;
  if (select count(*) from public.smtp_settings) <> 0 or (select count(*) from public.audit_logs) <> 0 then raise exception 'member read admin records'; end if;
end $$;

-- B cannot read A's child rows by direct IDs, and empty auth.uid() denies access.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}',true);
do $$ declare table_name text; begin
  if (select count(*) from public.orders) <> 0 or (select count(*) from public.order_items) <> 0 or
     (select count(*) from public.payment_attempts) <> 0 then raise exception 'member B read member A order tree'; end if;
  if (select count(*) from public.addresses) <> 1 then raise exception 'member B address read failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
  if auth.uid() is not null and (select count(*) from public.addresses) <> 0 then raise exception 'null uid read rows'; end if;
  if auth.uid() is null and ((select count(*) from public.profiles) <> 0 or (select count(*) from public.addresses) <> 0 or
      (select count(*) from public.orders) <> 0) then raise exception 'null auth.uid() passed ownership policy'; end if;
end $$;

-- Admin can read operational order/payment/inventory/settings/audit scopes,
-- while receiving no direct mutation privilege or membership visibility.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated"}',true);
do $$ begin
  if not private.is_active_admin() then raise exception 'active admin helper denied'; end if;
  if (select count(*) from public.orders) <> 1 or (select count(*) from public.order_items) <> 1 or
     (select count(*) from public.payment_attempts) <> 1 then raise exception 'admin order read failed'; end if;
  if (select count(*) from public.inventory) <> 1 or (select count(*) from public.stock_allocations) <> 1 or
     (select count(*) from public.payment_events) <> 1 or (select count(*) from public.inventory_adjustments) <> 1 then raise exception 'admin inventory/payment read failed'; end if;
  if (select count(*) from public.smtp_settings) <> 1 or (select count(*) from public.audit_logs) <> 1 or
     (select count(*) from public.shipping_settings where version='initial-v1') <> 1 then raise exception 'admin settings/audit read failed'; end if;
  if has_table_privilege(current_user,'public.admin_memberships','SELECT') then raise exception 'admin has direct membership SELECT'; end if;
  if has_table_privilege(current_user,'public.inventory','UPDATE') or has_table_privilege(current_user,'public.orders','UPDATE') or
     has_table_privilege(current_user,'public.payment_attempts','UPDATE') then raise exception 'admin has direct mutation privilege'; end if;
end $$;
reset role;

do $$ begin
  if has_function_privilege('anon','private.is_active_admin()','EXECUTE') then raise exception 'anon can execute private helper'; end if;
  if not has_function_privilege('authenticated','private.is_active_admin()','EXECUTE') then raise exception 'authenticated helper execute missing'; end if;
  if has_function_privilege('authenticated','public.set_updated_at()','EXECUTE') then raise exception 'trigger helper exposed as RPC'; end if;
  if (select proconfig from pg_proc where oid='private.is_active_admin()'::regprocedure) <> array['search_path=""']::text[] then raise exception 'admin helper search_path is not fixed'; end if;
  if not (select prosecdef from pg_proc where oid='private.is_active_admin()'::regprocedure) then raise exception 'admin helper must be security definer'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('profiles','admin_memberships','addresses','carts','cart_items',
        'orders','order_items','stock_allocations','payment_attempts','payment_events','inventory',
        'inventory_adjustments','sms_challenges','shipping_settings','smtp_settings','notification_jobs','audit_logs')
        and c.relrowsecurity) <> 17 then raise exception 'T10 table does not have RLS enabled'; end if;
end $$;

update public.admin_memberships set revoked_at=now() where user_id='00000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated"}',true);
do $$ begin
  if private.is_active_admin() then raise exception 'revoked admin remains active'; end if;
  if (select count(*) from public.inventory) <> 0 or (select count(*) from public.orders) <> 0 then
    raise exception 'revoked admin retains admin-only read scope';
  end if;
end $$;
reset role;
rollback;
