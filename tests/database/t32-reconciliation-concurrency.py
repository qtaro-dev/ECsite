#!/usr/bin/env python3
"""Check independent-session SKIP LOCKED claims and T31/T32 order serialization."""

import os
import subprocess
import time
import uuid


DATABASE_URL = os.environ.get("T32_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
user_id, product_id, order_id, attempt_id = [str(uuid.uuid4()) for _ in range(4)]
checkout_key = str(uuid.uuid4())
session_id = f"cs_test_t32_{uuid.uuid4().hex}"


def psql(sql: str, timeout: int = 20) -> str:
    completed = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql failed ({completed.returncode}): {completed.stderr.strip()}")
    return completed.stdout.strip()


def lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def wait_for_advisory_lock(class_id: int, object_id: int) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        available = psql(f"select pg_try_advisory_lock({class_id},{object_id});")
        if available == "f":
            return
        if available != "t":
            raise RuntimeError(f"unexpected advisory lock result: {available}")
        psql(f"select pg_advisory_unlock({class_id},{object_id});")
        time.sleep(0.05)
    raise TimeoutError("lock holder did not acquire the synchronization advisory lock")


def main() -> None:
    setup = f"""
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at)
values ({lit(user_id)}::uuid,'authenticated','authenticated',{lit(user_id + '@t32.test')},now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
  price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
values ({lit(product_id)}::uuid,(select id from public.categories where slug='cpu'),
  {lit('t32-concurrency-' + product_id[:8])},{lit('T32-' + product_id[:8])},'T32 concurrency fixture',
  'T32 Labs','fixture','fixture',100,1000,'draft',500,300,200,100);
insert into public.inventory(product_id,on_hand,allocated) values ({lit(product_id)}::uuid,1,1);
insert into public.orders(id,user_id,status,currency,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
  shipping_total_yen,tax_total_yen,grand_total_yen,tax_rate_basis_points,shipping_rule_version,
  origin_snapshot,address_snapshot,checkout_key)
values ({lit(order_id)}::uuid,{lit(user_id)}::uuid,'payment_pending','JPY',100,0,0,0,9,100,1000,'t32-fixture','{{}}','{{}}',{lit(checkout_key)}::uuid);
insert into public.payment_attempts(id,order_id,attempt_no,state,amount_yen,expires_at,
  stripe_session_id,stripe_session_expires_at,stripe_session_site_origin)
values ({lit(attempt_id)}::uuid,{lit(order_id)}::uuid,1,'processing',100,now()-interval '35 minutes',
  {lit(session_id)},pg_catalog.floor(pg_catalog.date_part('epoch',now()))::bigint-2100,'https://shop.example.test');
insert into public.stock_allocations(order_id,product_id,quantity,expires_at,state)
values ({lit(order_id)}::uuid,{lit(product_id)}::uuid,1,now()-interval '1 minute','active');
commit;
"""
    psql(setup)
    try:
        lock_attempt = subprocess.Popen(
            ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert lock_attempt.stdin is not None
        lock_attempt.stdin.write(
            f"begin; select pg_advisory_lock(32001,1); select id from public.payment_attempts where id={lit(attempt_id)}::uuid for update; select pg_sleep(2); commit;\n"
        )
        lock_attempt.stdin.close()
        wait_for_advisory_lock(32001, 1)
        skipped = psql(
            f"select count(*) from public.claim_expired_checkout_attempts(3) where attempt_id={lit(attempt_id)}::uuid;"
        )
        if skipped != "0":
            raise AssertionError(f"claim did not skip an attempt locked by another session: {skipped}")
        lock_attempt.wait(timeout=10)
        if lock_attempt.returncode != 0:
            raise RuntimeError("attempt lock holder failed")

        claimed = psql(
            f"select count(*) from public.claim_expired_checkout_attempts(3) where attempt_id={lit(attempt_id)}::uuid;"
        )
        if claimed != "1":
            raise AssertionError(f"unlocked due attempt was not claimed: {claimed}")

        # T31 follows the documented order-first lock contract. Hold that row
        # while T32 invokes its service RPC; it must wait, then transition once.
        lock_order = subprocess.Popen(
            ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert lock_order.stdin is not None
        lock_order.stdin.write(
            f"begin; select pg_advisory_lock(32002,1); select id from public.orders where id={lit(order_id)}::uuid for update; select pg_sleep(2); commit;\n"
        )
        lock_order.stdin.close()
        wait_for_advisory_lock(32002, 1)
        started = time.monotonic()
        psql(
            f"select public.apply_checkout_reconciliation({lit(order_id)}::uuid,{lit(attempt_id)}::uuid,'unavailable',"
            + ",".join(["null"] * 18)
            + ");",
            timeout=10,
        )
        elapsed = time.monotonic() - started
        lock_order.wait(timeout=10)
        if lock_order.returncode != 0:
            raise RuntimeError("order lock holder failed")
        if elapsed < 1.0:
            raise AssertionError("T32 did not serialize on the order row before transitioning state")
        final_state = psql(
            f"select o.status || '|' || pa.state || '|' || sa.state from public.orders o "
            f"join public.payment_attempts pa on pa.order_id=o.id "
            f"join public.stock_allocations sa on sa.order_id=o.id where o.id={lit(order_id)}::uuid;"
        )
        if final_state != "review_required|review_required|active":
            raise AssertionError(f"uncertainty did not retain the allocation in review: {final_state}")
    finally:
        psql(f"begin; delete from auth.users where id={lit(user_id)}::uuid; delete from public.products where id={lit(product_id)}::uuid; commit;")


if __name__ == "__main__":
    main()
