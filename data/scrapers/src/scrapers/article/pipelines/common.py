import hashlib
import mimetypes
import re
import unicodedata
from typing import Any

from entities.article import ParsedArticleRecord
from scrapers.stores import DoneUrl

PARSER_VERSION = 2


def normalize_text(text: str) -> str:
    """Lowercase a token with diacritics stripped (``Ząbek`` -> ``zabek``)."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.lower()


# Characters NFKD does not decompose (Polish ``ł``/``Ł``), mapped by hand.
_ASCII_MAP = str.maketrans({"ł": "l", "Ł": "L"})


def ascii_lower(text: str) -> str:
    """ASCII lowercased text: NFKD-strips accents and maps ``ł`` -> ``l``."""
    return normalize_text(text).translate(_ASCII_MAP)


_THINK_RE = re.compile(r"<think>.*?</think>", flags=re.DOTALL)


def strip_think_blocks(text: str) -> str:
    """Remove the ``<think>...</think>`` reasoning block Qwen emits."""
    return _THINK_RE.sub("", text or "")


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def is_html(media_type: str | None) -> bool:
    if not media_type:
        return False
    base_type = media_type.split(";")[0].strip()
    return mimetypes.guess_extension(base_type) in {".html", ".htm"}


def build_parse_status_record(
    done: DoneUrl,
    domain: str,
    selector: str | None,
    parse_status: str,
    *,
    error: str | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "uid": done.uid,
        "url": done.url,
        "domain": domain,
        "storage_path": done.storage_path,
        "selector": selector,
        "parse_status": parse_status,
        "selector_matched": False,
        "title": None,
        "publication_date": None,
        "ld_json": None,
        "article_content": "",
        "article_content_hash": hash_text(""),
        "html_sha256": None,
        "parser_version": PARSER_VERSION,
        "extraction_method": None,
    }
    if error is not None:
        record["error"] = error
    return record


def parse_record_to_entity(record: dict[str, Any]) -> ParsedArticleRecord:
    selector = record.get("selector")
    title = record.get("title")
    publication_date = record.get("publication_date")
    html_sha256 = record.get("html_sha256")
    error = record.get("error")
    return ParsedArticleRecord(
        uid=str(record["uid"]),
        url=str(record["url"]),
        domain=str(record["domain"]),
        storage_path=str(record["storage_path"]),
        selector=selector if selector is None else str(selector),
        parse_status=str(record.get("parse_status") or "error"),
        selector_matched=bool(record.get("selector_matched")),
        title=title if title is None else str(title),
        publication_date=(
            publication_date if publication_date is None else str(publication_date)
        ),
        ld_json=record.get("ld_json"),
        article_content=str(record.get("article_content") or ""),
        article_content_hash=str(record.get("article_content_hash") or hash_text("")),
        html_sha256=html_sha256 if html_sha256 is None else str(html_sha256),
        parser_version=int(record.get("parser_version") or PARSER_VERSION),
        extraction_method=record.get("extraction_method") or None,
        outbound_urls=record.get("outbound_urls") or None,
        error=error if error is None else str(error),
    )


def should_reuse_parse(
    previous: dict[str, Any] | None,
    selector: str | None,
    done: DoneUrl,
) -> bool:
    if not previous:
        return False
    return (
        previous.get("parser_version") == PARSER_VERSION
        and previous.get("selector") == selector
        and previous.get("storage_path") == done.storage_path
    )
