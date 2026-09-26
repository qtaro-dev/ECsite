# T37 DB migration proposal (not applied)

This is a review proposal only. It has not been applied or tested against a database. No migration/RPC file is present in the T37 branch while the user decision is pending.

## Intended changes

- Add `products.version integer NOT NULL DEFAULT 0 CHECK (version >= 0)` for optimistic concurrency. Existing products receive version `0`; successful edits increment it once.
- Add `public.admin_save_product(uuid, integer, jsonb, jsonb, text[], jsonb, uuid, text)` as the only database writer for product fields, category-specific specs, use cases, and image metadata. It is `SECURITY DEFINER`, uses an empty `search_path`, checks that `p_actor_id` is an active `admin_memberships` row, locks the product row, and returns `P0001` on stale version. Update calls explicitly reject a null expected version.
- Do not add authenticated/anon `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grants or policies. Existing T09 policies and grants remain authoritative. The management page/API uses the server-only service-role client only after `authorizeAdminApi` succeeds. The RPC has `EXECUTE` revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` receives `EXECUTE`.
- Make category immutable after create. Upsert only that category's existing spec table row. Do not delete spec rows. Replace product use-case rows transactionally when the submitted list changes.
- Product image bytes are uploaded to the private Storage bucket by the authorized API. Each generated path is `<product UUID>/<random UUID>.<jpg|png|webp>`. The RPC checks the product-id prefix, that each path exists in `storage.objects` in bucket `product-images`, and that no other product already owns its metadata path. The unique `product_images.storage_path` constraint remains unchanged; an existing path for this product is updated, while an existing path for another product raises conflict. The RPC synchronizes `product_images` metadata in the same transaction as product fields. It sets status to draft before removing metadata (required by `prevent_last_published_product_image_delete`), synchronizes retained/new metadata, then sets the requested final status. Existing `products_validate_publish` therefore sees the final image metadata within the same transaction. After commit, the API deletes the corresponding private Storage object for removed metadata. If the DB transaction fails, the API removes only newly uploaded objects as compensation; an object-delete failure after commit leaves a private orphan for cleanup and must be surfaced for retry.
- Insert draft first, upsert typed fields, then set the requested status in the same transaction. Existing `products_validate_publish` remains responsible for required description, image, and category-spec-row checks. The proposed writer additionally rejects publication above 30,000 g, any single package dimension above 1,700 mm, or a total above 2,000 mm, matching the currently published Yamato limits ([official limit FAQ](https://faq.kuronekoyamato.co.jp/app/answers/detail/a_id/1411)).
- The draft schema tables have different nullability. If a new draft lacks any NOT NULL specification field for its category (`gpu`, `ssd`, `power-supply`, `pc-case`, `cpu-cooler`), it creates no spec row; draft publication is allowed to remain incomplete. For an existing spec row, omitted fields preserve their stored value, nullable columns accept explicit `null`, and a NOT NULL field cannot be cleared. An existing row is never deleted. Once complete, the upsert records the changed fields. CPU, motherboard, and memory spec tables allow all fields to be null and may retain a row with missing compatibility values.
- Append one `audit_logs` row with actor, product id, request id, and `reason_code: product_change`. Keep the existing audit validator unchanged. Populate `changed_fields` from the actual diff, limited to its existing allowlist values `price_tax_included_yen`, `status`, and `product_image`.

## SQL draft

The endpoint translates its camel-case contract to these database field names before calling the function. `p_fields.category_slug` is one of the eight fixed category slugs. `p_specifications` uses only the selected table's existing column names.

```sql
alter table public.products
  add column version integer not null default 0 check (version >= 0);

create function public.admin_save_product(
  p_product_id uuid,
  p_expected_version integer,
  p_fields jsonb,
  p_specifications jsonb,
  p_use_cases text[],
  p_images jsonb,
  p_actor_id uuid,
  p_request_id text
) returns table(product_id uuid, version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_product_id, gen_random_uuid());
  v_category_id uuid;
  v_category_slug text;
  v_spec_table text;
  v_current_version integer;
  v_assignments text;
  v_status text := coalesce(p_fields->>'status', 'draft');
  v_changed_fields text[] := array[]::text[];
  v_old_price integer;
  v_old_status text;
  v_old_images jsonb := '[]'::jsonb;
  v_new_images jsonb := '[]'::jsonb;
  v_required_spec_columns text[] := array[]::text[];
  v_has_old_specs boolean := false;
begin
  if not exists (select 1 from public.admin_memberships m
    where m.user_id=p_actor_id and m.revoked_at is null) then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if jsonb_typeof(p_fields)<>'object' or jsonb_typeof(coalesce(p_specifications,'{}'::jsonb))<>'object' then
    raise exception 'invalid product fields' using errcode='22023';
  end if;
  select c.id,c.slug into v_category_id,v_category_slug from public.categories c
    where c.slug=p_fields->>'category_slug';
  if v_category_id is null then raise exception 'invalid category' using errcode='22023'; end if;
  v_spec_table := case v_category_slug
    when 'cpu' then 'cpu_specs' when 'gpu' then 'gpu_specs'
    when 'motherboard' then 'motherboard_specs' when 'memory' then 'memory_specs'
    when 'ssd' then 'ssd_specs' when 'power-supply' then 'psu_specs'
    when 'pc-case' then 'case_specs' when 'cpu-cooler' then 'cooler_specs' end;
  v_required_spec_columns := case v_category_slug
    when 'gpu' then array['chipset','vram_gb']
    when 'ssd' then array['capacity_gb','interface','form_factor']
    when 'power-supply' then array['rated_w','form_factor','efficiency_grade']
    when 'pc-case' then array['outer_length_mm','outer_width_mm','outer_height_mm']
    when 'cpu-cooler' then array['height_mm','cooling_type']
    else array[]::text[] end;
  if v_status not in ('draft','published','hidden') then
    raise exception 'invalid product status' using errcode='22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_use_cases,array[]::text[])) u
    where u not in ('gaming','daily','editing')) then
    raise exception 'invalid product use case' using errcode='22023';
  end if;

  if p_product_id is null then
    insert into public.products(category_id,slug,sku,name,brand,description,beginner_note,
      price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
    values(v_category_id,p_fields->>'slug',p_fields->>'sku',coalesce(p_fields->>'name',''),
      coalesce(p_fields->>'brand',''),coalesce(p_fields->>'description',''),coalesce(p_fields->>'beginner_note',''),
      nullif(p_fields->>'price_tax_included_yen','')::integer,1000,'draft',
      nullif(p_fields->>'weight_g','')::integer,nullif(p_fields->>'pack_length_mm','')::integer,
      nullif(p_fields->>'pack_width_mm','')::integer,nullif(p_fields->>'pack_height_mm','')::integer)
    returning id into v_id;
  else
    if p_expected_version is null then
      raise exception 'expected version is required' using errcode='22023';
    end if;
    select p.version,p.category_id,p.price_tax_included_yen,p.status
      into v_current_version,v_category_id,v_old_price,v_old_status
      from public.products p where p.id=p_product_id for update;
    if v_current_version is null then raise exception 'product not found' using errcode='P0002'; end if;
    if v_current_version<>p_expected_version then raise exception 'stale product version' using errcode='P0001'; end if;
    if v_category_id<>(select c.id from public.categories c where c.slug=p_fields->>'category_slug') then
      raise exception 'category cannot be changed after creation' using errcode='22023';
    end if;
    update public.products set status='draft' where id=p_product_id;
    select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
      order by i.sort_order,i.storage_path),'[]'::jsonb) into v_old_images
      from public.product_images i where i.product_id=p_product_id;
    update public.products set slug=p_fields->>'slug',sku=p_fields->>'sku',
      name=coalesce(p_fields->>'name',''),brand=coalesce(p_fields->>'brand',''),
      description=coalesce(p_fields->>'description',''),beginner_note=coalesce(p_fields->>'beginner_note',''),
      price_tax_included_yen=nullif(p_fields->>'price_tax_included_yen','')::integer,
      weight_g=nullif(p_fields->>'weight_g','')::integer,pack_length_mm=nullif(p_fields->>'pack_length_mm','')::integer,
      pack_width_mm=nullif(p_fields->>'pack_width_mm','')::integer,pack_height_mm=nullif(p_fields->>'pack_height_mm','')::integer,
      version=version+1 where id=p_product_id;
  end if;

  execute format('select exists(select 1 from public.%I s where s.product_id=$1)',v_spec_table)
    into v_has_old_specs using v_id;
  if v_has_old_specs or not exists(select 1 from unnest(v_required_spec_columns) required_key
      where nullif(p_specifications->>required_key,'') is null) then
    select string_agg(format('%I=excluded.%I',a.attname,a.attname),',' order by a.attnum)
      into v_assignments from pg_attribute a
      where a.attrelid=format('public.%I',v_spec_table)::regclass
        and a.attnum>0 and not a.attisdropped and a.attname<>'product_id';
    execute format(
      'insert into public.%I select (jsonb_populate_record((select s from public.%I s where s.product_id=$2),$1 || jsonb_build_object(''product_id'',$2))).* on conflict (product_id) do update set %s',
      v_spec_table,v_spec_table,v_assignments)
      using coalesce(p_specifications,'{}'::jsonb),v_id;
  end if;
  delete from public.product_use_cases where product_id=v_id;
  insert into public.product_use_cases(product_id,use_case)
    select v_id,u from unnest(coalesce(p_use_cases,array[]::text[])) u;

  -- p_images contains only this product's retained or newly uploaded paths.
  -- The API uploads bytes first; no client can write product_images directly.
  if jsonb_typeof(coalesce(p_images,'[]'::jsonb))<>'array' then
    raise exception 'invalid image metadata' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      where i.storage_path is null or i.storage_path not like v_id::text || '/%'
        or not exists(select 1 from storage.objects o
        where o.bucket_id='product-images' and o.name=i.storage_path)) then
    raise exception 'uploaded image object not found' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text)
      join public.product_images old_image on old_image.storage_path=i.storage_path
      where old_image.product_id<>v_id) then
    raise exception 'image path is already associated with another product' using errcode='23505';
  end if;
  if exists(select 1 from public.products where id=v_id and status='published') then
    update public.products set status='draft' where id=v_id;
  end if;
  delete from public.product_images i where i.product_id=v_id and not exists(
    select 1 from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as submitted(storage_path text)
      where submitted.storage_path=i.storage_path);
  insert into public.product_images(product_id,storage_path,alt_text,sort_order)
    select v_id,i.storage_path,i.alt_text,i.sort_order
    from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint)
    on conflict(storage_path) do update set alt_text=excluded.alt_text,sort_order=excluded.sort_order
      where public.product_images.product_id=v_id;

  if v_status='published' and (
    coalesce(nullif(p_fields->>'weight_g','')::integer>30000,false)
    or coalesce(nullif(p_fields->>'pack_length_mm','')::integer
      + nullif(p_fields->>'pack_width_mm','')::integer
      + nullif(p_fields->>'pack_height_mm','')::integer>2000,false)
    or coalesce(nullif(p_fields->>'pack_length_mm','')::integer>1700,false)
    or coalesce(nullif(p_fields->>'pack_width_mm','')::integer>1700,false)
    or coalesce(nullif(p_fields->>'pack_height_mm','')::integer>1700,false)) then
    raise exception 'Yamato handling limit exceeded' using errcode='23514';
  end if;
  update public.products set status=v_status where id=v_id;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path',i.storage_path,'alt_text',i.alt_text,'sort_order',i.sort_order)
    order by i.sort_order,i.storage_path),'[]'::jsonb) into v_new_images
    from jsonb_to_recordset(coalesce(p_images,'[]'::jsonb)) as i(storage_path text,alt_text text,sort_order smallint);
  if nullif(p_fields->>'price_tax_included_yen','')::integer is distinct from v_old_price then
    v_changed_fields:=array_append(v_changed_fields,'price_tax_included_yen');
  end if;
  if v_status is distinct from v_old_status then
    v_changed_fields:=array_append(v_changed_fields,'status');
  end if;
  if v_new_images is distinct from v_old_images then
    v_changed_fields:=array_append(v_changed_fields,'product_image');
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,change_summary,request_id)
    values(p_actor_id,'admin.product.saved','product',v_id,
      jsonb_build_object('changed_fields',to_jsonb(v_changed_fields),'reason_code','product_change'),p_request_id);
  return query select p.id,p.version from public.products p where p.id=v_id;
end;
$$;

revoke all on function public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)
  from public,anon,authenticated;
grant execute on function public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text)
  to service_role;
```

The exact draft is still unexecuted. It needs parser/runtime review and local DB verification before a migration is authored or applied.

## Side effects, failure behavior, and rollback

- Adding `version` backfills existing products to `0`; rollback drops the column and loses version history. Rollback is suitable only before concurrent product edits depend on it.
- A successful save changes product fields and the selected category spec row, replaces use-case rows, synchronizes image metadata, increments version on update, updates `updated_at` through the existing trigger, and appends an audit record. It does not change category, delete spec rows, or recalculate historical order snapshots.
- Trigger/constraint failure rolls back the product/spec/use-case/audit transaction. Duplicate slug/SKU retains PostgreSQL unique violation; the API maps that conflict. Stale versions use `P0001`; publication constraints use `23514`.
- Before application: `drop function if exists public.admin_save_product(uuid,integer,jsonb,jsonb,text[],jsonb,uuid,text); alter table public.products drop column if exists version;` This rollback is migration-reversal only and must not run after versioned updates have been accepted.

## Required database and API tests

- `anon` and ordinary `authenticated` cannot insert/update/delete products, spec rows, use cases, or image metadata; neither can execute `admin_save_product`.
- `service_role` can execute only when the supplied actor has active admin membership; revoked/non-member actor fails. HTTP route separately verifies the real session and membership before using service role.
- Admin draft can omit spec values. Admin updates UPSERT only the selected category table; the category cannot change and there is no spec-row DELETE path.
- Valid product with image and category row can publish; missing image/category row/base fields and the Yamato weight/dimension limits reject publication. Existing product order snapshots are byte-for-byte unchanged after price/name/spec edits.
- Two edits with the same expected version: one succeeds and increments version, the other returns stale conflict. Duplicate slug/SKU returns conflict and leaves no partial spec/use-case/audit state.
- Image paths must have the target product UUID prefix, refer to an existing object in `product-images`, and not be associated with another product. Updating the same product's existing path keeps the `storage_path` unique constraint intact. Replacing the final image on a published product runs metadata deletion only while the row is transactionally draft, then inserts the replacement before final publication; removing the final image and publishing fails. A draft may have no images. Verify Storage cleanup failure after commit leaves no public metadata and is reported as a private orphan.
