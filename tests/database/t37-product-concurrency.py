#!/usr/bin/env python3
"""Verify optimistic product versions serialize concurrent administrator edits."""

from __future__ import annotations

import concurrent.futures
import os
import subprocess
import uuid


DATABASE_URL = os.environ.get("T37_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
actor_id = str(uuid.uuid4())
product_id = str(uuid.uuid4())
slug = f"t37-concurrency-{uuid.uuid4().hex[:12]}"
sku = f"T37-{uuid.uuid4().hex[:10]}"


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def psql(sql: str) -> str:
    result = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"psql failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip()


def edit(label: str) -> str:
    request_id = "t37-race-" + label.replace(" ", "-")
    sql = f"""
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claims','{{"role":"service_role"}}',false);
do $$ begin
  perform pg_catalog.pg_sleep(0.15);
  perform public.admin_save_product(
    {literal(product_id)}::uuid,0,
    jsonb_build_object('category_slug','cpu','slug',{literal(slug)},'sku',{literal(sku)},'name',{literal(label)},
      'brand','T37 concurrency','description','fixture','beginner_note','fixture','price_tax_included_yen',1000,
      'status','draft','weight_g',500,'pack_length_mm',100,'pack_width_mm',100,'pack_height_mm',100),
    '{{}}'::jsonb,ARRAY[]::text[],'[]'::jsonb,{literal(actor_id)}::uuid,{literal(request_id)}
  );
  raise notice 'T37_EDIT_SUCCEEDED';
exception when sqlstate 'P0001' then
  raise notice 'T37_EDIT_STALE';
end $$;
"""
    result = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"concurrent edit failed ({result.returncode}): {result.stderr.strip()}")
    output = result.stderr + result.stdout
    if "T37_EDIT_SUCCEEDED" in output:
        return "saved"
    if "T37_EDIT_STALE" in output:
        return "stale"
    raise RuntimeError(f"concurrent edit did not report a result: {output.strip()}")


def main() -> None:
    psql(f"""
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at)
values ({literal(actor_id)}::uuid,'authenticated','authenticated',{literal(actor_id + '@t37-race.test')},now(),now());
insert into public.admin_memberships(user_id,granted_by) values ({literal(actor_id)}::uuid,null);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
select public.admin_save_product({literal(product_id)}::uuid,null,
  jsonb_build_object('category_slug','cpu','slug',{literal(slug)},'sku',{literal(sku)},'name','initial',
    'brand','T37 concurrency','description','fixture','beginner_note','fixture','price_tax_included_yen',1000,
    'status','draft','weight_g',500,'pack_length_mm',100,'pack_width_mm',100,'pack_height_mm',100),
  '{{}}'::jsonb,ARRAY[]::text[],'[]'::jsonb,{literal(actor_id)}::uuid,'t37-race-create');
commit;
""")
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(edit, ("concurrent A", "concurrent B")))
        if sorted(results) != ["saved", "stale"]:
            raise AssertionError(f"expected one successful edit and one stale-version conflict, got {results}")
        version = psql(f"select version from public.products where id={literal(product_id)}::uuid;")
        if version != "1":
            raise AssertionError(f"concurrent edits advanced version by {version}, expected exactly 1")
    finally:
        psql(f"""
begin;
delete from public.products where id={literal(product_id)}::uuid;
delete from auth.users where id={literal(actor_id)}::uuid;
commit;
""")
    print("T37 concurrent edits: exactly one save and one stale-version rejection")


if __name__ == "__main__":
    main()
