#!/usr/bin/env python3
"""Exercise quote idempotency and inventory serialization with concurrent psql sessions."""

import concurrent.futures
import json
import os
import subprocess
import uuid


DATABASE_URL = os.environ.get("T29_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
users = [str(uuid.uuid4()) for _ in range(4)]
addresses = [str(uuid.uuid4()) for _ in range(4)]
products = [str(uuid.uuid4()) for _ in range(2)]
quotes = [str(uuid.uuid4()) for _ in range(3)]
keys = [str(uuid.uuid4()) for _ in range(5)]
slugs = [f"t29-concurrency-{uuid.uuid4().hex[:12]}" for _ in products]
skus = [f"T29-{uuid.uuid4().hex[:10]}" for _ in products]


def psql(sql: str) -> str:
    completed = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql failed ({completed.returncode}): {completed.stderr.strip()}")
    return completed.stdout.strip()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def address_object(address_id: str, index: int) -> dict:
    return {
        "id": address_id,
        "recipientName": f"T29 User {index}",
        "postalCode": "1000001",
        "prefectureCode": 13,
        "city": "Chiyoda",
        "street": f"{index}-1",
        "building": None,
        "isDefault": False,
    }


def snapshot(product_id: str, sku: str, name: str, address_id: str, index: int) -> dict:
    return {
        "address": address_object(address_id, index),
        "items": [{
            "productId": product_id,
            "sku": sku,
            "name": name,
            "brand": "T29 Test",
            "category": "cpu",
            "quantity": 1,
            "unitPriceYen": 1000,
            "lineTotalYen": 1000,
            "weightG": 500,
            "packLengthMm": 300,
            "packWidthMm": 200,
            "packHeightMm": 100,
            "specs": {"socket_code": "AM5"},
        }],
        "goodsTotalYen": 1000,
        "shipping": {"baseYen": 940, "heavyYen": 0, "totalYen": 940},
        "taxTotalYen": 176,
        "grandTotalYen": 1940,
        "shippingSettingsVersion": "initial-v1",
        "compatibility": [],
    }


def call_create(user_id: str, quote_id: str, checkout_key: str, snap: dict) -> dict:
    sql = f"""
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.create_checkout_order(
  {sql_literal(user_id)}::uuid,{sql_literal(quote_id)}::uuid,{sql_literal(checkout_key)}::uuid,
  {sql_literal(json.dumps(snap, separators=(',', ':')))}::jsonb
);
commit;
"""
    output = psql(sql)
    for line in reversed(output.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"RPC JSON response not found: {output}")


def main() -> None:
    address_inserts = ",\n".join(
        f"({sql_literal(addresses[i])}::uuid,{sql_literal(users[i])}::uuid,'T29 User {i}','1000001',13,'Chiyoda','{i}-1',false)"
        for i in range(4)
    )
    user_inserts = ",\n".join(
        f"({sql_literal(users[i])}::uuid,'authenticated','authenticated','{users[i]}@t29.test',now(),now())"
        for i in range(4)
    )
    product_inserts = ",\n".join(
        f"({sql_literal(products[i])}::uuid,(select id from public.categories where slug='cpu'),{sql_literal(slugs[i])},{sql_literal(skus[i])},'T29 concurrency CPU {i}','T29 Test','fixture','fixture',1000,1000,'published',500,300,200,100)"
        for i in range(2)
    )
    cart_inserts = ",\n".join(f"({sql_literal(users[i])}::uuid)" for i in range(4))
    cart_item_inserts = ",\n".join(
        f"((select id from public.carts where user_id={sql_literal(users[i])}::uuid),{sql_literal(products[0 if i < 2 else 1])}::uuid,1,900)"
        for i in range(4)
    )
    quote_rows = []
    # Users 0 and 1 share one quote identity and use distinct checkout keys.
    quote_rows.append(
        f"({sql_literal(quotes[0])}::uuid,{sql_literal(users[0])}::uuid,{sql_literal(addresses[0])}::uuid,'[{json.dumps({'productId': products[0], 'quantity': 1, 'unitPriceYen': 1000, 'lineTotalYen': 1000})}]'::jsonb,1000,940,0,176,1940,'initial-v1')"
    )
    for quote_index, user_index in ((1, 2), (2, 3)):
        quote_rows.append(
            f"({sql_literal(quotes[quote_index])}::uuid,{sql_literal(users[user_index])}::uuid,{sql_literal(addresses[user_index])}::uuid,'[{json.dumps({'productId': products[1], 'quantity': 1, 'unitPriceYen': 1000, 'lineTotalYen': 1000})}]'::jsonb,1000,940,0,176,1940,'initial-v1')"
        )
    setup_sql = f"""
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values {user_inserts};
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,is_default) values {address_inserts};
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm) values {product_inserts};
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w) values
 ({sql_literal(products[0])}::uuid,'AM5',4,3000,65),({sql_literal(products[1])}::uuid,'AM5',4,3000,65);
insert into public.inventory(product_id,on_hand,allocated) values ({sql_literal(products[0])}::uuid,1,0),({sql_literal(products[1])}::uuid,1,0);
insert into public.carts(user_id) values {cart_inserts};
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen) values {cart_item_inserts};
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version) values {', '.join(quote_rows)};
commit;
"""
    psql(setup_sql)
    try:
        same_quote_requests = [
            (users[0], quotes[0], keys[0], snapshot(products[0], skus[0], "T29 concurrency CPU 0", addresses[0], 0)),
            (users[0], quotes[0], keys[1], snapshot(products[0], skus[0], "T29 concurrency CPU 0", addresses[0], 0)),
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            same_quote_results = list(pool.map(lambda args: call_create(*args), same_quote_requests))
            stock_results = list(pool.map(
                lambda i: call_create(users[i], quotes[i - 1], keys[i + 1], snapshot(products[1], skus[1], "T29 concurrency CPU 1", addresses[i], i)),
                (2, 3),
            ))
        if sorted(result["status"] for result in same_quote_results) != ["already_created", "created"]:
            raise AssertionError(f"same quote with different keys did not resolve to one order: {same_quote_results}")
        if len({result["orderId"] for result in same_quote_results}) != 1:
            raise AssertionError(f"same quote produced different order IDs: {same_quote_results}")
        if sorted(result["status"] for result in stock_results) != ["created", "stock_unavailable"]:
            raise AssertionError(f"one-unit inventory race did not yield one order: {stock_results}")
        result = psql(f"""
select (select allocated from public.inventory where product_id={sql_literal(products[0])}::uuid),
       (select count(*) from public.orders where checkout_quote_id={sql_literal(quotes[0])}::uuid),
       (select allocated from public.inventory where product_id={sql_literal(products[1])}::uuid),
       (select count(*) from public.stock_allocations sa join public.orders o on o.id=sa.order_id where o.checkout_quote_id in ({sql_literal(quotes[1])}::uuid,{sql_literal(quotes[2])}::uuid));
""").splitlines()[-1]
        if result != "1|1|1|1":
            raise AssertionError(f"race changed order/allocation counts unexpectedly: {result}")
    finally:
        psql(f"""
begin;
delete from auth.users where id in ({','.join(sql_literal(item) + '::uuid' for item in users)});
delete from public.products where id in ({','.join(sql_literal(item) + '::uuid' for item in products)});
commit;
""")


if __name__ == "__main__":
    main()
