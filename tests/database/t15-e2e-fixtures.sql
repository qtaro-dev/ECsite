insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,status)
select id,'t15-hidden','T15-HIDDEN','T15 hidden product','T15 Fixture','','','hidden'
from public.categories where slug='cpu'
on conflict(slug) do update set status='hidden';
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
select id,'T15',4,3000,65 from public.products where slug='t15-hidden'
on conflict(product_id) do nothing;
insert into public.product_images(product_id,storage_path,alt_text)
select id,'t11/t15-hidden.png','非公開商品のテスト画像' from public.products where slug='t15-hidden'
on conflict(storage_path) do nothing;
insert into public.inventory(product_id,on_hand,allocated)
select id,5,0 from public.products where slug='t11-cpu-am5'
on conflict(product_id) do update set on_hand=excluded.on_hand,allocated=0;
