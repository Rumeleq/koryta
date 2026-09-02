import json

import pandas as pd

from external.url_store_client import UrlStoreClient
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue
from scrapers.stores import Context, DoneUrl


def _normalize_url(url: str) -> str:
    """Canonical key for dedup: drop protocol prefix and trailing slash."""
    for prefix in ("https://", "http://"):
        if url.startswith(prefix):
            url = url[len(prefix) :]
            break
    return url.rstrip("/")


def _fetch_url_store() -> list[DoneUrl]:
    client = UrlStoreClient.from_env()
    results, offset = [], 0
    while True:
        page = client.list_urls(status="fetched", limit=500, offset=offset)
        for url in page:
            if url.storage_path:
                results.append(
                    DoneUrl(
                        url=url.url,
                        uid=str(url.id),
                        storage_path=url.storage_path,
                        media_type="text/html",
                    )
                )
        if len(page) < 500:
            break
        offset += 500
    return results


def _fetch_postgres() -> list[DoneUrl]:
    pg_client = PostgresClient.from_env(max_size=1)
    try:
        return PostgresCrawlQueue(pg_client).get_done_urls()
    finally:
        pg_client.close()


class ArticleDoneUrls(IncrementalJsonlPipeline[DoneUrl]):
    filename = "article_done_urls"
    backup_to_shared_cache = False  # ~2GB output, keep local-only
    interrupt_exceptions = (KeyboardInterrupt, InterruptedError)
    interrupt_note = (
        "will save the done URLs written so far (incomplete — rerun to fill the rest)"
    )

    @property
    def output_class(self):
        return DoneUrl

    def process(self, ctx: Context):
        if ctx.crawl_queue is not None:
            pg_urls = ctx.crawl_queue.get_done_urls()
        else:
            pg_urls = _fetch_postgres()

        url_store_urls = _fetch_url_store()

        total = len(pg_urls) + len(url_store_urls)
        print(
            f"Done URLs — postgres: {len(pg_urls):,}, "
            f"url_store: {len(url_store_urls):,}, total: {total:,}"
        )

        self.prepare_temp_output()
        n_postgres = len(pg_urls)
        all_urls = pg_urls + url_store_urls

        # Standardize URL format across sources so the same article yields the
        # same string: postgres URLs have no protocol prefix while url_store URLs
        # carry https://. Canonicalize to the no-protocol form, then dedupe
        # (keeping the first occurrence — postgres wins, pg_urls come first) and
        # stream each record straight to the temp file instead of materializing
        # a multi-GB DataFrame.
        seen: set[str] = set()
        dupes = 0
        kept = 0
        with self.temp_output_path.open("a", encoding="utf-8") as handle:
            for i, done in enumerate(all_urls):
                canonical = _normalize_url(done.url)
                if canonical in seen:
                    dupes += 1
                    continue
                seen.add(canonical)
                record = {
                    "uid": done.uid,
                    "url": canonical,
                    "storage_path": done.storage_path,
                    "media_type": getattr(done, "media_type", None),
                    "source": "postgres" if i < n_postgres else "url_store",
                }
                handle.write(json.dumps(record) + "\n")
                kept += 1
                if kept % 10000 == 0:
                    handle.flush()
        print(f"Dropped {dupes:,} cross-source duplicate URLs, kept {kept:,}")
        return pd.DataFrame()
