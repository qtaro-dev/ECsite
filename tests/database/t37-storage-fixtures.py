from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request

base_url = os.environ["SUPABASE_URL"].rstrip("/")
service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"
)
product_id = "00000000-0000-4000-8000-000000000380"
paths = [
    f"{product_id}/00000000-0000-4000-8000-000000000390.png",
    f"{product_id}/00000000-0000-4000-8000-000000000391.png",
    f"{product_id}/00000000-0000-4000-8000-000000000392.png",
    "00000000-0000-4000-8000-000000000381/00000000-0000-4000-8000-000000000393.png",
]

for path in paths:
    encoded_path = urllib.parse.quote(path, safe="/")
    request = urllib.request.Request(
        f"{base_url}/storage/v1/object/product-images/{encoded_path}",
        data=png,
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status not in (200, 201):
                raise RuntimeError(f"T37 Storage fixture upload failed: HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"T37 Storage fixture upload failed: HTTP {error.code}; {error.read()[:200]!r}") from error

print(f"T37 private Storage fixtures uploaded ({len(paths)} synthetic images)")
