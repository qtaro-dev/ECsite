#!/usr/bin/env python3
"""Race fictional demo completion against Stripe order creation for one quote."""

import concurrent.futures
import json
import os
import subprocess
import threading
import uuid


DATABASE_URL = os.environ.get("T51_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
user_id, address_id, product_id, quote_id = [str(uuid.uuid4()) for _ in range(4)]
checkout_key = str(uuid.uuid4())
slug = f"t51-demo-race-{uuid.uuid4().hex[:12]}"
sku = f"T51-{uuid.uuid4().hex[:10]}"


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def psql(sql: str) -> str:
    completed = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql failed ({completed.returncode}): {completed.stderr.strip()}")
    return completed.stdout.strip()


def snapshot(version: str) -> dict:
    return {
        "address": {
            "id": address_id, "recipientName": "デモ購入者", "postalCode": "0000000",
            "prefectureCode": 13, "city": "架空市", "street": "デモ専用1番地",
            "building": None, "isDefault": False,
        },
        "items": [{
            "productId": product_id, "sku": sku, "name": "T51 Race CPU", "brand": "T51 Labs",
            "category": "cpu", "quantity": 1, "unitPriceYen": 1000, "lineTotalYen": 1000,
            "weightG": 500, "packLengthMm": 300, "packWidthMm": 200, "packHeightMm": 100,
            "specs": {"socket_code": "AM5"},
        }],
        "goodsTotalYen": 1000,
        "shipping": {"baseYen": 940, "heavyYen": 0, "totalYen": 940},
        "taxTotalYen": 176, "grandTotalYen": 1940,
        "shippingSettingsVersion": version, "compatibility": [],
    }


def call_rpc(name: str, body: dict | None, version: str, barrier: threading.Barrier) -> dict:
    barrier.wait(timeout=10)
    if name == "complete_demo_checkout":
        payload = "null" if body is None else q(json.dumps(body, ensure_ascii=False, separators=(",", ":")) ) + "::jsonb"
        call = f"public.complete_demo_checkout({q(user_id)}::uuid,{q(quote_id)}::uuid,{payload})"
    else:
        payload = q(json.dumps(body, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"
        call = f"public.create_checkout_order({q(user_id)}::uuid,{q(quote_id)}::uuid,{q(checkout_key)}::uuid,{payload})"
    output = psql(f"""
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{{"role":"service_role"}}',true);
select {call};
commit;
""")
    for line in reversed(output.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"RPC response missing for {name}: {output}")


def main() -> None:
    version = psql("select version from public.shipping_settings where is_active limit 1;").splitlines()[-1]
    if not version:
        raise AssertionError("active shipping settings are required")
    body = snapshot(version)
    try:
        psql(f"""
begin;
insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at)
  values ({q(user_id)}::uuid,'authenticated','authenticated',true,now(),now());
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,building,is_default)
  values ({q(address_id)}::uuid,{q(user_id)}::uuid,'デモ購入者','0000000',13,'架空市','デモ専用1番地',null,false);
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
  values ({q(product_id)}::uuid,(select id from public.categories where slug='cpu'),{q(slug)},{q(sku)},
    'T51 Race CPU','T51 Labs','fixture','fixture',1000,1000,'draft',500,300,200,100);
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
  values ({q(product_id)}::uuid,'AM5',4,3000,65);
insert into public.product_images(product_id,storage_path,alt_text)
  values ({q(product_id)}::uuid,{q('t51/' + sku + '.png')},'T51 concurrency fixture');
update public.products set status='published' where id={q(product_id)}::uuid;
insert into public.inventory(product_id,on_hand,allocated) values ({q(product_id)}::uuid,3,0);
insert into public.carts(user_id) values ({q(user_id)}::uuid);
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
  select id,{q(product_id)}::uuid,1,1000 from public.carts where user_id={q(user_id)}::uuid;
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,
  shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
  values ({q(quote_id)}::uuid,{q(user_id)}::uuid,{q(address_id)}::uuid,
    jsonb_build_array(jsonb_build_object('productId',{q(product_id)},'quantity',1,'unitPriceYen',1000,'lineTotalYen',1000)),
    1000,940,0,176,1940,{q(version)});
commit;
""")

        barrier = threading.Barrier(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            demo_future = pool.submit(call_rpc, "complete_demo_checkout", body, version, barrier)
            stripe_future = pool.submit(call_rpc, "create_checkout_order", body, version, barrier)
            demo, stripe = demo_future.result(timeout=30), stripe_future.result(timeout=30)

        statuses = {demo.get("status"), stripe.get("status")}
        demo_won = statuses == {"completed", "demo_checkout_completed"}
        stripe_won = statuses == {"checkout_started", "created"}
        if not (demo_won or stripe_won):
            raise AssertionError(f"unexpected completion/Stripe race results: demo={demo}, stripe={stripe}")

        state = json.loads(psql(f"""
select json_build_object(
  'marker',(select demo_completed_at is not null from public.checkout_quotes where id={q(quote_id)}::uuid),
  'orders',(select count(*) from public.orders where checkout_quote_id={q(quote_id)}::uuid),
  'cartItems',(select count(*) from public.cart_items ci join public.carts c on c.id=ci.cart_id where c.user_id={q(user_id)}::uuid),
  'allocated',(select allocated from public.inventory where product_id={q(product_id)}::uuid));
"""))
        if demo_won and state != {"marker": True, "orders": 0, "cartItems": 0, "allocated": 0}:
            raise AssertionError(f"demo completion left side effects: {state}")
        if stripe_won and state != {"marker": False, "orders": 1, "cartItems": 1, "allocated": 1}:
            raise AssertionError(f"Stripe order failed to remain atomic: {state}")
    finally:
        psql(f"delete from auth.users where id={q(user_id)}::uuid; delete from public.products where id={q(product_id)}::uuid;")


if __name__ == "__main__":
    main()
