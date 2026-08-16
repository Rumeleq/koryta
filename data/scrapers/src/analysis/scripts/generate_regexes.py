"""Generate per-domain article URL regexes using the local LLM (vLLM).

For every domain in ``article_parsed.jsonl`` with at least ``--min-links`` rows
that has no regex yet in ``article_url_regexes.json``, sample LLM-verified
article URLs (``article_koryciarski_scores`` with ``llm_is_article=true``) as
positives and known non-articles as negatives, ask the LLM to write a regex,
then score it and retry once with feedback if it fails the bar.

Usage (from ``data/scrapers``)::

    PYTHONPATH=src .venv/bin/python -m analysis.scripts.generate_regexes \
        --min-links 100 --out /tmp/regexes.json

Results are JSON lines: {"domain", "status", "regex", "recall", "neg_hit", ...}.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import textwrap
from collections import defaultdict
from pathlib import Path

import duckdb

from scrapers.stores import LLMRequest
from stores.llm import OpenAICompatibleConfig, OpenAICompatibleMultiPortLLM

_PARSED = "versioned/article_parsed/article_parsed.jsonl"
_SCORES = "versioned/article_koryciarski_scores/article_koryciarski_scores.jsonl"
_REGEX_FILE = Path("src") / "scrapers" / "article" / "pipelines" / "article_url_regexes.json"
MODEL = "Qwen/Qwen3-32B"

# path fragments that mark a URL as definitely NOT an article
NON_ARTICLE = re.compile(
    r"/(?:tag|tags|tagi|kategoria|category|galeria|galerie|page|strona|autor|author|"
    r"szukaj|search|kontakt|o-nas|regulamin|reklama|newsletter|archiwum)/|^tag[-,]"
)

BASE_PROMPT = textwrap.dedent(
    """\
    Write ONE Python regex string identifying REAL ARTICLE URLs on Polish news site "{domain}".

    POSITIVES (real articles):
    {pos}

    NEGATIVES (not articles: tags, listings, galleries, categories):
    {neg}

    RULES:
    - re.search() runs against the FULL URL including the hostname (e.g. "domain.pl/..."),
      so do NOT anchor with ^ unless you include the host.
    - Focus on the per-article ID idiom. Common Polish patterns: ",art123", "/art/12345",
      "/aktualnosci/12345", "/articles/view/12345/", "/12345-title", "/ar/c1-123456",
      "/gh/c1p2-123456", "-1234567890123456a", or a trailing short code.
    - If a site uses the PolskaPress template, article URLs contain "/ar/" or "/gh/" segments.
    - Do NOT copy literal words from the examples. Use \\d+ for digit runs.
    - Keep it SIMPLE: one pattern, at most 2 alternatives, NO lookbehind, NO lookahead.
    - Output ONLY the regex string. No fences, no explanation.
    """
)

RETRY_PROMPT = textwrap.dedent(
    """\
    Your previous regex for "{domain}" was:
    {prev}

    Problems:
    {problems}

    POSITIVES:
    {pos}
    NEGATIVES:
    {neg}

    Write a corrected, SIMPLE regex. Same rules (no lookbehind/lookahead, <=2 alternatives).
    Output ONLY the regex string.
    """
)


def host_of(url: str) -> str:
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/", 1)[0]


def is_clean_positive(url: str) -> bool:
    path = url.split("/", 1)[1] if "/" in url else ""
    return not NON_ARTICLE.search("/" + path)


def load_regex_keys(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def regex_key_for(host: str, regexes: dict[str, str]) -> str | None:
    if host in regexes:
        return host
    best: tuple[int, str] | None = None
    for key in regexes:
        if key.startswith("*."):
            hub = key[2:]
            if host == hub or host.endswith("." + hub):
                if best is None or len(key) > best[0]:
                    best = (len(key), key)
    return best[1] if best else None


def normalize(rx: str) -> str:
    rx = rx.strip().strip("`").strip()
    m = re.fullmatch(r"[rR]?'(.+)'|[rR]?\"(.+)\"", rx, re.S)
    if m:
        rx = (m.group(1) or m.group(2)).strip()
    if rx.startswith("^/"):
        rx = rx[1:]
    return rx


def score(rx: str, positives: list[str], negatives: list[str]) -> tuple[int, int]:
    try:
        r = re.compile(rx)
    except re.error:
        return 0, 0
    rec = sum(1 for u in positives if r.search(u))
    nh = sum(1 for u in negatives if r.search(u))
    return rec, nh


def passes(rec: int, nh: int, n_pos: int, n_neg: int) -> bool:
    # ceiling estimate: recall matters most. Structural negatives (tag/listing/
    # gallery paths) should rarely match, but LLM mislabel noise is tolerated.
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
    request = LLMRequest(prompt=prompt, max_tokens=200, temperature=0, model=MODEL)
    async with llm.response_pool() as pool:
        request_id = await pool.put_request(request)
        _request_id, response = await pool.get_response()
    if isinstance(response, Exception):
        return None, str(response)
    return response.content, None


# Known cross-site idioms that a rule can cover without the LLM.
# PolskaPress platform (gazetakrakowska, dzienniklodzki, pomorska, ...): articles
# live under /ar/ or /gh/ with an id like c1p2-27735013.
POLSKAPRESS_REGEX = r"/(?:ar|gh)/(?:c\d+(?:p\d+)?-)?\d+"


def precheck_known_idiom(
    domain: str, positives: list[str], negatives: list[str]
) -> dict | None:
    """Return an ok-result if a known idiom covers the domain, else None."""
    cands = [
        ("polskapress", POLSKAPRESS_REGEX),
    ]
    for name, rx in cands:
        rec = sum(1 for u in positives if re.search(rx, u))
        nh = sum(1 for u in negatives if re.search(rx, u))
        if rec >= 0.8 * len(positives) and passes(rec, nh, len(positives), len(negatives)):
            return {
                "domain": domain, "status": "ok", "regex": rx, "source": name,
                "recall": rec, "neg_hit": nh, "total": len(positives), "attempts": 0,
            }
    return None


async def process_domain(
    llm: OpenAICompatibleMultiPortLLM,
    domain: str,
    positives: list[str],
    negatives: list[str],
) -> dict:
    if not positives:
        return {"domain": domain, "status": "no_positives"}
    if len(positives) < 10:
        return {"domain": domain, "status": "too_few_positives", "n_pos": len(positives)}

    known = precheck_known_idiom(domain, positives, negatives)
    if known is not None:
        return known

    pos_blob = "\n".join(positives[:20])
    neg_blob = "\n".join(negatives[:12]) if negatives else "(none)"

    prompt = BASE_PROMPT.format(domain=domain, pos=pos_blob, neg=neg_blob)
    rx1, err = await ask(llm, prompt)
    if err:
        return {"domain": domain, "status": "error", "error": err}
    rx1 = normalize(rx1)
    rec1, nh1 = score(rx1, positives, negatives)
    if passes(rec1, nh1, len(positives), len(negatives)):
        return {
            "domain": domain, "status": "ok", "regex": rx1,
            "recall": rec1, "neg_hit": nh1, "total": len(positives), "attempts": 1,
        }

    problems = fmt_problems(rx1, positives, negatives, rec1, nh1)
    prompt2 = RETRY_PROMPT.format(
        domain=domain, prev=rx1, problems=problems, pos=pos_blob, neg=neg_blob
    )
    rx2, err2 = await ask(llm, prompt2)
    if err2:
        return {"domain": domain, "status": "error", "error": err2}
    rx2 = normalize(rx2)
    rec2, nh2 = score(rx2, positives, negatives)
    if passes(rec2, nh2, len(positives), len(negatives)):
        return {
            "domain": domain, "status": "ok", "regex": rx2,
            "recall": rec2, "neg_hit": nh2, "total": len(positives), "attempts": 2,
        }
    return {
        "domain": domain, "status": "failed",
        "regex1": rx1, "score1": (rec1, nh1),
        "regex2": rx2, "score2": (rec2, nh2),
        "total": len(positives),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-links", type=int, default=100)
    parser.add_argument("--out", type=Path, default=Path("/tmp/generated_regexes.jsonl"))
    parser.add_argument("--max-domains", type=int, default=0, help="0 = all")
    parser.add_argument("--model", type=str, default=MODEL)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    global MODEL
    MODEL = args.model

    regexes = load_regex_keys(_REGEX_FILE)
    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false")

    counts = {
        d: n
        for d, n in con.execute(
            f"SELECT domain, count(*) FROM read_json_auto('{_PARSED}', "
            "format='newline_delimited', maximum_object_size=100000000, "
            "ignore_errors=true) GROUP BY domain"
        ).fetchall()
    }
    targets = sorted(
        (d for d, n in counts.items() if n >= args.min_links and regex_key_for(d, regexes) is None),
        key=lambda d: -counts[d],
    )
    if args.max_domains:
        targets = targets[: args.max_domains]
    print(f"{len(targets)} target domains (>= {args.min_links} links, no regex)", flush=True)

    pos_rows = con.execute(
        f"SELECT url FROM read_json_auto('{_SCORES}', "
        "format='newline_delimited', maximum_object_size=100000000, ignore_errors=true) "
        "WHERE llm_is_article = true"
    ).fetchall()
    # structural negatives: parsed URLs that clearly aren't articles by path
    # (tag/listing/gallery/contact...) — reliable non-article signal, unlike
    # llm_is_article=false which is noisy on near-article pages.
    dom_list = ", ".join("'" + d.replace("'", "''") + "'" for d in targets)
    neg_rows = con.execute(
        f"SELECT url, domain FROM read_json_auto('{_PARSED}', "
        "format='newline_delimited', maximum_object_size=100000000, ignore_errors=true) "
        f"WHERE domain IN ({dom_list})"
    ).fetchall()
    positives: dict[str, list[str]] = defaultdict(list)
    negatives: dict[str, list[str]] = defaultdict(list)
    for (u,) in pos_rows:
        if is_clean_positive(u):
            positives[host_of(u)].append(u)
    for u, d in neg_rows:
        if isinstance(u, str) and NON_ARTICLE.search("/" + (u.split("/", 1)[1] if "/" in u else "")):
            negatives[d].append(u)
    print(f"loaded positives from scores, negatives from parsed non-articles", flush=True)

    llm = OpenAICompatibleMultiPortLLM(
        OpenAICompatibleConfig(ports=(6000,), per_port_concurrency=1, model=MODEL)
    )

    okn = fail = 0
    with args.out.open("w", encoding="utf-8") as out:
        for i, dom in enumerate(targets, 1):
            result = asyncio.run(
                process_domain(llm, dom, positives.get(dom, []), negatives.get(dom, []))
            )
            out.write(json.dumps(result, ensure_ascii=False) + "\n")
            out.flush()
            if result["status"] == "ok":
                okn += 1
                print(
                    f"[{i}/{len(targets)}] OK   {dom:<28} "
                    f"recall={result['recall']}/{result['total']} "
                    f"neg={result['neg_hit']}  {result['regex'][:50]}",
                    flush=True,
                )
            elif result["status"] == "failed":
                fail += 1
                print(
                    f"[{i}/{len(targets)}] FAIL {dom:<28} "
                    f"s1={result['score1']} s2={result['score2']}",
                    flush=True,
                )
            else:
                print(f"[{i}/{len(targets)}] {result['status'].upper():<4} {dom}", flush=True)
    print(f"\ndone: ok={okn} failed={fail} -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
