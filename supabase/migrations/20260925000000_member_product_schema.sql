create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint admin_memberships_revocation_after_grant check (revoked_at is null or revoked_at >= granted_at)
);
create index admin_memberships_active_idx on public.admin_memberships(user_id) where revoked_at is null;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_name text not null,
  postal_code char(7) not null check (postal_code ~ '^[0-9]{7}$'),
  prefecture_code smallint not null check (prefecture_code between 1 and 47),
  city text not null,
  street text not null,
  building text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_created_idx on public.addresses(user_id, created_at desc);
create unique index addresses_one_default_per_user_idx on public.addresses(user_id) where is_default;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order smallint not null unique check (sort_order between 1 and 8)
);
insert into public.categories(slug,name,sort_order) values
  ('cpu','CPU',1),('gpu','GPU',2),('motherboard','マザーボード',3),('memory','メモリ',4),
  ('ssd','SSD',5),('psu','電源',6),('case','PCケース',7),('cooler','CPUクーラー',8);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null unique,
  sku text not null unique,
  name text not null,
  brand text not null,
  description text not null default '',
  beginner_note text not null default '',
  price_tax_included_yen integer check (price_tax_included_yen >= 0),
  tax_rate_basis_points smallint not null default 1000 check (tax_rate_basis_points between 0 and 10000),
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  weight_g integer check (weight_g > 0),
  pack_length_mm integer check (pack_length_mm > 0),
  pack_width_mm integer check (pack_width_mm > 0),
  pack_height_mm integer check (pack_height_mm > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_status_price_idx on public.products(category_id,status,price_tax_included_yen,id);
create index products_status_brand_idx on public.products(status,brand);
create index products_search_trgm_idx on public.products using gin ((name || ' ' || brand || ' ' || description) extensions.gin_trgm_ops);

create table public.product_use_cases (
  product_id uuid not null references public.products(id) on delete cascade,
  use_case text not null check (use_case in ('gaming','daily','editing')),
  primary key(product_id,use_case)
);
create index product_use_cases_case_product_idx on public.product_use_cases(use_case,product_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  alt_text text not null,
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);
create index product_images_product_sort_idx on public.product_images(product_id,sort_order,id);

create table public.cpu_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  socket_code text,
  core_count smallint check (core_count > 0),
  base_clock_mhz integer check (base_clock_mhz > 0),
  tdp_w integer check (tdp_w > 0)
);
create index cpu_specs_socket_idx on public.cpu_specs(socket_code);
create table public.gpu_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  chipset text not null,
  vram_gb smallint not null check (vram_gb > 0),
  card_length_mm integer check (card_length_mm > 0)
);
create index gpu_specs_length_idx on public.gpu_specs(card_length_mm);
create table public.motherboard_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  socket_code text,
  ddr_generation text check (ddr_generation in ('DDR4','DDR5')),
  form_factor text check (form_factor in ('ATX','mATX','ITX'))
);
create index motherboard_specs_socket_ddr_form_idx on public.motherboard_specs(socket_code,ddr_generation,form_factor);
create table public.memory_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  ddr_generation text check (ddr_generation in ('DDR4','DDR5')),
  capacity_gb smallint check (capacity_gb > 0),
  module_count smallint check (module_count > 0),
  speed_mt_s integer check (speed_mt_s > 0)
);
create index memory_specs_ddr_capacity_idx on public.memory_specs(ddr_generation,capacity_gb);
create table public.ssd_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  capacity_gb integer not null check (capacity_gb > 0),
  interface text not null,
  form_factor text not null
);
create index ssd_specs_capacity_interface_idx on public.ssd_specs(capacity_gb,interface);
create table public.psu_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  rated_w integer not null check (rated_w > 0),
  form_factor text not null,
  efficiency_grade text not null
);
create index psu_specs_rated_w_idx on public.psu_specs(rated_w);
create table public.case_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  max_gpu_length_mm integer check (max_gpu_length_mm > 0),
  outer_length_mm integer not null check (outer_length_mm > 0),
  outer_width_mm integer not null check (outer_width_mm > 0),
  outer_height_mm integer not null check (outer_height_mm > 0),
  supported_form_factors text[] check (supported_form_factors is null or supported_form_factors <@ array['ATX','mATX','ITX']::text[])
);
create index case_specs_form_factors_gin_idx on public.case_specs using gin(supported_form_factors);
create table public.cooler_specs (
  product_id uuid primary key references public.products(id) on delete cascade,
  supported_socket_codes text[],
  height_mm integer not null check (height_mm > 0),
  cooling_type text not null
);
create index cooler_specs_socket_codes_gin_idx on public.cooler_specs using gin(supported_socket_codes);

create or replace function public.validate_product_spec_category()
returns trigger language plpgsql set search_path = '' as $$
declare expected_slug text; actual_slug text; target_id uuid;
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from public.products p where p.id=old.product_id and p.status='published') then
      raise exception 'cannot remove specification from a published product' using errcode = '23514';
    end if;
    return old;
  end if;
  target_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  expected_slug := case tg_table_name
    when 'cpu_specs' then 'cpu' when 'gpu_specs' then 'gpu' when 'motherboard_specs' then 'motherboard'
    when 'memory_specs' then 'memory' when 'ssd_specs' then 'ssd' when 'psu_specs' then 'psu'
    when 'case_specs' then 'case' when 'cooler_specs' then 'cooler' end;
  select c.slug into actual_slug from public.products p join public.categories c on c.id=p.category_id where p.id=target_id;
  if actual_slug is distinct from expected_slug then
    raise exception 'specification table does not match product category' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger cpu_specs_category_guard before insert or update or delete on public.cpu_specs for each row execute function public.validate_product_spec_category();
create trigger gpu_specs_category_guard before insert or update or delete on public.gpu_specs for each row execute function public.validate_product_spec_category();
create trigger motherboard_specs_category_guard before insert or update or delete on public.motherboard_specs for each row execute function public.validate_product_spec_category();
create trigger memory_specs_category_guard before insert or update or delete on public.memory_specs for each row execute function public.validate_product_spec_category();
create trigger ssd_specs_category_guard before insert or update or delete on public.ssd_specs for each row execute function public.validate_product_spec_category();
create trigger psu_specs_category_guard before insert or update or delete on public.psu_specs for each row execute function public.validate_product_spec_category();
create trigger case_specs_category_guard before insert or update or delete on public.case_specs for each row execute function public.validate_product_spec_category();
create trigger cooler_specs_category_guard before insert or update or delete on public.cooler_specs for each row execute function public.validate_product_spec_category();

create or replace function public.validate_product_category_change()
returns trigger language plpgsql set search_path = '' as $$
declare expected_slug text;
begin
  if new.category_id = old.category_id then return new; end if;
  select slug into expected_slug from public.categories where id=new.category_id;
  if (exists(select 1 from public.cpu_specs where product_id=new.id) and expected_slug <> 'cpu') or
     (exists(select 1 from public.gpu_specs where product_id=new.id) and expected_slug <> 'gpu') or
     (exists(select 1 from public.motherboard_specs where product_id=new.id) and expected_slug <> 'motherboard') or
     (exists(select 1 from public.memory_specs where product_id=new.id) and expected_slug <> 'memory') or
     (exists(select 1 from public.ssd_specs where product_id=new.id) and expected_slug <> 'ssd') or
     (exists(select 1 from public.psu_specs where product_id=new.id) and expected_slug <> 'psu') or
     (exists(select 1 from public.case_specs where product_id=new.id) and expected_slug <> 'case') or
     (exists(select 1 from public.cooler_specs where product_id=new.id) and expected_slug <> 'cooler') then
    raise exception 'product category conflicts with existing specification row' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger products_category_guard before update of category_id on public.products for each row execute function public.validate_product_category_change();

create or replace function public.prevent_last_published_product_image_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.products where id=old.product_id and status='published')
     and (select count(*) from public.product_images where product_id=old.product_id) <= 1 then
    raise exception 'published product must retain an image' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger product_images_published_guard before delete on public.product_images
  for each row execute function public.prevent_last_published_product_image_delete();

create or replace function public.validate_product_for_publish()
returns trigger language plpgsql set search_path = '' as $$
declare category_slug text;
begin
  if new.status <> 'published' then return new; end if;
  select slug into category_slug from public.categories where id = new.category_id;
  if new.deleted_at is not null or btrim(new.name) = '' or btrim(new.brand) = ''
     or btrim(new.description) = '' or btrim(new.beginner_note) = ''
     or new.price_tax_included_yen is null or new.weight_g is null
     or new.pack_length_mm is null or new.pack_width_mm is null or new.pack_height_mm is null then
    raise exception 'published product requires active status and complete descriptive fields' using errcode = '23514';
  end if;
  if not exists (select 1 from public.product_images i where i.product_id = new.id) then
    raise exception 'published product requires an image' using errcode = '23514';
  end if;
  if not case category_slug
    when 'cpu' then exists(select 1 from public.cpu_specs s where s.product_id=new.id)
    when 'gpu' then exists(select 1 from public.gpu_specs s where s.product_id=new.id)
    when 'motherboard' then exists(select 1 from public.motherboard_specs s where s.product_id=new.id)
    when 'memory' then exists(select 1 from public.memory_specs s where s.product_id=new.id)
    when 'ssd' then exists(select 1 from public.ssd_specs s where s.product_id=new.id)
    when 'psu' then exists(select 1 from public.psu_specs s where s.product_id=new.id)
    when 'case' then exists(select 1 from public.case_specs s where s.product_id=new.id)
    when 'cooler' then exists(select 1 from public.cooler_specs s where s.product_id=new.id)
    else false end then
    raise exception 'published product requires its category specification row' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger products_validate_publish before insert or update of status,category_id,name,brand,description,beginner_note,deleted_at
  on public.products for each row execute function public.validate_product_for_publish();

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger addresses_updated_at before update on public.addresses for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

do $$ declare t text; begin
  foreach t in array array['profiles','admin_memberships','addresses','categories','products','product_use_cases','product_images',
    'cpu_specs','gpu_specs','motherboard_specs','memory_specs','ssd_specs','psu_specs','case_specs','cooler_specs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
