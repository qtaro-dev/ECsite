from __future__ import annotations

import os
import urllib.error
import urllib.request

base_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
path = "t11/t15-hidden.png"
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"
)
request = urllib.request.Request(
    f"{base_url}/storage/v1/object/product-images/{path}",
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
            raise RuntimeError(f"Hidden image fixture upload failed: HTTP {response.status}")
except urllib.error.HTTPError as error:
    raise RuntimeError(f"Hidden image fixture upload failed: HTTP {error.code}; {error.read()[:300]!r}") from error

print("T15 hidden image fixture uploaded for Storage RLS browser test")
