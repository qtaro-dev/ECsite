\set ON_ERROR_STOP on
begin;

-- Add an isolated 25-row tie case to verify a full page, the next page, and stable ID tie-breaks.
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,status,created_at)
select c.id,format('t13-page-%s',lpad(n::text,2,'0')),format('T13-PAGE-%s',lpad(n::text,2,'0')),
  format('T13 page product %s',n),'T13 Fixture','Synthetic local search fixture','Synthetic local search fixture',
  12000,500,300,200,100,'draft','2026-01-01 00:00:00+00'
from generate_series(1,25) n cross join public.categories c where c.slug='cpu';
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,'T13',8,3000,65 from public.products where slug like 't13-page-%';
insert into public.product_images(product_id,storage_path,alt_text,sort_order)
select id,slug||'.png','Synthetic local search fixture',0 from public.products where slug like 't13-page-%';
update public.products set status='published' where slug like 't13-page-%';
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,status)
select c.id,'t13-draft','T13-DRAFT','T13 page unpublished','T13 Fixture','','','draft' from public.categories c where c.slug='cpu';
insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,status)
select c.id,'t13-hidden','T13-HIDDEN','T13 page unpublished','T13 Fixture','','','hidden' from public.categories c where c.slug='cpu';

-- The database contract is exercised against the deterministic T11 fixture set.
do $$ declare result record; first_page jsonb; begin
  select * into result from public.search_published_products(
    search_q => 'T11 Test', category_slug => 'cpu', usage_case => null,
    manufacturer => 'Fixture', min_price => 9999, max_price => 9999,
    spec_filter => '{"socket_code":"AM5"}'::jsonb, sort_order => 'price_asc', page_number => 1
  );
  if result.total <> 1 or jsonb_array_length(result.items) <> 1 then
    raise exception 'T13 combined filters did not return the matching published CPU';
  end if;
  if result.items->0->>'slug' <> 't11-cpu-am5' or result.items->0->'specifications'->>'socket_code' <> 'AM5' then
    raise exception 'T13 product projection or exact spec filter is incorrect';
  end if;
  select * into result from public.search_published_products(search_q => 'no-such-product');
  if result.total <> 0 or result.items <> '[]'::jsonb then raise exception 'T13 empty result must be represented as zero items and total'; end if;
  select * into result from public.search_published_products(search_q => 'T13 page', sort_order => 'price_asc', page_number => 1);
  if result.total <> 25 or jsonb_array_length(result.items) <> 24 then raise exception 'T13 first search page must contain 24 of 25 results'; end if;
  first_page := result.items;
  if result.items <> (select items from public.search_published_products(search_q => 'T13 page', sort_order => 'price_asc', page_number => 1)) then
    raise exception 'T13 repeated pagination order is not stable';
  end if;
  select * into result from public.search_published_products(search_q => 'T13 page', sort_order => 'price_asc', page_number => 2);
  if result.total <> 25 or jsonb_array_length(result.items) <> 1 then raise exception 'T13 second search page must contain the final row'; end if;
  if exists(select 1 from jsonb_array_elements(first_page) f(item) cross join jsonb_array_elements(result.items) s(item)
    where f.item->>'id'=s.item->>'id') then raise exception 'T13 consecutive pages overlap'; end if;
end $$;

-- Anonymous execution must preserve the same published-only RLS boundary.
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ declare result record; begin
  select * into result from public.search_published_products(search_q => 'T11 Test');
  if result.total <> 18 or jsonb_array_length(result.items) <> 18 then
    raise exception 'T13 anon search did not expose exactly the 18 published fixtures';
  end if;
  if not has_function_privilege(current_user,
      'public.search_published_products(text,text,text,text,integer,integer,jsonb,text,integer)', 'EXECUTE') then
    raise exception 'T13 anon role cannot execute public product search';
  end if;
end $$;
reset role;
rollback;
