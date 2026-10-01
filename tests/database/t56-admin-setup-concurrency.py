#!/usr/bin/env python3
"""Verify concurrent first-owner setup requests create exactly one claim."""

from __future__ import annotations

import concurrent.futures
import os
import subprocess
import sys
import uuid

DATABASE_URL = os.environ.get("T56_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
PSQL = os.environ.get("PSQL", "psql")
users = [str(uuid.uuid4()), str(uuid.uuid4())]
requests = [f"t56-race-{uuid.uuid4().hex}", f"t56-race-{uuid.uuid4().hex}"]


def sql(query: str) -> str:
    result = subprocess.run(
        [PSQL, DATABASE_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=query, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"psql failed ({result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""


def attempt(index: int) -> str:
    return sql(f"""
set role service_role;
set request.jwt.claim.role='service_role';
set request.jwt.claims='{{"role":"service_role"}}';
select pg_catalog.pg_sleep(0.2);
select public.bootstrap_first_admin('{users[index]}'::uuid,'{requests[index]}');
""")


def main() -> None:
    if sql("select exists(select 1 from public.admin_setup_claim) or exists(select 1 from public.admin_memberships);") != "f":
        raise RuntimeError("T56 concurrency test requires an unused local setup state")
    sql("""
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at,is_anonymous) values
""" + ",\n".join(
        f"('{user}','authenticated','authenticated','{user}@t56-race.test',now(),now(),false)" for user in users
    ) + ";\ncommit;")
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, range(2)))
        if sorted(results) != ["f", "t"]:
            raise RuntimeError(f"expected exactly one successful setup claim, got {results}")
        state = sql("select (select count(*) from public.admin_setup_claim)||':'||"
                    "(select count(*) from public.admin_memberships)||':'||"
                    "(select count(*) from public.audit_logs where request_id like 't56-race-%');")
        if state != "1:1:1":
            raise RuntimeError(f"concurrent setup left incomplete state {state}; expected 1:1:1")
        print("T56 concurrent setup: exactly one claim, membership, and audit record")
    finally:
        # Keep append-only audit rows intact. Deleting Auth users unlinks their actor id;
        # this disposable CI database then removes the durable setup claim explicitly.
        sql("begin; "
            f"delete from auth.users where id in ('{users[0]}','{users[1]}'); "
            "delete from public.admin_setup_claim where id=1; commit;")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # surfaced as a failing CI step
        print(str(error), file=sys.stderr)
        raise
