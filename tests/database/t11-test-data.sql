\set ON_ERROR_STOP on
begin;

do $$ declare fixture_count integer; category_count integer; begin
  select count(*) into fixture_count from public.products where slug like 't11-%';
  if fixture_count <> 18 then raise exception 'expected 18 T11 products after repeat seed, found %',fixture_count; end if;
  select count(distinct c.slug) into category_count
  from public.products p join public.categories c on c.id=p.category_id where p.slug like 't11-%';
  if category_count <> 8 then raise exception 'expected all 8 categories, found %',category_count; end if;
  if exists(select 1 from public.products p left join public.product_images i on i.product_id=p.id
      where p.slug like 't11-%' and (p.status <> 'published' or i.storage_path is null)) then
    raise exception 'every T11 published fixture must have product image metadata';
  end if;
  if (select count(*) from public.products where slug like 't11-%' and price_tax_included_yen=9999) <> 3 or
     (select count(*) from public.products where slug like 't11-%' and price_tax_included_yen=10000) <> 3 then
    raise exception 'T11 9,999 / 10,000 yen cases missing';
  end if;
  if (select weight_g from public.products where slug='t11-cpu-am5') <> 19999 or
     (select weight_g from public.products where slug='t11-gpu-300') <> 20000 then
    raise exception 'T11 19,999 / 20,000 gram boundary missing';
  end if;
  if (select count(*) from public.shipping_settings where version='t11-fixture-only-v1' and not is_active
      and heavy_rule_json->>'fixture_only'='true' and (heavy_rule_json->>'sample_fee_yen')::integer=1234) <> 1 or
     (select count(*) from public.shipping_settings where version='initial-v1' and is_active and heavy_rule_json='{}'::jsonb) <> 1 then
    raise exception 'T11 sample heavy rate must stay inactive and official rates unavailable';
  end if;
  if (select on_hand-allocated from public.inventory where product_id=(select id from public.products where slug='t11-gpu-300')) <> 0 or
     (select on_hand-allocated from public.inventory where product_id=(select id from public.products where slug='t11-motherboard-atx')) <> 1 then
    raise exception 'T11 available inventory 0 / 1 cases missing';
  end if;
  if exists(select 1 from public.products where slug like 't11-%' and (
      description not like '%合成%' or beginner_note not like '%架空%')) then
    raise exception 'T11 fixtures must identify as synthetic and fictional';
  end if;
  if exists(select 1 from public.product_images where storage_path like 't11/%' and storage_path not like 't11/t11-%.png') then
    raise exception 'unexpected T11 storage path';
  end if;
end $$;

-- Check each compatibility relation's documented match / mismatch / missing inputs.
do $$ declare actual_count integer; begin
  with cases(case_id, relation, left_slug, right_slug, expected) as (values
    ('SOCKET-MATCH','socket','t11-cpu-am5','t11-motherboard-atx','match'),
    ('SOCKET-MISMATCH','socket','t11-cpu-am4','t11-motherboard-atx','mismatch'),
    ('SOCKET-MISSING','socket','t11-cpu-unknown','t11-motherboard-atx','missing'),
    ('DDR-MATCH','ddr','t11-motherboard-atx','t11-memory-ddr5','match'),
    ('DDR-MISMATCH','ddr','t11-motherboard-atx','t11-memory-ddr4','mismatch'),
    ('DDR-MISSING','ddr','t11-motherboard-atx','t11-memory-unknown','missing'),
    ('FORM-MATCH','form','t11-motherboard-atx','t11-case-atx','match'),
    ('FORM-MISMATCH','form','t11-motherboard-atx','t11-case-itx','mismatch'),
    ('FORM-MISSING','form','t11-motherboard-atx','t11-case-unknown','missing'),
    ('GPU-MATCH','gpu','t11-gpu-300','t11-case-atx','match'),
    ('GPU-MISMATCH','gpu','t11-gpu-340','t11-case-atx','mismatch'),
    ('GPU-MISSING','gpu','t11-gpu-unknown','t11-case-atx','missing'),
    ('COOLER-MATCH','cooler','t11-cpu-am5','t11-cooler-am5','match'),
    ('COOLER-MISMATCH','cooler','t11-cpu-am5','t11-cooler-lga','mismatch'),
    ('COOLER-MISSING','cooler','t11-cpu-unknown','t11-cooler-am5','missing')
  ), observed as (
    select c.*, case c.relation
      when 'socket' then case when cs.socket_code is null or ms.socket_code is null then 'missing'
        when cs.socket_code=ms.socket_code then 'match' else 'mismatch' end
      when 'ddr' then case when ms.ddr_generation is null or mem.ddr_generation is null then 'missing'
        when ms.ddr_generation=mem.ddr_generation then 'match' else 'mismatch' end
      when 'form' then case when ms.form_factor is null or cspec.supported_form_factors is null then 'missing'
        when ms.form_factor=any(cspec.supported_form_factors) then 'match' else 'mismatch' end
      when 'gpu' then case when gpu.card_length_mm is null or cspec.max_gpu_length_mm is null then 'missing'
        when gpu.card_length_mm<=cspec.max_gpu_length_mm then 'match' else 'mismatch' end
      when 'cooler' then case when cs.socket_code is null or cooler.supported_socket_codes is null then 'missing'
        when cs.socket_code=any(cooler.supported_socket_codes) then 'match' else 'mismatch' end end as actual
    from cases c
    left join public.products lp on lp.slug=c.left_slug
    left join public.products rp on rp.slug=c.right_slug
    left join public.cpu_specs cs on cs.product_id=lp.id or (c.relation='cooler' and cs.product_id=lp.id)
    left join public.motherboard_specs ms on ms.product_id=case when c.relation in ('socket','ddr','form') then
      case when c.relation='socket' then rp.id else lp.id end else null end
    left join public.memory_specs mem on mem.product_id=rp.id
    left join public.case_specs cspec on cspec.product_id=case when c.relation in ('form','gpu') then rp.id else null end
    left join public.gpu_specs gpu on gpu.product_id=lp.id
    left join public.cooler_specs cooler on cooler.product_id=rp.id
  )
  select count(*) into actual_count from observed where actual is distinct from expected;
  if actual_count <> 0 then raise exception 'T11 compatibility case inputs do not match documented expected outcomes (% failures)',actual_count; end if;
end $$;

-- Public catalog RLS exposes the fixtures but no inventory internals.
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$ begin
  if (select count(*) from public.products where slug like 't11-%') <> 18 then raise exception 'anon cannot see all published T11 fixtures'; end if;
  if (select count(*) from public.product_images i join public.products p on p.id=i.product_id where p.slug like 't11-%') <> 18 then
    raise exception 'anon cannot see T11 image metadata'; end if;
  if has_table_privilege(current_user,'public.inventory','SELECT') then raise exception 'anon can read inventory internals'; end if;
  if (select available_quantity from public.available_inventory v join public.products p on p.id=v.product_id where p.slug='t11-gpu-300') <> 0 or
     (select available_quantity from public.available_inventory v join public.products p on p.id=v.product_id where p.slug='t11-motherboard-atx') <> 1 then
    raise exception 'public availability projection failed for 0 / 1 fixtures';
  end if;
end $$;
reset role;
rollback;
