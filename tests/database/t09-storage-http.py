from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

base_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
anon_key = os.environ["SUPABASE_ANON_KEY"]
jwt_secret = os.environ["JWT_SECRET"].encode()
db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
admin_id = "00000000-0000-0000-0000-000000000099"
object_path = "t09/http-published-check.png"
admin_path = "t09/http-admin-operation.png"
slug = "t09-storage-http-check"


def sql(statement: str) -> None:
    subprocess.run(["psql", db_url, "--set", "ON_ERROR_STOP=1", "--command", statement], check=True)


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


claims = {
    "aud": "authenticated",
    "exp": int(time.time()) + 300,
    "iat": int(time.time()),
    "iss": "supabase",
    "role": "authenticated",
    "sub": admin_id,
}
unsigned = f"{b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())}.{b64url(json.dumps(claims, separators=(',', ':')).encode())}"
admin_jwt = f"{unsigned}.{b64url(hmac.new(jwt_secret, unsigned.encode(), hashlib.sha256).digest())}"


def request(
    method: str,
    path: str,
    api_key: str | None,
    body: bytes | None = None,
    content_type: str = "image/png",
    jwt: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    headers = {}
    if api_key:
        headers = {"apikey": api_key, "Authorization": f"Bearer {jwt or api_key}"}
    if body is not None:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
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
  INSERT INTO auth.users(id,aud,role,email,created_at,updated_at)
  VALUES('{admin_id}','authenticated','authenticated','t09-storage-admin@example.test',now(),now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.admin_memberships(user_id) VALUES('{admin_id}')
  ON CONFLICT(user_id) DO UPDATE SET revoked_at=NULL;
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
    for path in (object_path, admin_path):
        request(
            "DELETE",
            "/storage/v1/object/product-images",
            anon_key,
            json.dumps({"prefixes": [path]}).encode(),
            "application/json",
            admin_jwt,
        )
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082")
    admin_api = {"api_key": anon_key, "jwt": admin_jwt}

    # Exercise admin Storage CRUD via the Storage API; direct table deletes trigger
    # Supabase's internal protect_delete guard and are intentionally not used.
    status, _ = request("POST", f"/storage/v1/object/product-images/{admin_path}", **admin_api, body=png)
    if status not in (200, 201):
        raise RuntimeError(f"Admin Storage upload failed with HTTP {status}")
    admin_download = f"/storage/v1/object/authenticated/product-images/{admin_path}"
    status, content = request("GET", admin_download, **admin_api)
    if status != 200 or content != png:
        raise RuntimeError(f"Admin Storage read failed: HTTP {status}")
    replacement = png + b"admin-update"
    status, _ = request(
        "POST",
        f"/storage/v1/object/product-images/{admin_path}",
        **admin_api,
        body=replacement,
        extra_headers={"x-upsert": "true"},
    )
    if status not in (200, 201):
        raise RuntimeError(f"Admin Storage overwrite failed with HTTP {status}")
    status, content = request("GET", admin_download, **admin_api)
    if status != 200 or content != replacement:
        raise RuntimeError(f"Admin Storage updated read failed: HTTP {status}")
    status, _ = request(
        "DELETE",
        "/storage/v1/object/product-images",
        **admin_api,
        body=json.dumps({"prefixes": [admin_path]}).encode(),
        content_type="application/json",
    )
    if status not in (200, 204):
        raise RuntimeError(f"Admin Storage delete failed with HTTP {status}")
    status, _ = request("GET", admin_download, **admin_api)
    if status == 200:
        raise RuntimeError("Admin-deleted Storage object remained downloadable")

    # Upload the catalog image through an active admin JWT and verify publish-aware reads.
    status, _ = request("POST", f"/storage/v1/object/product-images/{object_path}", **admin_api, body=png)
    if status not in (200, 201):
        raise RuntimeError(f"Admin catalog image upload failed with HTTP {status}")

    # Public bucket URL delivery must stay unavailable because this bucket is private.
    status, _ = request("GET", f"/storage/v1/object/public/product-images/{object_path}", None)
    if status == 200:
        raise RuntimeError("Unauthenticated public object URL bypassed private bucket access")

    # Anonymous JWT download is RLS checked; object.list cannot disclose the storage path.
    download = f"/storage/v1/object/authenticated/product-images/{object_path}"
    status, content = request("GET", download, anon_key)
    if status != 200 or content != png:
        raise RuntimeError(f"Published anonymous Storage download failed: HTTP {status}")
    _, listing = request(
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
    for path in (object_path, admin_path):
        request(
            "DELETE",
            "/storage/v1/object/product-images",
            anon_key,
            json.dumps({"prefixes": [path]}).encode(),
            "application/json",
            admin_jwt,
        )
    sql(
        f"UPDATE public.products SET status='hidden' WHERE slug='{slug}'; "
        f"DELETE FROM public.products WHERE slug='{slug}'; "
        f"DELETE FROM auth.users WHERE id='{admin_id}'"
    )

print("T09 private Storage HTTP access checks passed")
