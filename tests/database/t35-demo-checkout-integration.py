#!/usr/bin/env python3
"""Integrate demo checkout allocation, mocked Stripe outcomes, and owner RLS."""

import concurrent.futures
import json
import os
import subprocess
import uuid


DATABASE_URL = os.environ.get("T35_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
users = [str(uuid.uuid4()) for _ in range(2)]
addresses = [str(uuid.uuid4()) for _ in users]
quote_ids = [str(uuid.uuid4()) for _ in users]
checkout_keys = [str(uuid.uuid4()) for _ in users]
products = [str(uuid.uuid4()) for _ in range(2)]
slugs = [f"t35-demo-{uuid.uuid4().hex[:12]}" for _ in products]
skus = [f"T35-{uuid.uuid4().hex[:10]}" for _ in products]
success_event_id = "evt_t35_demo_paid_" + uuid.uuid4().hex
failure_event_id = "evt_t35_demo_failed_" + uuid.uuid4().hex


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


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def address(index: int) -> dict:
    return {
        "id": addresses[index], "recipientName": "デモ購入者", "postalCode": "0000000",
        "prefectureCode": 13 + index, "city": "架空市", "street": "デモ専用1番地",
        "building": None, "isDefault": False,
    }


def snapshot(index: int, product_index: int, version: str) -> dict:
    return {
        "address": address(index),
        "items": [{
            "productId": products[product_index], "sku": skus[product_index],
            "name": f"T35 Demo CPU {product_index}", "brand": "T35 Test",
            "category": "cpu", "quantity": 1, "unitPriceYen": 1000,
            "lineTotalYen": 1000, "weightG": 500, "packLengthMm": 300,
            "packWidthMm": 200, "packHeightMm": 100, "specs": {"socket_code": "AM5"},
        }],
        "goodsTotalYen": 1000, "shipping": {"baseYen": 940, "heavyYen": 0, "totalYen": 940},
        "taxTotalYen": 176, "grandTotalYen": 1940,
        "shippingSettingsVersion": version, "compatibility": [],
    }


def create_order(user_id: str, quote_id: str, key: str, body: dict) -> dict:
    output = psql(f"""
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.create_checkout_order({q(user_id)}::uuid,{q(quote_id)}::uuid,{q(key)}::uuid,
  {q(json.dumps(body, ensure_ascii=False, separators=(',', ':')))}::jsonb);
commit;
""")
    for line in reversed(output.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"checkout order response missing: {output}")


def session_for(order: dict) -> str:
    session_id = "cs_test_t35_" + uuid.uuid4().hex
    output = psql(f"""
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.checkout_session_prepare({q(order['orderId'])}::uuid,{q(order['attemptId'])}::uuid,'https://shop.example.test');
select public.checkout_session_record({q(order['orderId'])}::uuid,{q(order['attemptId'])}::uuid,{q(session_id)});
commit;
""")
    results = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
    if [item.get("status") for item in results] != ["prepared", "stored"]:
        raise AssertionError(f"mock Checkout Session was not safely persisted: {results}")
    return session_id


def webhook(order: dict, session_id: str, event_id: str, *, failed: bool) -> dict:
    event_type = "checkout.session.async_payment_failed" if failed else "checkout.session.completed"
    result = "failed" if failed else "succeeded"
    session_status = "complete"
    payment_status = "unpaid" if failed else "paid"
    intent_status = "requires_payment_method" if failed else "succeeded"
    intent_id = "pi_t35_" + uuid.uuid4().hex
    output = psql(f"""
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.apply_stripe_checkout_webhook(
  {q(event_id)},{q(event_type)},{q(result)},{q(order['orderId'])}::uuid,{q(order['attemptId'])}::uuid,
  {q(session_id)},'payment',false,{q(session_status)},{q(payment_status)},1940,'jpy',
  floor(extract(epoch from clock_timestamp()))::bigint,
  (select stripe_session_expires_at from public.payment_attempts where id={q(order['attemptId'])}::uuid),
  {q(order['orderId'])},{q(order['attemptId'])},{q(intent_id)},{q(intent_status)},1940,
  {0 if failed else 1940},'jpy',{q(order['orderId'])},{q(order['attemptId'])});
commit;
""")
    for line in reversed(output.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"webhook result missing: {output}")


def main() -> None:
    version = psql("select version from public.shipping_settings where is_active limit 1;").splitlines()[-1]
    if not version:
        raise AssertionError("active shipping version missing")
    user_rows = ",".join(
        f"({q(user)}::uuid,'authenticated','authenticated',true,now(),now())" for user in users
    )
    addr_rows = ",".join(
        f"({q(addresses[i])}::uuid,{q(users[i])}::uuid,'デモ購入者','0000000',{13+i},'架空市','デモ専用1番地',null,false)"
        for i in range(2)
    )
    product_rows = ",".join(
        f"({q(products[i])}::uuid,(select id from public.categories where slug='cpu'),{q(slugs[i])},{q(skus[i])},"
        f"'T35 Demo CPU {i}','T35 Test','fixture','fixture',1000,1000,'draft',500,300,200,100)"
        for i in range(2)
    )
    cart_rows = ",".join(f"({q(user)}::uuid)" for user in users)
    item_rows = ",".join(
        f"((select id from public.carts where user_id={q(users[i])}::uuid),{q(products[0])}::uuid,1,1000)"
        for i in range(2)
    )
    quote_rows = ",".join(
        f"({q(quote_ids[i])}::uuid,{q(users[i])}::uuid,{q(addresses[i])}::uuid,"
        f"'[{{\"productId\":\"{products[0]}\",\"quantity\":1,\"unitPriceYen\":1000,\"lineTotalYen\":1000}}]'::jsonb,"
        f"1000,940,0,176,1940,{q(version)})"
        for i in range(2)
    )
    psql(f"""
begin;
insert into auth.users(id,aud,role,is_anonymous,created_at,updated_at) values {user_rows};
insert into public.addresses(id,user_id,recipient_name,postal_code,prefecture_code,city,street,building,is_default) values {addr_rows};
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm) values {product_rows};
insert into public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w) values
 ({q(products[0])}::uuid,'AM5',4,3000,65),({q(products[1])}::uuid,'AM5',4,3000,65);
insert into public.product_images(product_id,storage_path,alt_text) values
 ({q(products[0])}::uuid,{q('t35/' + skus[0] + '.png')},'T35 synthetic fixture'),
 ({q(products[1])}::uuid,{q('t35/' + skus[1] + '.png')},'T35 synthetic fixture');
update public.products set status='published' where id in ({q(products[0])}::uuid,{q(products[1])}::uuid);
insert into public.inventory(product_id,on_hand,allocated) values ({q(products[0])}::uuid,1,0),({q(products[1])}::uuid,1,0);
insert into public.carts(user_id) values {cart_rows};
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen) values {item_rows};
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version) values {quote_rows};
commit;
""")
    created_orders: list[dict] = []
    try:
        requests = [
            (users[i], quote_ids[i], checkout_keys[i], snapshot(i, 0, version)) for i in range(2)
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda args: create_order(*args), requests))
        statuses = sorted(row["status"] for row in results)
        if statuses != ["created", "stock_unavailable"]:
            raise AssertionError(f"two demo buyers exceeded the one-unit stock race: {results}")
        success_index = next(i for i, row in enumerate(results) if row["status"] == "created")
        failure_index = 1 - success_index
        success_order = results[success_index]
        created_orders.append(success_order)
        success_session = session_for(success_order)
        if webhook(success_order, success_session, success_event_id, failed=False).get("status") != "processed":
            raise AssertionError("verified mock success did not settle the demo order")
        if webhook(success_order, success_session, success_event_id, failed=False).get("status") != "duplicate":
            raise AssertionError("Stripe webhook redelivery was not deduplicated")
        if webhook(success_order, success_session, success_event_id + "_again", failed=False).get("status") != "processed":
            raise AssertionError("distinct duplicate success event was not idempotent")

        # Give the losing demo buyer a fresh quote on a distinct one-unit item,
        # then model a definitive asynchronous payment failure and its retry.
        user_id, address_id, quote_id, key = users[failure_index], addresses[failure_index], str(uuid.uuid4()), str(uuid.uuid4())
        psql(f"""
begin;
delete from public.cart_items where cart_id=(select id from public.carts where user_id={q(user_id)}::uuid);
insert into public.cart_items(cart_id,product_id,quantity,unit_price_at_add_yen)
  values ((select id from public.carts where user_id={q(user_id)}::uuid),{q(products[1])}::uuid,1,1000);
insert into public.checkout_quotes(id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version)
  values ({q(quote_id)}::uuid,{q(user_id)}::uuid,{q(address_id)}::uuid,
    '[{{"productId":"{products[1]}","quantity":1,"unitPriceYen":1000,"lineTotalYen":1000}}]'::jsonb,
    1000,940,0,176,1940,{q(version)});
commit;
""")
        failed_order = create_order(user_id, quote_id, key, snapshot(failure_index, 1, version))
        if failed_order.get("status") != "created":
            raise AssertionError(f"fresh demo checkout after the stock conflict failed unexpectedly: {failed_order}")
        created_orders.append(failed_order)
        failed_session = session_for(failed_order)
        if webhook(failed_order, failed_session, failure_event_id, failed=True).get("status") != "processed":
            raise AssertionError("verified mock asynchronous failure did not process")
        if webhook(failed_order, failed_session, failure_event_id, failed=True).get("status") != "duplicate":
            raise AssertionError("failed-payment webhook redelivery was not deduplicated")

        final = psql(f"""
select (select status from public.orders where id={q(success_order['orderId'])}::uuid),
       (select state from public.payment_attempts where id={q(success_order['attemptId'])}::uuid),
       (select on_hand||'/'||allocated from public.inventory where product_id={q(products[0])}::uuid),
       (select status from public.orders where id={q(failed_order['orderId'])}::uuid),
       (select state from public.payment_attempts where id={q(failed_order['attemptId'])}::uuid),
       (select state from public.stock_allocations where order_id={q(failed_order['orderId'])}::uuid),
       (select on_hand||'/'||allocated from public.inventory where product_id={q(products[1])}::uuid);
""").splitlines()[-1]
        if final != "paid|succeeded|0/0|payment_failed|failed|released|1/0":
            raise AssertionError(f"demo payment and stock states diverged: {final}")

        for owner, other in ((users[success_index], users[failure_index]), (users[failure_index], users[success_index])):
            claims = json.dumps({"sub": owner, "role": "authenticated", "is_anonymous": True}, separators=(",", ":"))
            visibility = psql(f"""
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',{q(owner)},true);
select set_config('request.jwt.claims',{q(claims)},true);
select (select count(*) from public.orders),
       (select count(*) from public.orders where user_id={q(other)}::uuid),
       (select count(*) from public.order_items oi join public.orders o on o.id=oi.order_id where o.user_id={q(other)}::uuid);
rollback;
""").splitlines()[-1]
            if visibility != "1|0|0":
                raise AssertionError(f"demo checkout leaked another user's order/items: {visibility}")
    finally:
        # Cascades restore Auth, address, cart, quote, order, and payment fixtures.
        psql(f"""
begin;
delete from auth.users where id in ({q(users[0])}::uuid,{q(users[1])}::uuid);
delete from public.products where id in ({q(products[0])}::uuid,{q(products[1])}::uuid);
commit;
""")


if __name__ == "__main__":
    main()
