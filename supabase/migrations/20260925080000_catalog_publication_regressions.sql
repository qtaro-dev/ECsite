-- T16: rerun publication completeness validation when any required value changes.
-- These columns were checked by validate_product_for_publish(), but were absent
-- from the UPDATE OF trigger, so a published product could become incomplete.
drop trigger if exists products_validate_publish on public.products;
create trigger products_validate_publish
  before insert or update of status, category_id, name, brand, description, beginner_note,
    price_tax_included_yen, weight_g, pack_length_mm, pack_width_mm, pack_height_mm, deleted_at
  on public.products
  for each row execute function public.validate_product_for_publish();
