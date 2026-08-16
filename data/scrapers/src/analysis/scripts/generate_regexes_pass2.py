"""Second-pass LLM regex generation for domains the first pass missed.

Improvements over the first pass:
- harder tag filtering of positives (also removes `,tag,` and `/artykul/tag/`)
- a URL-shape hint (dominant generalized path patterns with counts) so the
  LLM sees the article-ID idiom explicitly
- more positives (30) and negatives (15) per prompt
- up to 3 attempts (initial + 2 feedback retries)

Run from ``data/scrapers``::

    PYTHONPATH=src .venv/bin/python -m analysis.scripts.generate_regexes_pass2 \
        --failed /tmp/all_regexes.jsonl --out /tmp/pass2.jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import re
import sys
import textwrap
from pathlib import Path

import duckdb

from scrapers.stores import LLMRequest
from stores.llm import OpenAICompatibleConfig, OpenAICompatibleMultiPortLLM

_PARSED = "versioned/article_parsed/article_parsed.jsonl"
_SCORES = "versioned/article_koryciarski_scores/article_koryciarski_scores.jsonl"
_REGEX_FILE = Path("src") / "scrapers" / "article" / "pipelines" / "article_url_regexes.json"
MODEL = "Qwen/Qwen3-32B"

# path fragments that mark a URL as definitely NOT an article (harder filter)
NON_ARTICLE = re.compile(
    r"/(?:tag|tags|tagi|kategoria|category|galeria|galerie|page|strona|autor|author|"
    r"szukaj|search|kontakt|o-nas|regulamin|reklama|newsletter|archiwum|fotogaleria)/"
    r"|^tag[-,]|,tag,|/tag/"
)

BASE_PROMPT = textwrap.dedent(
    """\
    Write ONE Python regex string identifying REAL ARTICLE URLs on Polish news site "{domain}".

    URL SHAPE ANALYSIS (paths with digit runs shown as #; most common first):
    {shapes}

    POSITIVES (real articles):
    {pos}

    NEGATIVES (not articles: tags, listings, galleries, categories):
    {neg}

    RULES:
    - re.search() runs against the FULL URL including hostname (e.g. "domain.pl/..."),
      so do NOT anchor with ^ unless you include the host.
    - The SHAPE ANALYSIS shows the dominant URL structures. The article idiom is
      usually the segment that differs between articles and non-articles: a comma-id
      (",art123" or ",123456,"), a numeric segment ("/aktualnosci/12345",
      "/articles/view/12345/", "/powiat/14538-slug"), a date path ("/2024/05/27/"),
      an id-slug ("/12345-title", "/slug-n123456"), a trailing code, or a PolskaPress
      "/ar/" or "/gh/" segment.
    - If articles have NO distinguishing id (all URLs are free-form slugs), use the
      category prefix that articles share, or return the most specific pattern that
      still captures >= 80% of the positives.
    - Do NOT copy literal words from the examples. Use \\d+ for digit runs.
    - Keep it SIMPLE: one pattern, at most 3 alternatives, NO lookbehind, NO lookahead.
    - Output ONLY the regex string. No fences, no explanation.
    """
)

RETRY_PROMPT = textwrap.dedent(
    """\
    Your previous regex for "{domain}" was:
    {prev}

    Problems:
    {problems}

    SHAPES:
    {shapes}

    POSITIVES:
    {pos}
    NEGATIVES:
    {neg}

    Write a corrected, SIMPLE regex. Same rules. Output ONLY the regex string.
    """
)


def host_of(url: str) -> str:
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/", 1)[0]


def is_clean_positive(url: str) -> bool:
    path = url.split("/", 1)[1] if "/" in url else ""
    return not NON_ARTICLE.search("/" + path)


def shape_hint(urls: list[str], limit: int = 6) -> str:
    def gen(p: str) -> str:
        p = re.sub(r"\d+", "#", p)
        return p

    shapes = collections.Counter(
        gen(u.split("/", 1)[1] if "/" in u else "") for u in urls
    )
    lines = []
    for s, n in shapes.most_common(limit):
        lines.append(f"  {n}x  {s[:70]}")
    return "\n".join(lines) if lines else "  (none)"


def normalize(rx: str | None) -> str | None:
    if not rx:
        return None
    rx = rx.strip().strip("`").strip()
    m = re.fullmatch(r"[rR]?'(.+)'|[rR]?\"(.+)\"", rx, re.S)
    if m:
        rx = (m.group(1) or m.group(2)).strip()
    if rx.startswith("^/"):
        rx = rx[1:]
    return rx


def score(rx: str | None, positives: list[str], negatives: list[str]) -> tuple[int, int]:
    if not rx:
        return 0, 0
    try:
        r = re.compile(rx)
    except re.error:
        return 0, 0
    rec = sum(1 for u in positives if r.search(u))
    nh = sum(1 for u in negatives if r.search(u))
    return rec, nh


def passes(rec: int, nh: int, n_pos: int, n_neg: int) -> bool:
    if rec < 0.80 * n_pos:
        return False
    if n_neg <= 5:
        return nh <= n_neg
    return nh <= max(5, int(0.3 * n_neg))


def fmt_problems(rx: str, positives: list[str], negatives: list[str], rec: int, nh: int) -> str:
    try:
        r = re.compile(rx)
    except re.error as exc:
        return f"previous regex did not compile: {exc}"
    missed = [u for u in positives if not r.search(u)][:4]
    hit = [u for u in negatives if r.search(u)][:4]
    parts = [f"recall {rec}/{len(positives)}, negatives matched {nh}/{len(negatives)}"]
    if missed:
        parts.append("missed positives: " + "; ".join(missed))
    if hit:
        parts.append("wrongly matched: " + "; ".join(hit))
    return "\n".join(parts)


async def ask(llm: OpenAICompatibleMultiPortLLM, prompt: str) -> tuple[str | None, str | None]:
    request = LLMRequest(prompt=prompt, max_tokens=250, temperature=0, model=MODEL)
    async with llm.response_pool() as pool:
        request_id = await pool.put_request(request)
        _request_id, response = await pool.get_response()
    if isinstance(response, Exception):
        return None, str(response)
    return response.content, None


async def process_domain(
    llm: OpenAICompatibleMultiPortLLM,
    domain: str,
    positives: list[str],
    negatives: list[str],
    max_attempts: int = 3,
) -> dict:
    if not positives:
        return {"domain": domain, "status": "no_positives"}
    if len(positives) < 10:
        return {"domain": domain, "status": "too_few_positives", "n_pos": len(positives)}

    shapes = shape_hint(positives)
    pos_blob = "\n".join(positives[:30])
    neg_blob = "\n".join(negatives[:15]) if negatives else "(none)"

    attempts = []
    prompt = BASE_PROMPT.format(domain=domain, shapes=shapes, pos=pos_blob, neg=neg_blob)
    rx, err = await ask(llm, prompt)
    if err:
        return {"domain": domain, "status": "error", "error": err}
    rx = normalize(rx)
    rec, nh = score(rx, positives, negatives)
    attempts.append((rx, rec, nh))
    if passes(rec, nh, len(positives), len(negatives)):
        return {
            "domain": domain, "status": "ok", "regex": rx,
            "recall": rec, "neg_hit": nh, "total": len(positives), "attempts": len(attempts),
        }

    for _ in range(max_attempts - 1):
        problems = fmt_problems(rx, positives, negatives, rec, nh)
        prompt2 = RETRY_PROMPT.format(
            domain=domain, prev=rx, problems=problems, shapes=shapes,
            pos=pos_blob, neg=neg_blob,
        )
        rx2, err2 = await ask(llm, prompt2)
        if err2:
            return {"domain": domain, "status": "error", "error": err2}
        rx2 = normalize(rx2)
        rec2, nh2 = score(rx2, positives, negatives)
        attempts.append((rx2, rec2, nh2))
        if passes(rec2, nh2, len(positives), len(negatives)):
            return {
                "domain": domain, "status": "ok", "regex": rx2,
                "recall": rec2, "neg_hit": nh2, "total": len(positives), "attempts": len(attempts),
            }
        rx, rec, nh = rx2, rec2, nh2

    return {
        "domain": domain, "status": "failed",
        "attempts": [{"regex": a[0], "recall": a[1], "neg_hit": a[2]} for a in attempts],
        "total": len(positives),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--failed", type=Path, default=Path("/tmp/all_regexes.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("/tmp/pass2.jsonl"))
    parser.add_argument("--max-domains", type=int, default=0)
    parser.add_argument("--attempts", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    global MODEL

    # domains that still lack a regex after pass 1
    existing = json.load(open(_REGEX_FILE))
    failed = []
    with args.failed.open(encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            if r.get("status") == "failed" and r["domain"] not in existing:
                failed.append(r["domain"])
            elif r.get("status") in ("no_positives", "too_few_positives") and r["domain"] not in existing:
                failed.append(r["domain"])
    # resume: skip domains already in the output file
    done: set[str] = set()
    if args.out.exists():
        with args.out.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    done.add(json.loads(line)["domain"])
                except Exception:
                    pass
    failed = sorted(set(d for d in failed if d not in done), key=lambda d: -len(d))
    if args.max_domains:
        failed = failed[: args.max_domains]
    print(f"{len(failed)} domains for second pass (resuming, {len(done)} already done)", flush=True)

    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false")
    pos_rows = con.execute(
        f"SELECT url FROM read_json_auto('{_SCORES}', "
        "format='newline_delimited', maximum_object_size=100000000, ignore_errors=true) "
        "WHERE llm_is_article = true"
    ).fetchall()
    dom_list = ", ".join("'" + d.replace("'", "''") + "'" for d in failed)
    neg_rows = con.execute(
        f"SELECT url, domain FROM read_json_auto('{_PARSED}', "
        "format='newline_delimited', maximum_object_size=100000000, ignore_errors=true) "
        f"WHERE domain IN ({dom_list})"
    ).fetchall()
    positives: dict[str, list[str]] = collections.defaultdict(list)
    negatives: dict[str, list[str]] = collections.defaultdict(list)
    for (u,) in pos_rows:
        if is_clean_positive(u):
            positives[host_of(u)].append(u)
    for u, d in neg_rows:
        if isinstance(u, str) and NON_ARTICLE.search("/" + (u.split("/", 1)[1] if "/" in u else "")):
            negatives[d].append(u)
    print("loaded positives/negatives", flush=True)

    llm = OpenAICompatibleMultiPortLLM(
        OpenAICompatibleConfig(ports=(6000,), per_port_concurrency=1, model=MODEL)
    )
    okn = fail = 0
    with args.out.open("w", encoding="utf-8") as out:
        for i, dom in enumerate(failed, 1):
            result = asyncio.run(
                process_domain(llm, dom, positives.get(dom, []), negatives.get(dom, []), args.attempts)
            )
            out.write(json.dumps(result, ensure_ascii=False) + "\n")
            out.flush()
            if result["status"] == "ok":
                okn += 1
                print(
                    f"[{i}/{len(failed)}] OK   {dom:<28} "
                    f"recall={result['recall']}/{result['total']} "
                    f"neg={result['neg_hit']}  {result['regex'][:50]}",
                    flush=True,
                )
            elif result["status"] == "failed":
                fail += 1
                best = max(a["recall"] for a in result["attempts"])
                print(f"[{i}/{len(failed)}] FAIL {dom:<28} best_recall={best}/{result['total']}", flush=True)
            else:
                print(f"[{i}/{len(failed)}] {result['status'].upper():<4} {dom}", flush=True)
    print(f"\ndone: ok={okn} failed={fail} -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
