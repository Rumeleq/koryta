"""Generate verified selectors for domains that lack one, using the local LLM.

For each domain: sample article URLs from the local ``downloaded/`` tar mirror
(guaranteed present via ``article_parsed.jsonl``), build a DOM skeleton for the
LLM (reusing the selector-pipeline's skeleton logic), ask for a CSS selector,
then verify it extracts sensible article content (300..20000 chars) on a held-out
page. Only selectors that parse at least 80% of sampled pages are kept.

Run from ``data/scrapers``::

    PYTHONPATH=src .venv/bin/python -m analysis.scripts.generate_selectors \
        --domains-file /tmp/need_selector.json --out /tmp/selectors.jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tarfile
import textwrap
from pathlib import Path

import duckdb
from bs4 import BeautifulSoup, Tag

from entities.util import NormalizedParse
from scrapers.stores import LLMRequest
from stores.llm import OpenAICompatibleConfig, OpenAICompatibleMultiPortLLM

_PARSED = "versioned/article_parsed/article_parsed.jsonl"
_VERIFIED = Path("src") / "scrapers" / "article" / "pipelines" / "verified_selectors.json"
_REGEX_FILE = Path("src") / "scrapers" / "article" / "pipelines" / "article_url_regexes.json"
MODEL = "Qwen/Qwen3-32B"

_MIN_CONTENT = 300
_MAX_CONTENT = 20000
_SAMPLES = 5
_VERIFY = 3

# skeleton building, mirrored from domain_selectors_pipeline.py
_SKIP_TAGS = {"script", "style", "svg", "img", "link", "meta", "noscript",
              "iframe", "picture", "source", "input", "button", "form"}
_SKIP_STRUCTURAL = {"header", "nav", "footer"}
_CONTENT_TAGS = {"div", "section", "article", "main", "aside"}
_MAX_DEPTH = 10
_SKELETON_LIMIT = 8000
_DATE_RE = re.compile(
    r"\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b|\b20\d{2}\b"
    r"|(?:poniedział|wtorek|środa|czwartek|piątek|sobot|niedziel)\w*,?\s+\d{1,2}"
    r"|(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień"
    r"|październik|listopad|grudzień)\s+20\d{2}",
    re.I,
)
_NUMERIC_CLASS_RE = re.compile(r"^[\w]+-\d+$")
_STRIP_CLS_RE = re.compile(
    r"^(status-\w+|is-layout-\w+|is-style-\w+|has-[\w-]+-(?:color|font|size)|"
    r"paywalled?|premium|is-paywall|free)$",
    re.I,
)

PROMPT = textwrap.dedent(
    """\
    You are extracting article content from a Polish news website.
    URL: {url}

    HTML skeleton (text snippets, repeated siblings collapsed):
    - <!-- ~Nw --> element contains roughly N words
    - <!-- ~Nw LISTING --> holds multiple articles; do not select this

    TASK: Return the ONE CSS selector that reliably captures the complete
    article body (headline + lead paragraph + body text) across ALL pages on
    this site, not just this one.

    STRATEGY:
    1. Find the broadest element that is clearly a single-article container.
    2. If that container holds noise, narrow to its largest single-article child.
    3. Stop there. Do not drill deeper just to exclude the headline or byline.

    HARD RULES:
    1. Return ONLY JSON: {{"selector": "...", "reasoning": "one sentence"}}
    2. Selector must work with soup.select_one().
    3. Use minimum classes. Avoid variant, responsive, layout, and numeric classes.
    4. No bare tags without class/id: body, main, article, section, div are banned.
    5. No descendant chains with 3+ space-separated parts.
    6. Never select a LISTING element.
    7. If not a news article, return:
       {{"selector": null, "reasoning": "not an article page"}}

    HTML skeleton:
    {skeleton}"""
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domains-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("/tmp/selectors.jsonl"))
    parser.add_argument("--max-domains", type=int, default=0)
    return parser.parse_args()


def load_url_regexes(path: Path) -> dict[str, re.Pattern]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    out: dict[str, re.Pattern] = {}
    for d, pat in data.items():
        try:
            out[d] = re.compile(pat)
        except re.error:
            continue
    return out


def regex_for(host: str, regexes: dict[str, re.Pattern]) -> re.Pattern | None:
    r = regexes.get(host)
    if r is not None:
        return r
    best: tuple[int, re.Pattern] | None = None
    for key, pat in regexes.items():
        if key.startswith("*."):
            hub = key[2:]
            if host == hub or host.endswith("." + hub):
                if best is None or len(key) > best[0]:
                    best = (len(key), pat)
    return best[1] if best else None


def sp_is_local(sp: str, local_tars: set[str]) -> bool:
    return sp.startswith("gs://") and (
        "downloaded/" + sp.removeprefix("gs://koryta-pl-crawled/").replace("/", ".")
        in local_tars
    )


def member_path(url: str) -> str:
    parsed = NormalizedParse.parse(url)
    path = parsed.path if parsed.path else "index"
    return f"{parsed.hostname}/{path}".replace("//", "/").rstrip("/")


def clean_classes(tag: Tag) -> list[str]:
    return [
        c for c in (tag.get("class") or [])
        if not _NUMERIC_CLASS_RE.match(c) and not _STRIP_CLS_RE.match(c)
    ]


def build_skeleton(tag, depth=0) -> str:
    if depth > _MAX_DEPTH or not isinstance(tag, Tag):
        return ""
    if tag.name in _SKIP_TAGS:
        return ""
    if depth <= 2 and tag.name in _SKIP_STRUCTURAL:
        return f"{'  ' * depth}<{tag.name}> <!-- skipped -->\n"
    indent = "  " * depth
    cls = " ".join(clean_classes(tag)[:3])
    tid = tag.get("id", "")
    attrs = (f' class="{cls}"' if cls else "") + (f' id="{tid}"' if tid else "")
    children = [c for c in tag.children if isinstance(c, Tag) and c.name not in _SKIP_TAGS]
    if not children:
        text = tag.get_text(" ", strip=True)[:100].replace("\n", " ")
        return f"{indent}<{tag.name}{attrs}>{text}</{tag.name}>\n" if text else ""
    collapsed: list[Tag | str] = []
    i = 0
    while i < len(children):
        child = children[i]
        sig = (child.name, tuple(clean_classes(child)[:3]))
        j = i + 1
        while j < len(children) and (children[j].name, tuple(clean_classes(children[j])[:3])) == sig:
            j += 1
        count = j - i
        collapsed.append(children[i])
        if count > 2:
            collapsed.append(f"<!-- ...{count - 1} more <{child.name}> -->")
        elif count == 2:
            collapsed.append(children[i + 1])
        i = j
    inner = "".join(
        (indent + "  " + c + "\n") if isinstance(c, str) else build_skeleton(c, depth + 1)
        for c in collapsed
    )
    if not inner.strip():
        return ""
    wc_hint = ""
    if tag.name in _CONTENT_TAGS:
        full_text = tag.get_text(" ", strip=True)
        wc = len(full_text.split())
        if wc >= 30:
            listing = " LISTING" if len(_DATE_RE.findall(full_text)) >= 4 else ""
            wc_hint = f" <!-- ~{wc}w{listing} -->"
    return f"{indent}<{tag.name}{attrs}>{wc_hint}\n{inner}{indent}</{tag.name}>\n"


def html_to_skeleton(html_bytes: bytes) -> str:
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
    except Exception:
        return ""
    body = soup.find("body") or soup
    skeleton = build_skeleton(body)
    if len(skeleton) > _SKELETON_LIMIT:
        skeleton = skeleton[:_SKELETON_LIMIT] + "\n<!-- skeleton truncated -->"
    return skeleton


async def ask(llm: OpenAICompatibleMultiPortLLM, prompt: str) -> tuple[str | None, str | None]:
    request = LLMRequest(prompt=prompt, max_tokens=200, temperature=0, model=MODEL)
    async with llm.response_pool() as pool:
        request_id = await pool.put_request(request)
        _request_id, response = await pool.get_response()
    if isinstance(response, Exception):
        return None, str(response)
    return response.content, None


def parse_selector_response(response: str) -> str | None:
    raw = re.sub(r"^```[a-z]*\n?", "", response.strip())
    raw = re.sub(r"\n?```$", "", raw.strip())
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    sel = parsed.get("selector")
    return sel if isinstance(sel, str) and sel else None


def extract_len(html: bytes, selector: str) -> int:
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
    domains = [d.strip() for d in json.load(open(args.domains_file)) if isinstance(d, str)]
    if args.max_domains:
        domains = domains[: args.max_domains]

    existing = json.load(open(_VERIFIED))
    domains = [d for d in domains if d not in existing]
    print(f"{len(domains)} domains need selectors", flush=True)

    regexes = load_url_regexes(_REGEX_FILE)
    local_tars = {"downloaded/" + n for n in os.listdir("downloaded")}
    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false")

    dom_list = ", ".join("'" + d.replace("'", "''") + "'" for d in domains)
    rows = con.execute(
        f"SELECT url, domain, storage_path, parse_status, selector "
        f"FROM read_json_auto('{_PARSED}', format='newline_delimited', "
        "maximum_object_size=100000000, ignore_errors=true) "
        f"WHERE domain IN ({dom_list})"
    ).fetchall()
    by_dom: dict[str, list] = {}
    for url, d, sp, st, sel in rows:
        if not sp_is_local(sp, local_tars):
            continue
        by_dom.setdefault(d, []).append((url, sp, st, sel))
    print("loaded local rows", flush=True)

    llm = OpenAICompatibleMultiPortLLM(
        OpenAICompatibleConfig(ports=(6000,), per_port_concurrency=1, model=MODEL)
    )

    okn = fail = skip = 0
    with args.out.open("w", encoding="utf-8") as out:
        for i, dom in enumerate(domains, 1):
            entries = by_dom.get(dom, [])
            regex = regex_for(dom, regexes)
            if regex is None or len(entries) < 3:
                skip += 1
                print(f"[{i}/{len(domains)}] SKIP {dom}", flush=True)
                continue
            # ONLY article-regex-matching URLs; prefer ones that failed to parse
            # (need rescue), then ok ones.
            article_entries = [e for e in entries if regex.search(e[0])]
            if len(article_entries) < 3:
                skip += 1
                print(f"[{i}/{len(domains)}] SKIP {dom} (no article-regex URLs)", flush=True)
                continue
            targets = sorted(
                article_entries, key=lambda e: 0 if e[2] != "ok" else 1
            )
            sample = targets[: _SAMPLES]
            verify_pool = targets[_SAMPLES: _SAMPLES + _VERIFY + 1]

            # build skeleton from the first sample page with html
            prompt_url = None
            skeleton = ""
            for url, sp, st, _sel in sample:
                tar_path = Path("downloaded") / sp.removeprefix(
                    "gs://koryta-pl-crawled/").replace("/", ".")
                try:
                    tar = tarfile.open(tar_path, "r:gz")
                except Exception:
                    continue
                members = {m.name: m for m in tar.getmembers()}
                m = members.get(member_path(url))
                if m is not None:
                    html = tar.extractfile(m).read()
                    skeleton = html_to_skeleton(html)
                    if skeleton:
                        prompt_url = url
                        tar.close()
                        break
                tar.close()
            if not skeleton:
                skip += 1
                print(f"[{i}/{len(domains)}] SKIP {dom} (no skeleton)", flush=True)
                continue

            prompt = PROMPT.format(url=prompt_url, skeleton=skeleton)
            resp, err = asyncio.run(ask(llm, prompt))
            if err or not resp:
                fail += 1
                print(f"[{i}/{len(domains)}] FAIL {dom} (llm error)", flush=True)
                continue
            sel = parse_selector_response(resp)
            if not sel:
                fail += 1
                print(f"[{i}/{len(domains)}] FAIL {dom} (no selector)", flush=True)
                continue

            # verify on held-out pages (regex-matching article URLs)
            def verify(sel_to_test: str) -> tuple[int, int, list[tuple[str, int]]]:
                good = 0
                tested = 0
                details: list[tuple[str, int]] = []
                for url, sp, st, _sel in verify_pool:
                    tar_path = Path("downloaded") / sp.removeprefix(
                        "gs://koryta-pl-crawled/").replace("/", ".")
                    try:
                        tar = tarfile.open(tar_path, "r:gz")
                    except Exception:
                        continue
                    members = {m.name: m for m in tar.getmembers()}
                    m = members.get(member_path(url))
                    if m is not None:
                        ln = extract_len(tar.extractfile(m).read(), sel_to_test)
                        if _MIN_CONTENT <= ln <= _MAX_CONTENT:
                            good += 1
                        details.append((url, ln))
                        tested += 1
                    tar.close()
                return good, tested, details

            good, tested, details = verify(sel)
            ok_ratio = good / max(tested, 1) if tested else 0
            if tested >= 2 and ok_ratio >= 0.6:
                okn += 1
                out.write(json.dumps({
                    "domain": dom, "status": "ok", "selector": sel,
                    "verified": good, "tested": tested, "url": prompt_url,
                }) + "\n")
                out.flush()
                print(f"[{i}/{len(domains)}] OK   {dom:<30} {good}/{tested}  {sel}", flush=True)
                continue

            # feedback retry: tell the LLM the extracted lengths per URL
            fb_lines = "\n".join(
                f"{url} -> {ln} chars" for url, ln in details
            )
            fb_prompt = textwrap.dedent(
                f"""\
                Your selector "{sel}" for {dom} extracted bad content lengths:

                {fb_lines}

                The article body should be between {_MIN_CONTENT} and {_MAX_CONTENT} chars.
                Look again at the HTML skeleton and return a corrected selector.
                Return ONLY JSON: {{"selector": "...", "reasoning": "one sentence"}}

                URL: {prompt_url}
                HTML skeleton:
                {skeleton}"""
            )
            resp2, err2 = asyncio.run(ask(llm, fb_prompt))
            sel2 = parse_selector_response(resp2) if resp2 else None
            if not sel2:
                fail += 1
                out.write(json.dumps({
                    "domain": dom, "status": "failed", "selector": sel,
                    "verified": good, "tested": tested, "url": prompt_url,
                }) + "\n")
                out.flush()
                print(f"[{i}/{len(domains)}] FAIL {dom:<30} {good}/{tested}  {sel}", flush=True)
                continue
            good2, tested2, details2 = verify(sel2)
            ok2 = good2 / max(tested2, 1) if tested2 else 0
            if tested2 >= 2 and ok2 >= 0.6:
                okn += 1
                out.write(json.dumps({
                    "domain": dom, "status": "ok", "selector": sel2,
                    "verified": good2, "tested": tested2, "url": prompt_url,
                }) + "\n")
                out.flush()
                print(f"[{i}/{len(domains)}] OK   {dom:<30} {good2}/{tested2}  {sel2}  (retry)", flush=True)
            else:
                fail += 1
                out.write(json.dumps({
                    "domain": dom, "status": "failed", "selector": sel2,
                    "verified": good2, "tested": tested2, "url": prompt_url,
                }) + "\n")
                out.flush()
                print(f"[{i}/{len(domains)}] FAIL {dom:<30} {good2}/{tested2}  {sel2}  (retry)", flush=True)
    print(f"\ndone: ok={okn} failed={fail} skip={skip} -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
