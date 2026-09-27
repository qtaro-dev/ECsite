#!/usr/bin/env python3
"""Verify row locking and expected-version checks serialize stock adjustments."""

from __future__ import annotations

import concurrent.futures
import os
import subprocess
import uuid


DATABASE_URL = os.environ.get("T38_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
actor_id = str(uuid.uuid4())
product_id = str(uuid.uuid4())
slug = f"t38-race-{uuid.uuid4().hex[:12]}"
sku = f"T38-{uuid.uuid4().hex[:10]}"


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


def adjust(label: str) -> str:
    request_id = "t38-race-" + label.replace(" ", "-")
    sql = f"""
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claims','{{"role":"service_role"}}',false);
select pg_catalog.pg_sleep(0.15);
select public.admin_adjust_inventory({literal(product_id)}::uuid,1,{literal(label)},1,
  {literal(actor_id)}::uuid,{literal(request_id)})->>'status';
"""
    return psql(sql).splitlines()[-1]


def main() -> None:
    psql(f"""
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at)
values ({literal(actor_id)}::uuid,'authenticated','authenticated',{literal(actor_id + '@t38-race.test')},now(),now());
insert into public.admin_memberships(user_id,granted_by) values ({literal(actor_id)}::uuid,null);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
select public.admin_save_product({literal(product_id)}::uuid,null,
  jsonb_build_object('category_slug','cpu','slug',{literal(slug)},'sku',{literal(sku)},'name','inventory concurrency fixture',
    'brand','T38 test','description','fixture','beginner_note','fixture','price_tax_included_yen',1000,
    'status','draft','weight_g',500,'pack_length_mm',100,'pack_width_mm',100,'pack_height_mm',100),
  '{{"socket_code":"AM5"}}'::jsonb,ARRAY[]::text[],'[]'::jsonb,{literal(actor_id)}::uuid,'t38-race-create');
select public.admin_adjust_inventory({literal(product_id)}::uuid,5,'initial test stock',0,
  {literal(actor_id)}::uuid,'t38-race-initial');
commit;
""")
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(adjust, ("race A", "race B")))
        if sorted(results) != ["conflict", "updated"]:
            raise AssertionError(f"expected one adjustment and one stale-version conflict, got {results}")
        state = psql(f"select on_hand||':'||allocated||':'||version from public.inventory where product_id={literal(product_id)}::uuid;")
        if state != "6:0:2":
            raise AssertionError(f"serialized adjustment left unexpected inventory {state}; expected 6:0:2")
    finally:
        psql(f"""
begin;
delete from public.inventory_adjustments where product_id={literal(product_id)}::uuid;
delete from public.products where id={literal(product_id)}::uuid;
delete from auth.users where id={literal(actor_id)}::uuid;
commit;
""")
    print("T38 stock adjustment race: one update and one current-value conflict")


if __name__ == "__main__":
    main()
