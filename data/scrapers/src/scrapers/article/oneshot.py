"""One article, parsed and analysed on its own, without the pipeline around it.

The batch pipelines are built for millions of pages: each streams a jsonl file,
caches on a content hash, and writes another jsonl for the next one to stream.
A page someone just captured in their browser needs the same parsing and the
same prompts applied to exactly one document, with the answer returned rather
than written to `versioned/`.

Rather than restate any of that, this module drives the pipeline modules' own
prompts and response parsers. Reaching for their private names is deliberate,
and it is the whole point of the module: a second copy of
``facts_pipeline._PROMPT`` would drift from the one the nightly run uses, and
the two would then quietly disagree about what counts as a fact. Keeping the
reach-through in one file makes that seam greppable, and
``test_oneshot.py`` pins the prompt versions so a change on either side fails a
test instead of going unnoticed.

The one place the two runs are meant to disagree is quoting, and it is
substituted rather than copied — `facts_pipeline.build_prompt` takes the two
blocks about justifications, everything else stays the shared text. A batch
fact is only ever read as a row in `/ekstrakcje`, far from its article, so its
verbatim span is the whole of the evidence and a fact without one is worth
nothing. A captured fact is drawn in a panel beside the article the reader
already has open, where the span is a convenience; requiring it there costs
real pairings — a name in the lead and the office six paragraphs down cannot be
covered by one contiguous fragment. So a capture returns those facts with an
empty justification, and `verify_facts` judges them against the article text
instead of against a span that is not there.

Nothing here touches the network, GCS or Firestore — it takes html bytes and an
:class:`~scrapers.stores.LLM`, and returns data. That keeps it inside the
``scrapers`` layer the import contract allows, and makes it testable with a
fake LLM.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from entities.facts import fact_to_dict
from scrapers.article.parse import (
    date_iso_from_ld_json,
    extract_article_content,
    title_from_ld_json,
)
from scrapers.article.pipelines import facts_pipeline
from scrapers.article.pipelines import koryciarski_scores_pipeline as scores_pipeline
from scrapers.article.pipelines import verified_facts_pipeline as verify_pipeline
from scrapers.article.pipelines.common import PARSER_VERSION, hash_text
from scrapers.article.selectors import load_selector_map
from scrapers.stores import LLM, LLMRequest, LLMResponse

_SELECTOR_FILE = Path(__file__).parent / "pipelines" / "verified_selectors.json"

# Tried in order when the domain has no verified selector of its own.
#
# `ArticleDomainSelectors` learns a selector per domain from a corpus of crawled
# pages, which a domain first seen through the browser has none of. These cover
# the common CMS templates well enough to get an article's text out on the first
# capture; the nightly pipeline replaces the guess with a learned selector once
# the domain has enough pages to derive one from.
_FALLBACK_SELECTORS: tuple[str, ...] = (
    "[itemprop='articleBody']",
    "article .entry-content",
    "article .post-content",
    "article",
    "main article",
    ".article-body",
    ".article__body",
    ".articleBody",
    ".entry-content",
    ".post-content",
    "#article-body",
    "main",
    ".content",
    "body",
)

# A fallback selector has to yield at least this much text to be believed. Short
# of it we are looking at a nav bar or a teaser, and the next candidate is worth
# trying.
_MIN_FALLBACK_CHARS = 400

# Revisions of the capture prompt below, counted on their own rather than
# continuing `facts_pipeline.PROMPT_VERSION`: the two prompts change for
# different reasons and neither number would mean anything applied to the other.
# Which of the two produced a fact is what `EXTRACTION_TAG` records.
CAPTURE_PROMPT_VERSION = 1

# Replaces the batch prompt's grounding block, which is what tells the model to
# drop a fact it cannot cover with one contiguous quote. Here the quote is
# demoted to a preference; what may not be relaxed — the person named in the
# article, every field said by the article, nothing from world knowledge — is
# restated so the relaxation cannot be read as a general one.
_CAPTURE_GROUNDING_RULES = (
    "GRUNTOWANIE (najważniejsza zasada): fakt musi wynikać z treści artykułu, "
    "a nie z Twojej wiedzy ogólnej. Cytat justification jest pomocą, a nie "
    "warunkiem: jeśli nie ma jednego ciągłego fragmentu, który jednocześnie "
    "nazywa osobę i potwierdza fakt, ZWRÓĆ TEN FAKT MIMO TO i zostaw "
    "justification puste.\n"
    "- Osoba musi być gdzieś w artykule nazwana pełnym imieniem i nazwiskiem "
    "(albo imieniem i inicjałem nazwiska). Wolno połączyć zdanie, które ją "
    "nazywa, ze zdaniem, które opisuje fakt, nawet jeśli dzieli je kilka "
    "akapitów — ale tylko wtedy, gdy z artykułu jednoznacznie wynika, że chodzi "
    "o tę samą osobę. Jeśli to domysł, pomiń fakt.\n"
    "- Każde pole, które podajesz (organization, role, party, object, "
    "relation), musi być powiedziane w artykule. Pola, którego artykuł nie "
    "podaje, nie dopisuj.\n"
    "- Jeśli potrafisz skopiować dosłowny, ciągły cytat (w razie potrzeby "
    "z [...]), zrób to — cytat jest lepszy niż jego brak. Pusty justification "
    "jest dopuszczalny; wymyślony albo sparafrazowany nigdy.\n"
)

# Replaces the sentence that names the quote as the only thing organization and
# role may be read out of. Same rule, read out of the article instead.
_CAPTURE_QUOTE_DERIVATION_RULES = (
    "organization i role muszą wynikać z artykułu (nazwane wprost lub "
    "jednoznacznie wskazane przez stanowisko) — zapisz je tylko w formie "
    "standardowej, nie zgaduj z wiedzy ogólnej: nie dodawaj kraju ani nazwy, "
    "której artykuł nie wskazuje ('Sąd Najwyższy' to nie 'Sąd Najwyższy "
    "Ukrainy'; 'poseł' to nie 'Izba Poselska').\n"
)

# The batch prompt's worked examples all carry a quote, so on their own they
# still read as "a fact has a justification". This one is the case the whole
# change is for: the pairing is certain, the span is not available.
_CAPTURE_EXAMPLE = (
    "Artykuł: Halina Mazur od trzech lat walczy o remont ulicy Polnej.\n"
    "[kilkanaście akapitów o kosztach remontu i sporze z wykonawcą]\n"
    "Nasza rozmówczyni zasiada w Radzie Miasta Chełm od 2019 roku.\n"
    "<think>\n"
    "- Halina Mazur — radna Rady Miasta Chełm (employment); nazwisko na "
    "początku, funkcja kilkanaście akapitów dalej, pod 'nasza rozmówczyni'\n"
    "- to jedyna nazwana osoba i cały artykuł jest o niej → ta sama osoba, "
    "nie domysł\n"
    "- cytat musiałby przeskoczyć kilkanaście akapitów, więc nie da się go "
    "skopiować dosłownie → zwracam fakt z pustym justification\n"
    "</think>\n"
    "facts:\n"
    "- justification= | employment | person=Halina Mazur | organization=Rada "
    "Miasta Chełm | role=radna\n\n"
)

_CAPTURE_PROMPT = facts_pipeline.build_prompt(
    grounding=_CAPTURE_GROUNDING_RULES,
    quote_derivation=_CAPTURE_QUOTE_DERIVATION_RULES,
    extra_examples=_CAPTURE_EXAMPLE,
)

# The judge's rulebook is written around the span: §2 makes a fact whose span
# does not name the subject `insufficient`, which is every quote-less fact by
# construction. Rather than fork the rulebook — the other twenty rules are the
# labeling policy and must not diverge — the article is substituted for the
# span, and only the two rules that are about the span's size are lifted.
_CAPTURE_JUDGE_PROMPT = (
    "You label an extracted fact using this rulebook. The extractor found no "
    "verbatim span for this one, so the ARTICLE below takes the span's place: "
    'wherever the rulebook says "the justification span", read "the article". '
    "Everything else holds unchanged — never use world knowledge or anything "
    "outside the article, and a field the article neither states nor entails is "
    "still incorrect. Exactly two rules relax: the subject's name may be "
    "anywhere in the article rather than beside the claim, and a fact is not "
    "insufficient merely for having no span. Reply with a single compact JSON "
    "object and nothing else: "
    '{{"label": "correct|incorrect|insufficient", "reason": "..."}}.\n\n'
    "RULEBOOK:\n{rules}\n\n"
    "ARTICLE:\n{article}\n\n"
    "FACT (JSON):\n{fact}"
)


@dataclass(frozen=True)
class ParsedPage:
    """What `ArticleParsed` would have recorded for this page."""

    url: str
    domain: str
    title: str | None
    publication_date: str | None
    article_content: str
    article_content_hash: str
    selector: str | None
    selector_matched: bool
    extraction_method: str | None
    parse_status: str
    parser_version: int = PARSER_VERSION
    ld_json: Any = None


@dataclass(frozen=True)
class ArticleScore:
    """What `ArticleKoryciarskiScores` would have recorded."""

    score: int | None
    reason: str
    is_article: bool
    model: str
    prompt_version: int = scores_pipeline.PROMPT_VERSION
    error: str | None = None


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    requests: int = 0

    def add(self, response: LLMResponse) -> None:
        self.prompt_tokens += response.prompt_tokens
        self.completion_tokens += response.completion_tokens
        self.total_tokens += response.total_tokens
        self.requests += 1


@dataclass
class AnalyzedArticle:
    """The whole answer for one page, shaped like an `ArticleAnalyzedRecord`."""

    parsed: ParsedPage
    score: ArticleScore | None
    facts: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    facts_prompt_version: int = CAPTURE_PROMPT_VERSION
    verify_version: int = verify_pipeline.VERIFY_VERSION
    usage: Usage = field(default_factory=Usage)
    error: str | None = None


def load_selectors(path: str | Path | None = None) -> dict[str, str]:
    """The per-domain selectors the pipeline verified, as a plain mapping."""
    return load_selector_map(path or _SELECTOR_FILE)


def _normalize_domain(domain: str) -> str:
    value = domain.strip().lower()
    return value[4:] if value.startswith("www.") else value


def _extract_with(html: bytes, selector: str, url: str) -> dict[str, Any] | None:
    try:
        return extract_article_content(html, selector, url)
    except Exception:
        # A malformed selector is a fallback candidate's problem, not the
        # caller's: move on to the next one.
        return None


def parse_page(
    html: bytes,
    url: str,
    domain: str,
    selectors: Mapping[str, str] | None = None,
    content_override: str | None = None,
) -> ParsedPage:
    """Article text, title and date out of a captured page.

    `content_override` is text the capturing browser already had — a reader's
    selection, say. It wins over anything a selector finds, because the person
    who sent it was looking at the page and the selector is a guess.
    """
    selectors = selectors if selectors is not None else load_selectors()
    normalized = _normalize_domain(domain)
    verified = selectors.get(normalized)

    result: dict[str, Any] | None = None
    used_selector: str | None = None
    method: str | None = None

    if verified:
        result = _extract_with(html, verified, url)
        if result and result.get("selector_matched"):
            used_selector, method = verified, "selector"

    if used_selector is None:
        best: tuple[int, str, dict[str, Any]] | None = None
        for candidate in _FALLBACK_SELECTORS:
            attempt = _extract_with(html, candidate, url)
            if not attempt or not attempt.get("selector_matched"):
                continue
            length = len(str(attempt.get("article_content") or "").strip())
            if length >= _MIN_FALLBACK_CHARS:
                best = (length, candidate, attempt)
                break
            if best is None or length > best[0]:
                best = (length, candidate, attempt)
        if best is not None:
            _, used_selector, result = best
            method = f"fallback:{used_selector}"

    if result is None:
        # Nothing matched at all, but ld+json metadata may still be readable.
        result = _extract_with(html, "html", url) or {}

    content = str(result.get("article_content") or "").strip()
    if content_override and content_override.strip():
        content = content_override.strip()
        method = "override"

    title = result.get("title") or title_from_ld_json(result.get("ld_json"))
    publication_date = result.get("publication_date")
    date_iso = (
        publication_date.isoformat()
        if publication_date is not None and hasattr(publication_date, "isoformat")
        else date_iso_from_ld_json(result.get("ld_json"))
    )

    return ParsedPage(
        url=url,
        domain=normalized,
        title=title,
        publication_date=date_iso,
        article_content=content,
        article_content_hash=hash_text(content),
        selector=used_selector,
        selector_matched=bool(result.get("selector_matched")),
        extraction_method=method,
        parse_status="ok" if content else "empty_text",
    )


async def _complete(
    llm: LLM,
    requests: Iterable[LLMRequest],
) -> list[LLMResponse | Exception]:
    """Run requests through the LLM's pool, answers in the order asked.

    The pool hands responses back by id as they finish, which is what makes it
    worth using for the per-fact verification pass — a dozen judgements go out
    at once instead of one after another.
    """
    ordered = list(requests)
    if not ordered:
        return []

    results: dict[int, LLMResponse | Exception] = {}
    async with llm.response_pool() as pool:
        pending: dict[int, int] = {}
        for index, request in enumerate(ordered):
            while pool.is_full():
                request_id, response = await pool.get_response()
                results[pending.pop(request_id)] = response
            request_id = await pool.put_request(request)
            pending[request_id] = index
        while pending:
            request_id, response = await pool.get_response()
            results[pending.pop(request_id)] = response

    return [results[index] for index in range(len(ordered))]


def _text_limit() -> int:
    """How much of the article the extractor is shown — and the judge with it.

    The judge has to see exactly the text the extractor read: judging a fact
    against a shorter view would reject it for a sentence the extractor was
    entitled to use.
    """
    return facts_pipeline.article_facts_text_limit() or facts_pipeline.TEXT_LIMIT


async def score_page(llm: LLM, text: str, model: str) -> ArticleScore:
    """The 0-5 koryciarski score, from the scoring pipeline's own prompt."""
    request = LLMRequest(
        prompt=scores_pipeline._PROMPT.format(text=text[: scores_pipeline.TEXT_LIMIT]),
        max_tokens=scores_pipeline.MAX_TOKENS,
        temperature=scores_pipeline.TEMPERATURE,
        model=model,
    )
    (response,) = await _complete(llm, [request])
    if isinstance(response, Exception):
        return ArticleScore(None, str(response), False, model, error=str(response))

    parsed = scores_pipeline._extract_json_object(response.content)
    if not parsed:
        return ArticleScore(
            None, "invalid json parse", False, model, error="invalid json parse"
        )
    is_article, score, reason = scores_pipeline._normalize_scoring_result(parsed)
    return ArticleScore(score, reason, is_article, model)


async def extract_facts(
    llm: LLM,
    url: str,
    text: str,
    model: str,
    usage: Usage | None = None,
) -> list[dict[str, Any]]:
    """Facts grounded in the article text, via the capture prompt.

    The response goes through the pipeline's own `_normalize_markdown_response`,
    which is where the `justification_in_text` span is resolved back to a
    verbatim slice of the article — the thing a reviewer can search the page
    for. Under the capture prompt a fact may arrive without one; that is
    deliberate, and `verify_facts` is what then judges it against the article.
    """
    max_tokens = facts_pipeline.article_facts_max_tokens() or facts_pipeline.MAX_TOKENS
    request = LLMRequest(
        prompt=_CAPTURE_PROMPT.format(text=text[: _text_limit()]),
        max_tokens=max_tokens,
        temperature=facts_pipeline.TEMPERATURE,
        model=model,
        enable_thinking=True,
    )
    (response,) = await _complete(llm, [request])
    if isinstance(response, Exception):
        raise response
    if usage is not None:
        usage.add(response)

    extracted = facts_pipeline._normalize_markdown_response(url, response.content, text)
    return [fact_to_dict(fact) for fact in extracted]


def _judge_request(
    fact: dict[str, Any],
    model: str,
    article_text: str,
) -> LLMRequest:
    """The pipeline's own judge request, unless the fact has no span to judge.

    A quote-less fact handed to the pipeline's request is `insufficient` before
    the model reads it, since the rulebook's first question is whether the span
    names the subject and the span is empty. Those are the ones the article
    stands in for.
    """
    span = str(fact.get("justification_in_text") or "").strip()
    if span or not article_text:
        return verify_pipeline._judge_request(fact, model)

    view = verify_pipeline._fact_view(fact)
    view.pop("justification", None)
    return LLMRequest(
        prompt=_CAPTURE_JUDGE_PROMPT.format(
            rules=verify_pipeline._RULES,
            article=article_text,
            fact=json.dumps(view, ensure_ascii=False),
        ),
        max_tokens=verify_pipeline.MAX_TOKENS,
        temperature=verify_pipeline.TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


async def verify_facts(
    llm: LLM,
    candidates: list[dict[str, Any]],
    model: str,
    usage: Usage | None = None,
    article_text: str = "",
) -> list[dict[str, Any]]:
    """Each fact judged against the rulebook, annotated in place.

    Returns every candidate with the verifier's verdict attached rather than
    dropping the rejected ones — same contract as `ArticleFactsVerified`, so the
    caller decides what to submit and a reviewer can still be shown a near miss.

    `article_text` is what a fact with no verbatim span is judged against.
    Without it those facts are judged as the batch run judges them, which is to
    say rejected for the missing span.
    """
    if not candidates:
        return []

    responses = await _complete(
        llm,
        [_judge_request(fact, model, article_text) for fact in candidates],
    )

    annotated: list[dict[str, Any]] = []
    for fact, response in zip(candidates, responses):
        if isinstance(response, Exception):
            # A judge that failed to answer must not silently promote a fact:
            # unknown is not `correct`, so it is not submitted.
            annotated.append(verify_pipeline._annotate(fact, "unknown", str(response)))
            continue
        if usage is not None:
            usage.add(response)
        verdict, reason = verify_pipeline._parse_verdict(response.content)
        annotated.append(verify_pipeline._annotate(fact, verdict, reason))
    return annotated


async def analyze(
    llm: LLM,
    *,
    url: str,
    domain: str,
    html: bytes,
    model: str,
    selectors: Mapping[str, str] | None = None,
    content_override: str | None = None,
    verify: bool = True,
) -> AnalyzedArticle:
    """Parse, score, extract and verify one captured page.

    Scoring runs alongside fact extraction rather than gating it. In the batch
    pipeline the score is a filter — it is what keeps a million crawled listing
    pages from each costing a fact-extraction call. Here a person chose this
    page deliberately, so the score is recorded as context and the facts are
    extracted regardless.
    """
    usage = Usage()
    parsed = parse_page(html, url, domain, selectors, content_override)
    if not parsed.article_content:
        return AnalyzedArticle(
            parsed=parsed,
            score=None,
            model=model,
            usage=usage,
            error="no article text found in the captured page",
        )

    score_task = asyncio.create_task(score_page(llm, parsed.article_content, model))
    facts_task = asyncio.create_task(
        extract_facts(llm, url, parsed.article_content, model, usage)
    )
    score, extracted = await asyncio.gather(
        score_task, facts_task, return_exceptions=True
    )

    if isinstance(extracted, BaseException):
        return AnalyzedArticle(
            parsed=parsed,
            score=score if isinstance(score, ArticleScore) else None,
            model=model,
            usage=usage,
            error=f"fact extraction failed: {extracted}",
        )

    verified = (
        await verify_facts(
            llm,
            extracted,
            model,
            usage,
            article_text=parsed.article_content[: _text_limit()],
        )
        if verify
        else extracted
    )

    return AnalyzedArticle(
        parsed=parsed,
        score=score if isinstance(score, ArticleScore) else None,
        facts=verified,
        model=model,
        usage=usage,
    )


# Verifier bookkeeping, kept out of what is submitted — exactly the set
# `ArticleAnalyzed` strips.
_VERIFICATION_FIELDS = {"verified", "verification_verdict", "verification_reason"}


def submission_payload(
    analyzed: AnalyzedArticle,
    tag: str,
    only_verified: bool = True,
) -> dict[str, Any]:
    """The analysed article in the shape `/api/ingest/extraction` accepts.

    Matches what `uploader.py --type extraction` posts, field for field, so the
    fast path and the nightly upload put the same thing in the same collection.
    """
    submitted: list[dict[str, Any]] = []
    for fact in analyzed.facts:
        if only_verified and fact.get("verified") is not True:
            continue
        clean = {
            key: value for key, value in fact.items() if key not in _VERIFICATION_FIELDS
        }
        clean["date"] = analyzed.parsed.publication_date
        submitted.append(clean)

    return {
        "url": analyzed.parsed.url,
        "domain": analyzed.parsed.domain,
        "title": analyzed.parsed.title,
        "publication_date": analyzed.parsed.publication_date,
        "extracted_facts": submitted,
        "tag": tag,
    }


def to_json(analyzed: AnalyzedArticle) -> str:
    """Debug rendering; the service logs this when asked to be verbose."""
    return json.dumps(
        {
            "url": analyzed.parsed.url,
            "selector": analyzed.parsed.selector,
            "extraction_method": analyzed.parsed.extraction_method,
            "chars": len(analyzed.parsed.article_content),
            "score": analyzed.score.score if analyzed.score else None,
            "facts": len(analyzed.facts),
            "error": analyzed.error,
        },
        ensure_ascii=False,
    )
