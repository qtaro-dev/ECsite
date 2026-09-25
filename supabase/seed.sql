-- T11 synthetic catalog fixtures. This file is loaded by local Supabase db reset.
-- Every slug and Storage path is stable so reapplying the seed is safe.
with fixtures(slug, category_slug, sku, name, price_yen, weight_g) as (
  values
    ('t11-cpu-am5','cpu','T11-CPU-AM5','T11 Test CPU AM5',9999,19999),
    ('t11-cpu-am4','cpu','T11-CPU-AM4','T11 Test CPU AM4',9999,500),
    ('t11-cpu-unknown','cpu','T11-CPU-UNKNOWN','T11 Test CPU Unknown Socket',9999,500),
    ('t11-gpu-300','gpu','T11-GPU-300','T11 Test GPU 300 mm',10000,20000),
    ('t11-gpu-340','gpu','T11-GPU-340','T11 Test GPU 340 mm',10000,500),
    ('t11-gpu-unknown','gpu','T11-GPU-UNKNOWN','T11 Test GPU Unknown Length',10000,500),
    ('t11-motherboard-atx','motherboard','T11-MB-ATX','T11 Test AM5 ATX Motherboard',7999,500),
    ('t11-memory-ddr5','memory','T11-MEM-DDR5','T11 Test DDR5 Memory',2999,100),
    ('t11-memory-ddr4','memory','T11-MEM-DDR4','T11 Test DDR4 Memory',2999,100),
    ('t11-memory-unknown','memory','T11-MEM-UNKNOWN','T11 Test Unknown DDR Memory',2999,100),
    ('t11-ssd','ssd','T11-SSD','T11 Test SSD',4999,100),
    ('t11-psu','power-supply','T11-PSU','T11 Test Power Supply',6999,1500),
    ('t11-case-atx','pc-case','T11-CASE-ATX','T11 Test ATX Case',7999,20001),
    ('t11-case-itx','pc-case','T11-CASE-ITX','T11 Test ITX Case',7999,5000),
    ('t11-case-unknown','pc-case','T11-CASE-UNKNOWN','T11 Test Unknown Form Factor Case',7999,5000),
    ('t11-cooler-am5','cpu-cooler','T11-COOLER-AM5','T11 Test AM5 Cooler',3999,800),
    ('t11-cooler-lga','cpu-cooler','T11-COOLER-LGA','T11 Test LGA1700 Cooler',3999,800),
    ('t11-cooler-unknown','cpu-cooler','T11-COOLER-UNKNOWN','T11 Test Unknown Socket Cooler',3999,800)
), upsert_products as (
  insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,
    price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,status)
  select c.id,f.slug,f.sku,f.name,'Fixture Works',
    '合成されたローカル・テストデータです。実在製品・販売価格を示しません。',
    '互換性、送料、在庫を試すための架空の商品です。',
    f.price_yen,f.weight_g,300,200,100,'draft'
  from fixtures f join public.categories c on c.slug=f.category_slug
  on conflict(slug) do update set
    category_id=excluded.category_id,sku=excluded.sku,name=excluded.name,brand=excluded.brand,
    description=excluded.description,beginner_note=excluded.beginner_note,
    price_tax_included_yen=excluded.price_tax_included_yen,tax_rate_basis_points=1000,
    weight_g=excluded.weight_g,pack_length_mm=excluded.pack_length_mm,
    pack_width_mm=excluded.pack_width_mm,pack_height_mm=excluded.pack_height_mm,
    status='draft',deleted_at=null
  returning id,slug
)
select count(*) from upsert_products;

insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,case slug when 't11-cpu-am5' then 'AM5' when 't11-cpu-am4' then 'AM4' else null end,8,3500,95
from public.products where slug in ('t11-cpu-am5','t11-cpu-am4','t11-cpu-unknown')
on conflict(product_id) do update set socket_code=excluded.socket_code,core_count=excluded.core_count,
  base_clock_mhz=excluded.base_clock_mhz,tdp_w=excluded.tdp_w;

insert into public.gpu_specs(product_id,chipset,vram_gb,card_length_mm)
select id,'Synthetic GPU',12,case slug when 't11-gpu-300' then 300 when 't11-gpu-340' then 340 else null end
from public.products where slug in ('t11-gpu-300','t11-gpu-340','t11-gpu-unknown')
on conflict(product_id) do update set chipset=excluded.chipset,vram_gb=excluded.vram_gb,card_length_mm=excluded.card_length_mm;

insert into public.motherboard_specs(product_id,socket_code,ddr_generation,form_factor)
select id,'AM5','DDR5','ATX' from public.products where slug='t11-motherboard-atx'
on conflict(product_id) do update set socket_code=excluded.socket_code,ddr_generation=excluded.ddr_generation,form_factor=excluded.form_factor;

insert into public.memory_specs(product_id,ddr_generation,capacity_gb,module_count,speed_mt_s)
select id,case slug when 't11-memory-ddr5' then 'DDR5' when 't11-memory-ddr4' then 'DDR4' else null end,16,2,5600
from public.products where slug in ('t11-memory-ddr5','t11-memory-ddr4','t11-memory-unknown')
on conflict(product_id) do update set ddr_generation=excluded.ddr_generation,capacity_gb=excluded.capacity_gb,
  module_count=excluded.module_count,speed_mt_s=excluded.speed_mt_s;

insert into public.ssd_specs(product_id,capacity_gb,interface,form_factor)
select id,1000,'PCIe 4.0 x4','M.2 2280' from public.products where slug='t11-ssd'
on conflict(product_id) do update set capacity_gb=excluded.capacity_gb,interface=excluded.interface,form_factor=excluded.form_factor;

insert into public.psu_specs(product_id,rated_w,form_factor,efficiency_grade)
select id,750,'ATX','80 PLUS Gold' from public.products where slug='t11-psu'
on conflict(product_id) do update set rated_w=excluded.rated_w,form_factor=excluded.form_factor,efficiency_grade=excluded.efficiency_grade;

insert into public.case_specs(product_id,max_gpu_length_mm,outer_length_mm,outer_width_mm,outer_height_mm,supported_form_factors)
select id,320,450,220,460,case slug when 't11-case-atx' then array['ATX','mATX','ITX']::text[]
  when 't11-case-itx' then array['ITX']::text[] else null end
from public.products where slug in ('t11-case-atx','t11-case-itx','t11-case-unknown')
on conflict(product_id) do update set max_gpu_length_mm=excluded.max_gpu_length_mm,
  outer_length_mm=excluded.outer_length_mm,outer_width_mm=excluded.outer_width_mm,
  outer_height_mm=excluded.outer_height_mm,supported_form_factors=excluded.supported_form_factors;

insert into public.cooler_specs(product_id,supported_socket_codes,height_mm,cooling_type)
select id,case slug when 't11-cooler-am5' then array['AM5']::text[]
  when 't11-cooler-lga' then array['LGA1700']::text[] else null end,155,'air'
from public.products where slug in ('t11-cooler-am5','t11-cooler-lga','t11-cooler-unknown')
on conflict(product_id) do update set supported_socket_codes=excluded.supported_socket_codes,
  height_mm=excluded.height_mm,cooling_type=excluded.cooling_type;

insert into public.product_images(product_id,storage_path,alt_text,sort_order)
select id,'t11/'||slug||'.png','合成されたテスト用プレースホルダー画像',0
from public.products where slug like 't11-%'
on conflict(storage_path) do update set product_id=excluded.product_id,alt_text=excluded.alt_text,sort_order=excluded.sort_order;

insert into public.product_use_cases(product_id,use_case)
select id,'gaming' from public.products where slug in ('t11-cpu-am5','t11-gpu-300','t11-motherboard-atx')
on conflict do nothing;
insert into public.inventory(product_id,on_hand,allocated)
select id,case slug when 't11-gpu-300' then 0 when 't11-motherboard-atx' then 1 else 5 end,0
from public.products where slug in ('t11-gpu-300','t11-motherboard-atx')
on conflict(product_id) do update set on_hand=excluded.on_hand,allocated=0;

-- Deliberately inactive, non-official sample rates exist only to exercise parsing
-- in future tests. The active initial-v1 stays empty so missing official rates
-- continue to mean SHIPPING_UNAVAILABLE.
insert into public.shipping_settings(version,base_fee_yen,free_threshold_yen,heavy_threshold_g,
  heavy_rule_json,yamato_source_url,is_active)
values ('t11-fixture-only-v1',940,10000,20000,
  '{"fixture_only":true,"sample_fee_yen":1234,"warning":"Never use for quoting or production"}'::jsonb,
  'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',false)
-- T40 makes versions immutable. A repeated development seed must leave the
-- existing fixture version untouched rather than rewriting historical values.
on conflict(version) do nothing;

-- Publish only after synthetic specs and image metadata exist. Storage bytes are
-- uploaded separately by tests/database/t11-storage-fixtures.py after db reset.
update public.products set status='published'
where slug like 't11-%' and deleted_at is null;
