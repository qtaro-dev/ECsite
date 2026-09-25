-- T13: public search keeps the publication boundary in SQL and returns a stable page.
create or replace function public.search_published_products(
  search_q text default null,
  category_slug text default null,
  usage_case text default null,
  manufacturer text default null,
  min_price integer default null,
  max_price integer default null,
  spec_filter jsonb default '{}'::jsonb,
  sort_order text default 'newest',
  page_number integer default 1
)
returns table(items jsonb, total bigint, page integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with catalog as (
    select p.id, p.slug, p.sku, p.name, p.brand, p.description, p.beginner_note,
      p.price_tax_included_yen, p.created_at, c.slug as category,
      coalesce((select jsonb_agg(jsonb_build_object('path',i.storage_path,'altText',i.alt_text)
        order by i.sort_order,i.id) from public.product_images i where i.product_id=p.id), '[]'::jsonb) as images,
      coalesce((select jsonb_agg(u.use_case order by u.use_case) from public.product_use_cases u where u.product_id=p.id), '[]'::jsonb) as use_cases,
      case c.slug
        when 'cpu' then (select to_jsonb(s) - 'product_id' from public.cpu_specs s where s.product_id=p.id)
        when 'gpu' then (select to_jsonb(s) - 'product_id' from public.gpu_specs s where s.product_id=p.id)
        when 'motherboard' then (select to_jsonb(s) - 'product_id' from public.motherboard_specs s where s.product_id=p.id)
        when 'memory' then (select to_jsonb(s) - 'product_id' from public.memory_specs s where s.product_id=p.id)
        when 'ssd' then (select to_jsonb(s) - 'product_id' from public.ssd_specs s where s.product_id=p.id)
        when 'power-supply' then (select to_jsonb(s) - 'product_id' from public.psu_specs s where s.product_id=p.id)
        when 'pc-case' then (select to_jsonb(s) - 'product_id' from public.case_specs s where s.product_id=p.id)
        when 'cpu-cooler' then (select to_jsonb(s) - 'product_id' from public.cooler_specs s where s.product_id=p.id)
      end as specifications
    from public.products p join public.categories c on c.id=p.category_id
    where p.status='published' and p.deleted_at is null
  ), filtered as (
    select x.* from catalog x
    where (search_q is null or (x.name || ' ' || x.brand || ' ' || x.description) operator(extensions.%) search_q
      or position(lower(search_q) in lower(x.name || ' ' || x.brand || ' ' || x.description)) > 0)
      and (category_slug is null or x.category=category_slug)
      and (usage_case is null or x.use_cases @> jsonb_build_array(usage_case))
      and (manufacturer is null or position(lower(manufacturer) in lower(x.brand)) > 0)
      and (min_price is null or x.price_tax_included_yen >= min_price)
      and (max_price is null or x.price_tax_included_yen <= max_price)
      and (spec_filter = '{}'::jsonb or x.specifications @> spec_filter)
  ), counted as (select count(*) as total from filtered), paged as (
    select f.* from filtered f
    order by
      case when sort_order='price_asc' then f.price_tax_included_yen end asc,
      case when sort_order='price_desc' then f.price_tax_included_yen end desc,
      case when sort_order='newest' then f.created_at end desc,
      f.id asc
    limit 24 offset ((page_number - 1)::bigint * 24)
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'slug',slug,'sku',sku,'name',name,'brand',brand,'category',category,
    'description',description,'beginnerNote',beginner_note,'priceYen',price_tax_included_yen,
    'images',images,'useCases',use_cases,'specifications',specifications
  ) order by
    case when sort_order='price_asc' then price_tax_included_yen end asc,
    case when sort_order='price_desc' then price_tax_included_yen end desc,
    case when sort_order='newest' then created_at end desc,
    id asc) from paged), '[]'::jsonb), counted.total, page_number from counted;
$$;

revoke all on function public.search_published_products(text,text,text,text,integer,integer,jsonb,text,integer) from public;
grant execute on function public.search_published_products(text,text,text,text,integer,integer,jsonb,text,integer) to anon, authenticated;
