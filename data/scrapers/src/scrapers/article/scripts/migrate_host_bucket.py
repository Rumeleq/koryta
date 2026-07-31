"""Online migration: backfill website_index.host_bucket and build its index.

Domain-diversified claiming (postgres_queue.get_batch) needs every pending row
to have a populated host_bucket plus the composite index. Fresh databases get
these from _init_tables; an existing (large, live) queue needs this one-time
backfill. It is written to run *while the crawler keeps crawling*:

  * adds the nullable column (metadata-only, instant),
  * backfills in small autocommitted keyset batches over the primary key so it
    never holds a long lock and skips rows the crawler currently has locked is
    unnecessary — it only writes host_bucket and retries on deadlock,
  * builds the index CONCURRENTLY (no ACCESS EXCLUSIVE lock).

Idempotent: safe to re-run and safe to Ctrl-C and resume.

Usage:
    python -m scrapers.article.scripts.migrate_host_bucket [--batch-size 20000]
"""

from __future__ import annotations

import argparse
import logging
import os
import time

import psycopg

from scrapers.article.postgres_queue import (
    _HOST_BUCKET_INDEX,
    _bucket_expr,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("migrate_host_bucket")


def _connect() -> psycopg.Connection:
    conn = psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        dbname=os.getenv("POSTGRES_DB", "crawler_db"),
        user=os.getenv("POSTGRES_USER", "crawler_user"),
        password=os.getenv("POSTGRES_PASSWORD", "crawler_password"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
    )
    conn.autocommit = True
    return conn


def _add_column(conn: psycopg.Connection) -> None:
    conn.execute("ALTER TABLE website_index ADD COLUMN IF NOT EXISTS host_bucket SMALLINT;")
    logger.info("host_bucket column ensured")


def _backfill(conn: psycopg.Connection, batch_size: int) -> None:
    # Keyset walk over the TEXT primary key: one forward pass, index-friendly,
    # each batch its own transaction so the crawler never waits on us.
    backfill_sql = f"""
        WITH batch AS (
            SELECT id FROM website_index
            WHERE id > %s
            ORDER BY id
            LIMIT %s
        )
        UPDATE website_index wi
        SET host_bucket = {_bucket_expr('wi.url')}
        FROM batch
        WHERE wi.id = batch.id
        RETURNING wi.id;
    """
    last_id = ""
    total = 0
    start = time.monotonic()
    while True:
        for attempt in range(1, 6):
            try:
                cur = conn.execute(backfill_sql, (last_id, batch_size))
                ids = [r[0] for r in cur.fetchall()]
                break
            except psycopg.errors.DeadlockDetected:
                if attempt == 5:
                    raise
                time.sleep(0.2 * 2**attempt)
        if not ids:
            break
        last_id = max(ids)
        total += len(ids)
        if total % (batch_size * 10) < batch_size:
            rate = total / max(1e-6, time.monotonic() - start)
            logger.info("backfilled %d rows (%.0f rows/s)", total, rate)
        time.sleep(0.01)  # be gentle on the live queue
    logger.info("backfill complete: %d rows in %.1fs", total, time.monotonic() - start)


def _build_index(conn: psycopg.Connection) -> None:
    logger.info("building %s CONCURRENTLY (may take a few minutes)...", _HOST_BUCKET_INDEX)
    conn.execute(
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_HOST_BUCKET_INDEX} "
        "ON website_index (host_bucket, priority, id) WHERE done = FALSE;"
    )
    logger.info("index ready")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=20_000)
    parser.add_argument(
        "--skip-backfill",
        action="store_true",
        help="Only ensure the column and index (assume host_bucket already set).",
    )
    args = parser.parse_args()

    conn = _connect()
    try:
        _add_column(conn)
        if not args.skip_backfill:
            _backfill(conn, args.batch_size)
        _build_index(conn)
    finally:
        conn.close()
    logger.info("done. Restart the crawler to use diversified claiming.")


if __name__ == "__main__":
    main()
