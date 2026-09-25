-- T15: return one published product with its category specifications and sellable availability.
create or replace function public.get_published_product_detail(product_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id',p.id,'slug',p.slug,'sku',p.sku,'name',p.name,'brand',p.brand,
    'category',c.slug,'description',p.description,'beginnerNote',p.beginner_note,
    'priceYen',p.price_tax_included_yen,
    'images',coalesce((select jsonb_agg(jsonb_build_object('path',i.storage_path,'altText',i.alt_text) order by i.sort_order,i.id)
      from public.product_images i where i.product_id=p.id),'[]'::jsonb),
    'useCases',coalesce((select jsonb_agg(u.use_case order by u.use_case) from public.product_use_cases u where u.product_id=p.id),'[]'::jsonb),
    'specifications',case c.slug
      when 'cpu' then (select to_jsonb(s)-'product_id' from public.cpu_specs s where s.product_id=p.id)
      when 'gpu' then (select to_jsonb(s)-'product_id' from public.gpu_specs s where s.product_id=p.id)
      when 'motherboard' then (select to_jsonb(s)-'product_id' from public.motherboard_specs s where s.product_id=p.id)
      when 'memory' then (select to_jsonb(s)-'product_id' from public.memory_specs s where s.product_id=p.id)
      when 'ssd' then (select to_jsonb(s)-'product_id' from public.ssd_specs s where s.product_id=p.id)
      when 'power-supply' then (select to_jsonb(s)-'product_id' from public.psu_specs s where s.product_id=p.id)
      when 'pc-case' then (select to_jsonb(s)-'product_id' from public.case_specs s where s.product_id=p.id)
      when 'cpu-cooler' then (select to_jsonb(s)-'product_id' from public.cooler_specs s where s.product_id=p.id)
    end,
    'availableQuantity',coalesce(a.available_quantity,0)
  )
  from public.products p
  join public.categories c on c.id=p.category_id
  left join public.available_inventory a on a.product_id=p.id
  where p.slug=product_slug and p.status='published' and p.deleted_at is null;
$$;
revoke all on function public.get_published_product_detail(text) from public;
grant execute on function public.get_published_product_detail(text) to anon, authenticated;
