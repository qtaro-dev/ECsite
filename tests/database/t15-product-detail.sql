begin;
do $$
declare detail jsonb; target_id uuid;
begin
  select id into target_id from public.products where slug='t11-motherboard-atx' and status='published';
  detail := public.get_published_product_detail('t11-motherboard-atx');
  if detail->>'sku' is null or detail->'specifications'->>'socket_code' <> 'AM5' then
    raise exception 'published product detail did not return catalog data and category specifications';
  end if;
  if detail->'images'->0->>'altText' is null then raise exception 'image alt text missing from detail'; end if;
  if detail->>'availableQuantity' <> '1' then raise exception 'published available quantity mismatch'; end if;
  if public.get_published_product_detail('t11-gpu-300')->>'availableQuantity' <> '0' then
    raise exception 'sold out product availability mismatch';
  end if;
  update public.products set status='hidden' where id=target_id;
  if public.get_published_product_detail('t11-motherboard-atx') is not null then
    raise exception 'hidden product was returned by detail function';
  end if;
  update public.products set status='published' where id=target_id;
  update public.products set status='draft' where id=target_id;
  if public.get_published_product_detail('t11-motherboard-atx') is not null then
    raise exception 'draft product was returned by detail function';
  end if;
  update public.products set status='published' where id=target_id;
end $$;

set local role anon;
do $$ begin
  if public.get_published_product_detail('t11-motherboard-atx')->'specifications'->>'socket_code' <> 'AM5' then
    raise exception 'anon cannot read published detail';
  end if;
  if public.get_published_product_detail('t11-draft') is not null or
     public.get_published_product_detail('t11-hidden') is not null then
    raise exception 'anon detail function exposed a non-published product';
  end if;
end $$;
reset role;
rollback;

select 'T15 published product detail checks passed' as result;
