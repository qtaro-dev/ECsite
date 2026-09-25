-- T09: publish-only catalog reads, a narrow availability projection, and private image storage.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_active_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_memberships m
    where m.user_id = (select auth.uid()) and m.revoked_at is null);
$$;
revoke all on function private.is_active_admin() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_active_admin() to authenticated;

create policy categories_public_read on public.categories for select to anon, authenticated using (true);
create policy products_public_read on public.products for select to anon, authenticated
  using (status = 'published' and deleted_at is null);
create policy product_use_cases_public_read on public.product_use_cases for select to anon, authenticated using (exists (
  select 1 from public.products p where p.id=product_id and p.status='published' and p.deleted_at is null));
create policy product_images_public_read on public.product_images for select to anon, authenticated using (exists (
  select 1 from public.products p where p.id=product_id and p.status='published' and p.deleted_at is null));

-- Admin read for catalog review; T10 owns non-catalog admin policies.
create policy categories_admin_read on public.categories for select to authenticated using (private.is_active_admin());
create policy products_admin_read on public.products for select to authenticated using (private.is_active_admin());
create policy product_use_cases_admin_read on public.product_use_cases for select to authenticated using (private.is_active_admin());
create policy product_images_admin_read on public.product_images for select to authenticated using (private.is_active_admin());

do $$ declare t text; begin
  foreach t in array array['cpu_specs','gpu_specs','motherboard_specs','memory_specs','ssd_specs','psu_specs','case_specs','cooler_specs'] loop
    execute format('create policy %I on public.%I for select to anon, authenticated using (exists (select 1 from public.products p where p.id=product_id and p.status=''published'' and p.deleted_at is null))', t||'_public_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_admin())', t||'_admin_read',t);
  end loop;
end $$;

revoke select on public.categories, public.products, public.product_use_cases, public.product_images,
  public.cpu_specs, public.gpu_specs, public.motherboard_specs, public.memory_specs,
  public.ssd_specs, public.psu_specs, public.case_specs, public.cooler_specs
  from public, anon, authenticated;

grant select on public.categories to anon, authenticated;
grant select (id,category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,
  tax_rate_basis_points,status,deleted_at,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,created_at,updated_at)
  on public.products to anon, authenticated;
grant select on public.product_use_cases, public.product_images,
  public.cpu_specs, public.gpu_specs, public.motherboard_specs, public.memory_specs,
  public.ssd_specs, public.psu_specs, public.case_specs, public.cooler_specs to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.categories, public.products,
  public.product_use_cases, public.product_images, public.cpu_specs, public.gpu_specs,
  public.motherboard_specs, public.memory_specs, public.ssd_specs, public.psu_specs,
  public.case_specs, public.cooler_specs from anon, authenticated;

-- Inventory internals have no direct browser privilege; T10 may add its scoped admin policy/grant.
revoke all on public.inventory from public, anon, authenticated;

-- Owner-executed barrier view exposes only sellable availability for published products.
create view public.available_inventory with (security_barrier = true) as
select p.id as product_id,
       coalesce(i.on_hand-i.allocated,0)::integer as available_quantity,
       case when coalesce(i.on_hand-i.allocated,0)>0 then 'available' else 'sold_out' end::text as availability_status
from public.products p left join public.inventory i on i.product_id=p.id
where p.status='published' and p.deleted_at is null;
comment on view public.available_inventory is 'Published active products and sellable quantity/status only; omits inventory internals.';
revoke all on public.available_inventory from public, anon, authenticated;
grant select on public.available_inventory to anon, authenticated;

-- Public buckets skip Storage RLS during delivery. This bucket must remain private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',false,10485760,array['image/jpeg','image/png','image/webp']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy product_images_object_read_published on storage.objects for select to anon, authenticated
using(bucket_id='product-images' and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated']) and exists(
  select 1 from public.product_images i join public.products p on p.id=i.product_id
  where i.storage_path=name and p.status='published' and p.deleted_at is null));
create policy product_images_object_admin_read on storage.objects for select to authenticated
using(bucket_id='product-images' and private.is_active_admin());
create policy product_images_object_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='product-images' and private.is_active_admin());
create policy product_images_object_admin_update on storage.objects for update to authenticated
using(bucket_id='product-images' and private.is_active_admin())
with check(bucket_id='product-images' and private.is_active_admin());
create policy product_images_object_admin_delete on storage.objects for delete to authenticated
using(bucket_id='product-images' and private.is_active_admin());
