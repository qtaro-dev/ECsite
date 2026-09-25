from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request

base_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
anon_key = os.environ["SUPABASE_ANON_KEY"]
service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# A valid 1 x 1 PNG used only as a non-broken local/demo image placeholder.
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082"
)
slugs = (
    "t11-cpu-am5", "t11-cpu-am4", "t11-cpu-unknown", "t11-gpu-300", "t11-gpu-340",
    "t11-gpu-unknown", "t11-motherboard-atx", "t11-memory-ddr5", "t11-memory-ddr4",
    "t11-memory-unknown", "t11-ssd", "t11-psu", "t11-case-atx", "t11-case-itx",
    "t11-case-unknown", "t11-cooler-am5", "t11-cooler-lga", "t11-cooler-unknown",
)


def request(method: str, path: str, key: str, body: bytes | None = None, upsert: bool = False) -> tuple[int, bytes]:
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if body is not None:
        headers["Content-Type"] = "image/png"
    if upsert:
        headers["x-upsert"] = "true"
    req = urllib.request.Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


for slug in slugs:
    path = f"t11/{slug}.png"
    encoded_path = urllib.parse.quote(path, safe="/")
    status, response = request(
        "POST", f"/storage/v1/object/product-images/{encoded_path}", service_role_key, png, upsert=True
    )
    if status not in (200, 201):
        raise RuntimeError(f"Storage placeholder upload failed for {slug}: HTTP {status}; {response[:300]!r}")

    status, downloaded = request(
        "GET", f"/storage/v1/object/authenticated/product-images/{encoded_path}", anon_key
    )
    if status != 200 or downloaded != png:
        raise RuntimeError(f"Published fixture image unavailable to anon for {slug}: HTTP {status}")

print(f"T11 Storage fixture check passed ({len(slugs)} placeholder images uploaded and readable)")
