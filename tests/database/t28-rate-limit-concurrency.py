#!/usr/bin/env python3
"""Exercise the quote limiter concurrently against the CI-only local database."""

import concurrent.futures
import os
import subprocess
import sys

DATABASE_URL = os.environ.get("T28_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
USER_ID = "00000000-0000-4000-8000-000000000281"
PSQL = os.environ.get("PSQL", "psql")


def run_sql(sql: str) -> str:
    result = subprocess.run(
        [PSQL, DATABASE_URL, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(f"psql failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""


def call_limiter(_: int) -> tuple[bool, int]:
    sql = (
        "set role service_role; set request.jwt.claim.role='service_role'; "
        f"select allowed, retry_after_seconds from public.checkout_quote_rate_limit('{USER_ID}');"
    )
    row = run_sql(sql).split("|")
    if len(row) != 2 or row[0] not in {"t", "f"}:
        raise RuntimeError(f"unexpected limiter result: {row}")
    return row[0] == "t", int(row[1])


def main() -> None:
    run_sql(
        "insert into auth.users(id,aud,role,email,created_at,updated_at) "
        f"values ('{USER_ID}','authenticated','authenticated','t28-rate-parallel@example.test',now(),now()) "
        "on conflict (id) do nothing; "
        f"delete from public.checkout_quote_rate_limits where user_id='{USER_ID}';"
    )
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(call_limiter, range(10)))
        allowed = sum(1 for is_allowed, _ in results if is_allowed)
        denied = [retry for is_allowed, retry in results if not is_allowed]
        if allowed != 5 or len(denied) != 5 or any(retry < 1 or retry > 60 for retry in denied):
            raise RuntimeError(f"expected 5 allowed and 5 denied calls atomically; got {results}")
        print("T28 quote limiter concurrency: 5 allowed, 5 rate limited")
    finally:
        run_sql(f"delete from auth.users where id='{USER_ID}';")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # surfaced as a failing CI step
        print(str(error), file=sys.stderr)
        raise
