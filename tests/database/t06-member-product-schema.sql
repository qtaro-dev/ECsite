\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000061','authenticated','authenticated','t06-user@example.test',now(),now());

insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street,is_default)
values ('00000000-0000-0000-0000-000000000061','Test User','1000001',13,'千代田区','千代田1-1',true);

do $$ begin
  insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street,is_default)
  values ('00000000-0000-0000-0000-000000000061','Second','1000001',13,'千代田区','千代田1-2',true);
  if (select count(*) from public.addresses where user_id='00000000-0000-0000-0000-000000000061' and is_default) <> 1
     or not exists(select 1 from public.addresses where user_id='00000000-0000-0000-0000-000000000061' and recipient_name='Second' and is_default)
     or exists(select 1 from public.addresses where user_id='00000000-0000-0000-0000-000000000061' and recipient_name='Test User' and is_default) then
    raise exception 'new default address was not selected atomically';
  end if;

  begin
    insert into public.products(category_id,slug,sku,name,brand,price_tax_included_yen)
    values ((select id from public.categories where slug='cpu'),'negative','negative','Negative','Maker',-1);
    raise exception 'expected negative product price to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.products(category_id,slug,sku,name,brand,tax_rate_basis_points)
    values ((select id from public.categories where slug='cpu'),'wrong-tax','wrong-tax','Tax','Maker',800);
    raise exception 'expected non-standard tax rate to fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.addresses(user_id,recipient_name,postal_code,prefecture_code,city,street)
    values ('00000000-0000-0000-0000-000000000099','No User','1000001',13,'千代田区','千代田1-1');
    raise exception 'expected address owner foreign key to fail';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Incomplete drafts are valid and can omit shipping data.
insert into public.products(category_id,slug,sku,name,brand)
values ((select id from public.categories where slug='cpu'),'t06-draft','T06-DRAFT','Draft','Maker');
do $$ begin
  begin
    update public.products set status='published' where slug='t06-draft';
    raise exception 'expected incomplete product publication to fail';
  exception when check_violation then null;
  end;
end $$;

insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ((select id from public.categories where slug='cpu'),'t06-cpu','T06-CPU','Test CPU','Maker','Desc','Note',10000,500,100,100,50);

do $$ begin
  begin
    insert into public.gpu_specs(product_id,chipset,vram_gb)
    values ((select id from public.products where slug='t06-cpu'),'Wrong category',8);
    raise exception 'expected category/spec mismatch to fail';
  exception when check_violation then null;
  end;
end $$;

insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
values ((select id from public.products where slug='t06-cpu'),null,null,null,null);
insert into public.product_images(product_id,storage_path,alt_text)
values ((select id from public.products where slug='t06-cpu'),'t06/test-cpu.jpg','Test CPU');
update public.products set status='published' where slug='t06-cpu';

do $$ begin
  begin
    delete from public.product_images where product_id=(select id from public.products where slug='t06-cpu');
    raise exception 'expected final image deletion for published product to fail';
  exception when check_violation then null;
  end;
  begin
    delete from public.cpu_specs where product_id=(select id from public.products where slug='t06-cpu');
    raise exception 'expected published specification deletion to fail';
  exception when check_violation then null;
  end;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='products_search_trgm_idx') then
    raise exception 'missing product search index';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='addresses' and c.relrowsecurity) then
    raise exception 'RLS not enabled for addresses';
  end if;
  if (select count(*) from public.categories) <> 8 then raise exception 'expected eight categories'; end if;
  if (select array_agg(slug order by sort_order) from public.categories) <>
     array['cpu','gpu','motherboard','memory','ssd','power-supply','pc-case','cpu-cooler']::text[] then
    raise exception 'category slugs do not match public routes';
  end if;
end $$;

rollback;
