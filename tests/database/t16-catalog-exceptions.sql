\set ON_ERROR_STOP on
begin;

insert into public.products(category_id,slug,sku,name,brand,status)
select id,'t16-draft','T16-DRAFT','T16 hidden boundary draft','T16 Fixture','draft'
from public.categories where slug='cpu';
insert into public.products(category_id,slug,sku,name,brand,status)
select id,'t16-hidden','T16-HIDDEN','T16 hidden boundary product','T16 Fixture','hidden'
from public.categories where slug='cpu';

do $$
declare
  target_id uuid;
  detail jsonb;
  result record;
begin
  select id into target_id from public.products where slug='t11-cpu-am5' and status='published';
  if target_id is null then raise exception 'T16 published fixture is missing'; end if;

  -- Published prices stay editable when complete and must immediately reach both projections.
  update public.products set price_tax_included_yen=12999 where id=target_id;
  detail := public.get_published_product_detail('t11-cpu-am5');
  if detail->>'priceYen' <> '12999' then raise exception 'T16 detail did not reflect the current price'; end if;
  select * into result from public.search_published_products(search_q=>'T11 Test CPU AM5');
  if result.total <> 1 or result.items->0->>'priceYen' <> '12999' then
    raise exception 'T16 search did not reflect the current price';
  end if;

  -- Required values cannot be removed after publication. A later complete edit remains valid.
  begin
    update public.products set price_tax_included_yen=null where id=target_id;
    raise exception 'T16 accepted a published product without a price';
  exception when check_violation then null;
  end;
  begin
    update public.products set weight_g=null where id=target_id;
    raise exception 'T16 accepted a published product without a weight';
  exception when check_violation then null;
  end;
  begin
    update public.products set pack_length_mm=null where id=target_id;
    raise exception 'T16 accepted a published product without package dimensions';
  exception when check_violation then null;
  end;
  update public.products set price_tax_included_yen=13999 where id=target_id;

  -- Hiding removes the product from both public projections; republishing restores it.
  update public.products set status='hidden' where id=target_id;
  if public.get_published_product_detail('t11-cpu-am5') is not null then
    raise exception 'T16 detail exposed a hidden product';
  end if;
  select * into result from public.search_published_products(search_q=>'T11 Test CPU AM5');
  if result.total <> 0 or result.items <> '[]'::jsonb then raise exception 'T16 search exposed a hidden product'; end if;
end $$;

set local role anon;
do $$
declare result record;
begin
  select * into result from public.search_published_products(search_q=>'T11 Test CPU AM5');
  if result.total <> 0 or result.items <> '[]'::jsonb then raise exception 'T16 anonymous search exposed a hidden product'; end if;
  if public.get_published_product_detail('t11-cpu-am5') is not null then
    raise exception 'T16 anonymous detail exposed a hidden product';
  end if;
end $$;
reset role;

update public.products set status='published' where slug='t11-cpu-am5';
do $$ begin
  if public.get_published_product_detail('t11-cpu-am5')->>'priceYen' <> '13999' then
    raise exception 'T16 republished product did not return the current price';
  end if;
end $$;

set local role anon;
do $$
declare result record;
begin
  select * into result from public.search_published_products(search_q=>'T11 Test CPU AM5');
  if result.total <> 1 or result.items->0->>'priceYen' <> '13999' then
    raise exception 'T16 anonymous search did not return the republished current product';
  end if;
  if public.get_published_product_detail('t11-cpu-am5')->>'priceYen' <> '13999' then
    raise exception 'T16 anonymous detail did not return the republished current product';
  end if;
  if public.get_published_product_detail('t16-hidden') is not null or
     public.get_published_product_detail('t16-draft') is not null then
    raise exception 'T16 anonymous detail exposed a non-published product';
  end if;
end $$;
reset role;

rollback;
select 'T16 catalog exception and publication regression checks passed' as result;
