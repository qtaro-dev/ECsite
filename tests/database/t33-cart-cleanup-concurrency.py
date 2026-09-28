#!/usr/bin/env python3
"""Two cleanup calls are idempotent and never wait on inventory row locks."""

import concurrent.futures
import os
import subprocess
import uuid


DATABASE_URL = os.environ.get("T33_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
user_id, product_id, cart_id, order_id, item_id = [str(uuid.uuid4()) for _ in range(5)]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def psql(sql: str, timeout: int = 15) -> str:
    result = subprocess.run(
        ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, timeout=timeout, check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def cleanup() -> str:
    return psql(f"select public.clear_paid_order_cart({sql_literal(user_id)}::uuid,{sql_literal(order_id)}::uuid)->>'status';")


def main() -> None:
    psql(f"""
insert into auth.users(id,aud,role,email,created_at,updated_at)
 values ({sql_literal(user_id)}::uuid,'authenticated','authenticated',{sql_literal(user_id + '@t33.test')},now(),now());
insert into public.products(id,category_id,slug,sku,name,brand,description,beginner_note,
 price_tax_included_yen,tax_rate_basis_points,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
 values ({sql_literal(product_id)}::uuid,(select id from public.categories where slug='cpu'),
 {sql_literal('t33-concurrency-' + product_id[:8])},{sql_literal('T33-' + product_id[:8])},'T33 fixture','T33 Labs',
 'fixture','fixture',1100,1000,'draft',500,300,200,100);
insert into public.inventory(product_id,on_hand,allocated) values ({sql_literal(product_id)}::uuid,2,0);
insert into public.carts(id,user_id) values ({sql_literal(cart_id)}::uuid,{sql_literal(user_id)}::uuid);
insert into public.cart_items(cart_id,product_id,quantity,updated_at)
 values ({sql_literal(cart_id)}::uuid,{sql_literal(product_id)}::uuid,1,now()-interval '2 hours');
insert into public.orders(id,user_id,status,goods_total_yen,shipping_base_yen,shipping_heavy_yen,
 shipping_total_yen,tax_total_yen,grand_total_yen,shipping_rule_version,origin_snapshot,address_snapshot,
 checkout_key,created_at,paid_at)
 values ({sql_literal(order_id)}::uuid,{sql_literal(user_id)}::uuid,'paid',1100,0,0,0,100,1100,'t33','{{}}','{{}}',
 gen_random_uuid(),now()-interval '1 hour',now());
insert into public.order_items(id,order_id,product_id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen)
 values ({sql_literal(item_id)}::uuid,{sql_literal(order_id)}::uuid,{sql_literal(product_id)}::uuid,'T33','T33 fixture','T33 Labs',1100,1,1100);
""")
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: cleanup(), range(2)))
        if sorted(statuses) != ["cleared", "unchanged"]:
            raise AssertionError(f"concurrent cleanup was not idempotent: {statuses}")
        if psql(f"select count(*) from public.cart_items where cart_id={sql_literal(cart_id)}::uuid;") != "0":
            raise AssertionError("purchased cart line survived")

        # Reinsert a matching line; an unrelated inventory lock must not block
        # this post-payment cart-only transaction.
        psql(f"insert into public.cart_items(cart_id,product_id,quantity,updated_at) values "
             f"({sql_literal(cart_id)}::uuid,{sql_literal(product_id)}::uuid,1,now()-interval '2 hours');")
        holder = subprocess.Popen(
            ["psql", DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        assert holder.stdin is not None and holder.stdout is not None
        holder.stdin.write(f"begin; select product_id from public.inventory where product_id={sql_literal(product_id)}::uuid for update;\n")
        holder.stdin.flush()
        try:
            if holder.stdout.readline().strip() != product_id:
                raise AssertionError("inventory lock holder did not start")
            if cleanup() != "cleared":
                raise AssertionError("cart cleanup waited on unrelated inventory lock")
        finally:
            holder.stdin.write("rollback;\n\\q\n")
            holder.stdin.flush()
            holder.communicate(timeout=10)
    finally:
        psql(f"delete from public.orders where id={sql_literal(order_id)}::uuid; "
             f"delete from public.carts where id={sql_literal(cart_id)}::uuid; "
             f"delete from public.inventory where product_id={sql_literal(product_id)}::uuid; "
             f"delete from public.products where id={sql_literal(product_id)}::uuid; "
             f"delete from auth.users where id={sql_literal(user_id)}::uuid;")


if __name__ == "__main__":
    main()
