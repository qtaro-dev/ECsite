\set ON_ERROR_STOP on
begin;

insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
select id,'t24-hdd','T24-HDD','T24 Test HDD','Fixture Works','Synthetic HDD','Synthetic',6999,700,250,160,60
from public.categories where slug='hdd';
insert into public.hdd_specs(product_id,capacity_gb,interface,form_factor,power_w)
select id,4000,'SATA','3.5インチ',6.5 from public.products where slug='t24-hdd';
insert into public.product_images(product_id,storage_path,alt_text)
select id,'t24/t24-hdd.png','Synthetic HDD illustration' from public.products where slug='t24-hdd';
insert into public.inventory(product_id,on_hand)
select id,3 from public.products where slug='t24-hdd';
update public.products set status='published' where slug='t24-hdd';
update public.motherboard_specs set sata_port_count=2,m2_slot_count=1,m2_protocols=array['PCIe']
where product_id=(select id from public.products where slug='t11-motherboard-atx');

commit;
