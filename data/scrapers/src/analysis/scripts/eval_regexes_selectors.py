"""Evaluate regex+selector coverage across all regexed domains.

For every domain in ``article_url_regexes.json``:
1. Sample up to ``--samples`` (20) URLs per domain from ``article_parsed.jsonl``
   (DuckDB per-domain window; random order via `random()` sort key).
2. Keep only those matching the domain's article regex and with local HTML.
3. For each URL record:
   - whether a verified selector exists for the domain
   - the extracted content length using that selector
   - the old parse_status
4. Write a JSONL report (one line per domain) plus a full per-URL file for later
   manual review.

Run from ``data/scrapers``::

    PYTHONPATH=src .venv/bin/python -m analysis.scripts.eval_regexes_selectors \
        --out /tmp/eval/domain_report.jsonl --urls /tmp/eval/urls.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
from pathlib import Path

import duckdb
from bs4 import BeautifulSoup

from entities.util import NormalizedParse

_PARSED = "versioned/article_parsed/article_parsed.jsonl"
_REGEX_FILE = Path("src") / "scrapers" / "article" / "pipelines" / "article_url_regexes.json"
_VERIFIED = Path("src") / "scrapers" / "article" / "pipelines" / "verified_selectors.json"

_MIN_CONTENT = 300
_MAX_CONTENT = 20000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--out", type=Path, default=Path("/tmp/eval/domain_report.jsonl"))
    parser.add_argument("--urls", type=Path, default=Path("/tmp/eval/urls.jsonl"))
    parser.add_argument("--max-domains", type=int, default=0)
    parser.add_argument("--regex-file", type=Path, default=_REGEX_FILE)
    parser.add_argument("--verified", type=Path, default=_VERIFIED)
    return parser.parse_args()


def host_of(url: str) -> str:
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/", 1)[0]


def sp_is_local(sp: str, local_tars: set[str]) -> bool:
    return sp.startswith("gs://") and (
        "downloaded/" + sp.removeprefix("gs://koryta-pl-crawled/").replace("/", ".")
        in local_tars
    )


def member_path(url: str) -> str:
    parsed = NormalizedParse.parse(url)
    path = parsed.path if parsed.path else "index"
    return f"{parsed.hostname}/{path}".replace("//", "/").rstrip("/")


def extract_len(html: bytes, selector: str | None) -> int:
    if not selector:
        return 0
    try:
        el = BeautifulSoup(html, "lxml").select_one(selector)
    except Exception:
        return 0
    if el is None:
        return 0
    return len(el.get_text(" ", strip=True))


def main() -> int:
    args = parse_args()
    regexes = json.load(open(args.regex_file))
    verified = json.load(open(args.verified))
    local_tars = {"downloaded/" + n for n in os.listdir("downloaded")}

    compiled: dict[str, re.Pattern] = {}
    for d, p in regexes.items():
        try:
            compiled[d] = re.compile(p)
        except re.error:
            continue

    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false")

    # Sample up to N rows per domain (random order) — one pass, ~30k rows total.
    rows = con.execute(
        f"""
        WITH ranked AS (
          SELECT url, domain, storage_path, parse_status,
                 row_number() OVER (PARTITION BY domain ORDER BY random()) AS rn
          FROM read_json_auto('{_PARSED}',
            format='newline_delimited', maximum_object_size=100000000, ignore_errors=true)
        )
        SELECT url, domain, storage_path, parse_status
        FROM ranked WHERE rn <= {args.samples}
        """
    ).fetchall()
    print(f"sampled {len(rows):,} rows", flush=True)

    # Filter: local storage + regex match
    by_dom: dict[str, list] = {}
    for url, dom, sp, st in rows:
        if not sp_is_local(sp, local_tars):
            continue
        rg = compiled.get(dom)
        if rg is not None and rg.search(url):
            by_dom.setdefault(dom, []).append((url, sp, st))

    domains = sorted(by_dom, key=lambda d: -len(by_dom[d]))
    if args.max_domains:
        domains = domains[: args.max_domains]
    print(f"{len(domains)} domains with regex-matched samples", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.urls.parent.mkdir(parents=True, exist_ok=True)

    try:
        from tqdm import tqdm
    except Exception:
        tqdm = None

    with args.out.open("w", encoding="utf-8") as drep, args.urls.open("w", encoding="utf-8") as urep:
        iterator = enumerate(domains, 1)
        if tqdm is not None:
            iterator = tqdm(enumerate(domains, 1), total=len(domains),
                            desc="evaluating", unit="domain", mininterval=1.0)
        for i, dom in iterator:
            entries = by_dom[dom]
            sample = entries[: args.samples]
            selector = verified.get(dom)
            has_selector = bool(selector)
            ok_count = 0
            content_count = 0
            valid_content = 0

            # group sample URLs by storage_path so each tar is opened once
            by_sp: dict[str, list] = {}
            for url, sp, st in sample:
                if st == "ok":
                    ok_count += 1
                by_sp.setdefault(sp, []).append((url, st))

            for sp, items in by_sp.items():
                tar_path = Path("downloaded") / sp.removeprefix(
                    "gs://koryta-pl-crawled/").replace("/", ".")
                try:
                    tar = tarfile.open(tar_path, "r:gz")
                except Exception:
                    for url, _st in items:
                        urep.write(json.dumps({
                            "domain": dom, "url": url, "len": None,
                            "has_selector": has_selector, "old_status": _st,
                            "good": False, "note": "bad_tar",
                        }, ensure_ascii=False) + "\n")
                    continue
                members = {m.name: m for m in tar.getmembers()}
                for url, st in items:
                    m = members.get(member_path(url))
                    ln = 0
                    if m is not None:
                        ln = extract_len(tar.extractfile(m).read(), selector)
                    if ln:
                        content_count += 1
                    if _MIN_CONTENT <= ln <= _MAX_CONTENT:
                        valid_content += 1
                    urep.write(json.dumps({
                        "domain": dom, "url": url, "len": ln,
                        "has_selector": has_selector, "old_status": st,
                        "good": _MIN_CONTENT <= ln <= _MAX_CONTENT,
                    }, ensure_ascii=False) + "\n")
                tar.close()

            n = len(sample)
            report = {
                "domain": dom,
                "n": n,
                "has_selector": has_selector,
                "selector": selector,
                "old_ok": ok_count,
                "extract_any": content_count,
                "good_content": valid_content,
                "good_pct": (100.0 * valid_content / n) if n else 0.0,
            }
            drep.write(json.dumps(report, ensure_ascii=False) + "\n")
            drep.flush()
            if i % 50 == 0 or i == len(domains):
                print(
                    f"[{i}/{len(domains)}] {dom:<28} sel={'Y' if has_selector else '-'} "
                    f"good={valid_content}/{n}",
                    flush=True,
                )
    print(f"\ndone -> {args.out} and {args.urls}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
