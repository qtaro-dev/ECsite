\set ON_ERROR_STOP on
begin;

-- Fixtures include all visibility states, a deleted published row, and separate users.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('00000000-0000-0000-0000-000000000091','authenticated','authenticated','t09-a@example.test',now(),now()),
('00000000-0000-0000-0000-000000000092','authenticated','authenticated','t09-b@example.test',now(),now()),
('00000000-0000-0000-0000-000000000093','authenticated','authenticated','t09-admin@example.test',now(),now());
insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000093');
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,status)
select id,'t09-'||s,'T09-'||upper(s),'T09 '||s,'T09 maker','Description','Note',1000,500,100,100,50,'draft'
from public.categories cross join (values('published','published'),('draft','draft'),('hidden','hidden'),('deleted','published')) x(s,st)
where categories.slug='cpu';
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,'T09',4,3000,65 from public.products where slug like 't09-%';
insert into public.product_images(product_id,storage_path,alt_text)
select id,'t09/'||slug||'.jpg','T09 image' from public.products where slug like 't09-%';
update public.products set status='published' where slug in ('t09-published','t09-deleted');
update public.products set status='hidden' where slug='t09-hidden';
update public.products set status='hidden', deleted_at=now() where slug='t09-deleted';
insert into public.inventory(product_id,on_hand,allocated)
select id,5,2 from public.products where slug='t09-published';

-- Anon sees only active published catalog rows; deleted fixture is hidden and soft-deleted.
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ begin
  if (select count(*) from public.products where slug like 't09-%') <> 1 then raise exception 'anon product filter leaked non-published/deleted rows'; end if;
  if (select count(*) from public.cpu_specs s join public.products p on p.id=s.product_id where p.slug like 't09-%') <> 1 then raise exception 'anon spec filter leaked'; end if;
  if (select count(*) from public.product_images i join public.products p on p.id=i.product_id where p.slug like 't09-%') <> 1 then raise exception 'anon image metadata filter leaked'; end if;
  if (select available_quantity from public.available_inventory v join public.products p on p.id=v.product_id where p.slug='t09-published') <> 3 then raise exception 'availability projection mismatch'; end if;
  if (select count(*) from public.available_inventory v join public.products p on p.id=v.product_id where p.slug like 't09-%') <> 1 then raise exception 'availability view leaked hidden/draft/deleted rows'; end if;
end $$;
do $$ begin
  begin update public.products set name='attacker' where slug='t09-published'; raise exception 'anon UPDATE unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin insert into public.products(category_id,slug,sku,name,brand) values ((select id from public.categories where slug='cpu'),'t09-insert','T09-I','x','x'); raise exception 'anon INSERT unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin delete from public.product_images where storage_path='t09/t09-published.jpg'; raise exception 'anon DELETE unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  if has_table_privilege(current_user,'public.inventory','SELECT') then raise exception 'anon inventory SELECT grant exists'; end if;
  begin perform on_hand from public.inventory limit 1; raise exception 'inventory internals unexpectedly readable'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Member A/B receive the same public catalog view and no write or private inventory access.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000091',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000091","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.products where slug like 't09-%') <> 1 then raise exception 'member A product filter leaked'; end if;
  if has_table_privilege(current_user,'public.products','INSERT') or has_table_privilege(current_user,'public.products','UPDATE') or has_table_privilege(current_user,'public.products','DELETE') then raise exception 'member A catalog write privilege exists'; end if;
  if (select count(*) from public.inventory) <> 0 then raise exception 'member A can read internal inventory'; end if;
  begin update public.products set name='attacker' where slug='t09-published'; raise exception 'member UPDATE unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects(bucket_id,name) values ('product-images','t09/member-upload.jpg'); raise exception 'member Storage INSERT unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000092',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000092","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.products where slug like 't09-%') <> 1 then raise exception 'member B product filter leaked'; end if;
  if has_table_privilege(current_user,'public.products','INSERT') or has_table_privilege(current_user,'public.products','UPDATE') or has_table_privilege(current_user,'public.products','DELETE') then raise exception 'member B catalog write privilege exists'; end if;
  if (select count(*) from public.inventory) <> 0 then raise exception 'member B can read internal inventory'; end if;
  begin delete from public.product_images where storage_path='t09/t09-published.jpg'; raise exception 'member DELETE unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;

-- Admin sees catalog drafts; Storage CRUD is tested through its API in t09-storage-http.py.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000093',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000093","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.products where slug like 't09-%') <> 4 then raise exception 'admin cannot read all catalog states'; end if;
  if (select count(*) from public.inventory i join public.products p on p.id=i.product_id where p.slug='t09-published') <> 1 then raise exception 'admin cannot read inventory internals'; end if;
  if has_table_privilege(current_user,'public.products','INSERT') or has_table_privilege(current_user,'public.products','UPDATE') or has_table_privilege(current_user,'public.products','DELETE') then raise exception 'admin must use the server catalog write path'; end if;
  if not private.is_active_admin() then raise exception 'admin membership helper denied active admin'; end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_images_object_admin_insert') or
     not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_images_object_admin_read') or
     not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_images_object_admin_update') or
     not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_images_object_admin_delete') then
    raise exception 'missing admin Storage policy';
  end if;
end $$;
reset role;

-- Anonymous and member identities cannot upload into the private product bucket.
set local role anon;
do $$ begin
  begin insert into storage.objects(bucket_id,name) values ('product-images','t09/anon-upload.jpg'); raise exception 'anon Storage INSERT unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end $$;
rollback;
