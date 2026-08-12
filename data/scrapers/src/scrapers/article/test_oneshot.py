from __future__ import annotations

import asyncio
import json
from typing import Any

from scrapers.article import oneshot
from scrapers.article.pipelines import facts_pipeline
from scrapers.article.pipelines import koryciarski_scores_pipeline as scores_pipeline
from scrapers.article.pipelines import verified_facts_pipeline as verify_pipeline
from scrapers.stores import LLM, LLMRequest, LLMResponse, LLMResponsePool

ARTICLE_HTML = b"""
<html>
  <head>
    <script type="application/ld+json">
      {"@type":"NewsArticle","headline":"Prezes ze spolki wodociagowej",
       "datePublished":"2026-07-14"}
    </script>
  </head>
  <body>
    <nav>Menu</nav>
    <article class="post">
      <p>Jan Kowalski jest radnym miasta od 2010 roku.</p>
      <p>W 2018 roku zostal powolany na stanowisko prezesa Miejskiego
         Przedsiebiorstwa Wodociagow, o czym pisalismy juz wczesniej w naszym
         serwisie przy okazji opisywania kolejnych zmian kadrowych w spolkach
         zaleznych od ratusza.</p>
    </article>
    <footer>Stopka</footer>
  </body>
</html>
"""


class FakeResponsePool(LLMResponsePool):
    """Answers each request from a scripted list, in the order asked."""

    def __init__(self, llm: "FakeLLM") -> None:
        self._llm = llm
        self._responses: dict[int, LLMResponse | Exception] = {}
        self._next_id = 0

    async def __aenter__(self) -> "FakeResponsePool":
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        return None

    def is_full(self) -> bool:
        return False

    async def put_request(self, request: LLMRequest) -> int:
        request_id = self._next_id
        self._next_id += 1
        self._llm.prompts.append(request.prompt)
        self._responses[request_id] = self._llm.answer(request.prompt)
        return request_id

    async def get_response(self) -> tuple[int, LLMResponse | Exception]:
        request_id = next(iter(self._responses))
        return request_id, self._responses.pop(request_id)


class FakeLLM(LLM):
    """Replies by looking at which pipeline's prompt it was handed."""

    def __init__(
        self,
        facts_reply: str = "",
        score_reply: str = "",
        verdicts: list[str] | None = None,
    ) -> None:
        self.facts_reply = facts_reply
        self.score_reply = score_reply
        self.verdicts = verdicts or []
        self.prompts: list[str] = []
        self._verdict_index = 0

    def response_pool(self) -> LLMResponsePool:
        return FakeResponsePool(self)

    async def check_health(self) -> None:
        return None

    def answer(self, prompt: str) -> LLMResponse:
        if prompt.startswith("You label an extracted fact"):
            reply = (
                self.verdicts[self._verdict_index]
                if self._verdict_index < len(self.verdicts)
                else '{"label": "correct", "reason": "ok"}'
            )
            self._verdict_index += 1
        elif "koryciarstwa" in prompt[:200]:
            reply = self.score_reply
        else:
            reply = self.facts_reply
        return LLMResponse(content=reply, prompt_tokens=10, completion_tokens=5)


def test_prompt_versions_are_the_pipelines_own():
    """The whole point of oneshot is that there is one copy of each prompt.

    If this drifts, the fast path and the nightly run are asking the model
    different questions while stamping their answers with the same tag. The
    facts prompt is the exception, and it counts its own revisions — see
    `test_the_capture_prompt_only_differs_about_quoting` for what may differ.
    """
    analyzed = oneshot.AnalyzedArticle(
        parsed=oneshot.parse_page(ARTICLE_HTML, "https://x.pl/a", "x.pl", {}),
        score=None,
    )
    assert analyzed.facts_prompt_version == oneshot.CAPTURE_PROMPT_VERSION
    assert analyzed.verify_version == verify_pipeline.VERIFY_VERSION
    assert (
        oneshot.ArticleScore(None, "", False, "").prompt_version
        == scores_pipeline.PROMPT_VERSION
    )


def test_the_capture_prompt_only_differs_about_quoting():
    """Everything but the two justification blocks is the batch prompt's text.

    A rule about what counts as a fact, or about how organization and role are
    written, must reach both runs. Only the blocks that make a fact stand or
    fall on a verbatim span are allowed to be capture-specific.
    """
    capture = oneshot._CAPTURE_PROMPT

    for shared in (
        facts_pipeline._EXTRACTION_RULES,
        facts_pipeline._STANDARDIZATION_RULES,
        facts_pipeline._FORMAT_AND_EXAMPLES,
    ):
        assert shared in capture

    assert facts_pipeline._GROUNDING_RULES not in capture
    assert facts_pipeline._QUOTE_DERIVATION_RULES not in capture
    assert oneshot._CAPTURE_GROUNDING_RULES in capture
    # The article still has exactly one place to go.
    assert capture.count("{text}") == 1


def test_the_batch_prompt_is_what_it_always_was():
    """`build_prompt()` with no arguments is the nightly run's prompt.

    The blocks exist so a capture can substitute two of them; splitting the
    string must not have changed what the batch pipeline asks, which is what
    PROMPT_VERSION staying at its value claims.
    """
    assert facts_pipeline._PROMPT == facts_pipeline.build_prompt()
    assert facts_pipeline._GROUNDING_RULES in facts_pipeline._PROMPT
    assert oneshot._CAPTURE_GROUNDING_RULES not in facts_pipeline._PROMPT


def test_parse_page_prefers_a_verified_selector():
    parsed = oneshot.parse_page(
        ARTICLE_HTML,
        "https://www.example.pl/a",
        "www.example.pl",
        {"example.pl": "article.post"},
    )

    assert parsed.selector == "article.post"
    assert parsed.extraction_method == "selector"
    assert parsed.domain == "example.pl"
    assert parsed.title == "Prezes ze spolki wodociagowej"
    assert parsed.publication_date == "2026-07-14"
    assert "Jan Kowalski" in parsed.article_content
    # The nav and the footer sit outside the selector, so they stay out.
    assert "Menu" not in parsed.article_content
    assert parsed.parse_status == "ok"


def test_parse_page_falls_back_for_an_unknown_domain():
    """A domain the crawler has never seen has no learned selector.

    That is the normal case for a capture — someone found an article somewhere
    new — so it has to produce text anyway, and say that it guessed.
    """
    parsed = oneshot.parse_page(ARTICLE_HTML, "https://new.pl/a", "new.pl", {})

    assert parsed.selector is not None
    assert parsed.extraction_method is not None
    assert parsed.extraction_method.startswith("fallback:")
    assert "Jan Kowalski" in parsed.article_content


def test_parse_page_prefers_the_readers_selection():
    parsed = oneshot.parse_page(
        ARTICLE_HTML,
        "https://new.pl/a",
        "new.pl",
        {},
        content_override="  Anna Nowak kieruje urzedem.  ",
    )

    assert parsed.article_content == "Anna Nowak kieruje urzedem."
    assert parsed.extraction_method == "override"


def test_parse_page_reports_a_page_with_no_text():
    parsed = oneshot.parse_page(
        b"<html><body></body></html>", "https://n.pl", "n.pl", {}
    )

    assert parsed.article_content == ""
    assert parsed.parse_status == "empty_text"


def _analyze(llm: FakeLLM, **kwargs: Any) -> oneshot.AnalyzedArticle:
    return asyncio.run(
        oneshot.analyze(
            llm,
            url="https://www.example.pl/a",
            domain="www.example.pl",
            html=ARTICLE_HTML,
            model="test-model",
            selectors={"example.pl": "article.post"},
            **kwargs,
        )
    )


FACTS_REPLY = (
    "<think>- kandydat: Jan Kowalski</think>\n"
    "facts:\n"
    "- justification=Jan Kowalski jest radnym miasta od 2010 roku. [...] zostal "
    "powolany na stanowisko prezesa Miejskiego Przedsiebiorstwa Wodociagow "
    "| employment | person=Jan Kowalski | organization=Miejskie Przedsiebiorstwo "
    "Wodociagow | role=prezes\n"
)
SCORE_REPLY = json.dumps(
    {
        "koryciarski_llm_reason": "obsadzanie stanowisk",
        "koryciarski_llm_score": 4,
        "llm_is_article": True,
    }
)


def test_analyze_returns_scored_and_verified_facts():
    llm = FakeLLM(facts_reply=FACTS_REPLY, score_reply=SCORE_REPLY)

    analyzed = _analyze(llm)

    assert analyzed.error is None
    assert analyzed.score is not None
    assert analyzed.score.score == 4
    assert analyzed.score.is_article is True
    assert len(analyzed.facts) == 1
    fact = analyzed.facts[0]
    assert fact["fact_type"] == "employment"
    assert fact["person"] == "Jan Kowalski"
    assert fact["verified"] is True
    # Resolved back to a real span of the article, so a reviewer can find it on
    # the page — this is the pipeline's fuzzy matcher doing the work.
    assert fact["justification_in_text"]
    assert fact["justification_in_text"] in analyzed.parsed.article_content
    assert analyzed.usage.requests == 2  # facts + one judgement; score is separate


QUOTELESS_FACTS_REPLY = (
    "<think>- Jan Kowalski, prezes MPW; nazwisko i funkcja w osobnych zdaniach"
    "</think>\n"
    "facts:\n"
    "- justification= | employment | person=Jan Kowalski | organization="
    "Miejskie Przedsiebiorstwo Wodociagow | role=prezes\n"
)


def test_analyze_submits_a_fact_the_model_could_not_quote():
    """The capture path's reason for existing after this change.

    The batch run drops a fact with no verbatim span, because a span is all a
    reviewer at /ekstrakcje gets. Beside the article the reader has the text
    already, so the fact is kept — judged against that text instead.
    """
    llm = FakeLLM(facts_reply=QUOTELESS_FACTS_REPLY, score_reply=SCORE_REPLY)

    analyzed = _analyze(llm)
    payload = oneshot.submission_payload(analyzed, "capture_test")

    fact = analyzed.facts[0]
    assert fact["justification_in_text"] is None
    assert fact["verified"] is True
    assert len(payload["extracted_facts"]) == 1

    judge_prompt = next(p for p in llm.prompts if p.startswith("You label"))
    assert "ARTICLE:" in judge_prompt
    assert "Jan Kowalski jest radnym miasta" in judge_prompt
    # No empty span is handed to the judge to reject the fact on.
    assert '"justification"' not in judge_prompt.split("FACT (JSON):")[-1]


def test_a_quoted_fact_is_still_judged_on_its_span_alone():
    """The article is substituted only where there is no span to judge.

    A fact that does have one must keep being judged the way the batch run
    judges it — the rulebook's whole first principle is that the span, and
    nothing around it, decides.
    """
    llm = FakeLLM(facts_reply=FACTS_REPLY, score_reply=SCORE_REPLY)

    _analyze(llm)

    judge_prompt = next(p for p in llm.prompts if p.startswith("You label"))
    assert "ARTICLE:" not in judge_prompt
    assert '"justification"' in judge_prompt


def test_analyze_keeps_rejected_facts_out_of_what_is_submitted():
    llm = FakeLLM(
        facts_reply=FACTS_REPLY,
        score_reply=SCORE_REPLY,
        verdicts=['{"label": "incorrect", "reason": "rola nie wynika z cytatu"}'],
    )

    analyzed = _analyze(llm)
    payload = oneshot.submission_payload(analyzed, "capture_test")

    assert analyzed.facts[0]["verified"] is False
    assert payload["extracted_facts"] == []


def test_analyze_survives_a_judge_that_fails():
    """An unanswered judgement must not promote a fact by default."""
    llm = FakeLLM(
        facts_reply=FACTS_REPLY, score_reply=SCORE_REPLY, verdicts=["nonsense"]
    )

    analyzed = _analyze(llm)

    assert analyzed.facts[0]["verification_verdict"] == "unknown"
    assert analyzed.facts[0]["verified"] is False


def test_analyze_stops_when_there_is_no_article_text():
    llm = FakeLLM(facts_reply=FACTS_REPLY, score_reply=SCORE_REPLY)

    analyzed = asyncio.run(
        oneshot.analyze(
            llm,
            url="https://www.example.pl/a",
            domain="www.example.pl",
            html=b"<html><body></body></html>",
            model="test-model",
            selectors={},
        )
    )

    assert analyzed.error is not None
    assert analyzed.facts == []
    # Nothing was asked of the model, so nothing was billed.
    assert llm.prompts == []


def test_submission_payload_matches_the_ingest_contract():
    """Field for field what `/api/ingest/extraction` validates.

    The endpoint's zod schema requires url, domain, title, publication_date,
    extracted_facts and tag, with title and publication_date nullable but
    present — `uploader.py` has a comment about exactly that.
    """
    llm = FakeLLM(facts_reply=FACTS_REPLY, score_reply=SCORE_REPLY)

    payload = oneshot.submission_payload(_analyze(llm), "capture_v1")

    assert set(payload) == {
        "url",
        "domain",
        "title",
        "publication_date",
        "extracted_facts",
        "tag",
    }
    assert payload["tag"] == "capture_v1"
    assert payload["domain"] == "example.pl"
    fact = payload["extracted_facts"][0]
    # The verifier's bookkeeping is stripped; the article's date is stamped on.
    assert not {"verified", "verification_verdict", "verification_reason"} & set(fact)
    assert fact["date"] == "2026-07-14"
    assert fact["url"] == "https://www.example.pl/a"
