from __future__ import annotations

import os
import subprocess
import urllib.error
import urllib.request

base_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
anon_key = os.environ["SUPABASE_ANON_KEY"]
service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
object_path = "t09/http-published-check.png"
slug = "t09-storage-http-check"


def sql(statement: str) -> None:
    subprocess.run(["psql", db_url, "--set", "ON_ERROR_STOP=1", "--command", statement], check=True)


def request(
    method: str,
    path: str,
    key: str | None,
    body: bytes | None = None,
    content_type: str = "image/png",
) -> tuple[int, bytes]:
    headers = {}
    if key:
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if body is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


setup = f"""
DO $$ DECLARE pid uuid; BEGIN
  UPDATE public.products SET status='hidden' WHERE slug='{slug}';
  DELETE FROM public.products WHERE slug='{slug}';
  INSERT INTO public.products(category_id,slug,sku,name,brand,description,beginner_note,
    price_tax_included_yen,weight_g,pack_length_mm,pack_width_mm,pack_height_mm)
  SELECT id,'{slug}','T09-HTTP','Storage test product','Test','Description','Note',1000,500,100,100,50
  FROM public.categories WHERE slug='cpu' RETURNING id INTO pid;
  INSERT INTO public.cpu_specs(product_id,socket_code,core_count,base_clock_mhz,tdp_w)
  VALUES(pid,'T09',4,3000,65);
  INSERT INTO public.product_images(product_id,storage_path,alt_text)
  VALUES(pid,'{object_path}','HTTP access test');
  UPDATE public.products SET status='published' WHERE id=pid;
END $$;
"""

try:
    sql(setup)
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082")
    status, _ = request("POST", f"/storage/v1/object/product-images/{object_path}", service_key, png)
    if status not in (200, 201):
        raise RuntimeError(f"Admin fixture upload failed with HTTP {status}")

    # Public bucket URL delivery must stay unavailable because this bucket is private.
    status, _ = request("GET", f"/storage/v1/object/public/product-images/{object_path}", None)
    if status == 200:
        raise RuntimeError("Unauthenticated public object URL bypassed private bucket access")

    # Anonymous JWT download is RLS checked; listing is excluded by the operation-aware policy.
    download = f"/storage/v1/object/authenticated/product-images/{object_path}"
    status, content = request("GET", download, anon_key)
    if status != 200 or content != png:
        raise RuntimeError(f"Published anonymous Storage download failed: HTTP {status}")

    status, listing = request(
        "POST",
        "/storage/v1/object/list/product-images",
        anon_key,
        b'{"prefix":"t09/"}',
        "application/json",
    )
    if object_path.encode() in listing:
        raise RuntimeError("Anonymous Storage listing disclosed product image paths")

    sql(f"UPDATE public.products SET status='hidden' WHERE slug='{slug}'")
    status, _ = request("GET", download, anon_key)
    if status == 200:
        raise RuntimeError("Hidden product image remained downloadable")

    sql(f"UPDATE public.products SET status='draft' WHERE slug='{slug}'")
    status, _ = request("GET", download, anon_key)
    if status == 200:
        raise RuntimeError("Draft product image remained downloadable")
finally:
    request("DELETE", f"/storage/v1/object/product-images/{object_path}", service_key)
    sql(f"UPDATE public.products SET status='hidden' WHERE slug='{slug}'; DELETE FROM public.products WHERE slug='{slug}'")

print("T09 private Storage HTTP access checks passed")
