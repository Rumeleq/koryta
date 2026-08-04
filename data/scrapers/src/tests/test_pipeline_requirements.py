"""What a pipeline declares it needs, and what the runner builds from that."""

import pytest

from koryta import selected_resources
from scrapers.article.pipelines import (
    ArticleAnalyzed,
    ArticleDomainSelectors,
    ArticleDoneUrls,
    ArticleParsed,
)
from scrapers.stores import (
    LLM,
    NLP,
    LLMResponsePool,
    MissingResourceError,
    Pipeline,
    required_resources,
)
from scrapers.tests.mocks import get_test_context


class StubLLM(LLM):
    def response_pool(self) -> LLMResponsePool:
        raise NotImplementedError()

    async def check_health(self) -> None:
        return None


class NeedsLLM(Pipeline):
    filename = "needs_llm"
    llm: LLM


class ReadsNeedsLLM(Pipeline):
    filename = "reads_needs_llm"
    upstream: NeedsLLM


class NeedsNothing(Pipeline):
    filename = "needs_nothing"


class DerivedFromNeedsLLM(NeedsLLM):
    filename = "derived_from_needs_llm"


def test_declared_resource_is_required():
    assert required_resources(NeedsLLM) == {LLM}


def test_no_declaration_needs_nothing():
    assert required_resources(NeedsNothing) == set()


def test_requirement_is_transitive_through_sources():
    # ReadsNeedsLLM never touches the client itself, but read_or_process runs
    # a stale source before reading it.
    assert required_resources(ReadsNeedsLLM) == {LLM}


def test_requirement_is_inherited():
    assert required_resources(DerivedFromNeedsLLM) == {LLM}


def test_bind_requirements_names_the_missing_client():
    ctx = get_test_context()
    with pytest.raises(MissingResourceError) as excinfo:
        Pipeline.create(NeedsLLM).bind_requirements(ctx)
    assert excinfo.value.resource is LLM
    assert "llm: LLM" in str(excinfo.value)


def test_bind_requirements_puts_the_client_on_the_pipeline():
    ctx = get_test_context()
    ctx.llm = StubLLM()
    pipeline = Pipeline.create(NeedsLLM)
    pipeline.bind_requirements(ctx)
    assert pipeline.llm is ctx.llm


def test_from_context_returns_the_client():
    ctx = get_test_context()
    llm = StubLLM()
    ctx.llm = llm
    assert LLM.from_context(ctx) is llm


def test_from_context_raises_for_a_client_that_was_never_built():
    with pytest.raises(MissingResourceError):
        NLP.from_context(get_test_context())


def test_done_urls_alone_needs_no_llm():
    # It reads postgres and the URL store, so a run that only refreshes it has
    # no reason to want an LLM backend up.
    assert selected_resources({"ArticleDoneUrls"}) == set()
    assert required_resources(ArticleDoneUrls) == set()


def test_the_article_pipelines_that_prompt_need_the_llm():
    assert required_resources(ArticleDomainSelectors) == {LLM}
    # Neither of these prompts, both sit above one that does.
    assert required_resources(ArticleParsed) == {LLM}
    assert required_resources(ArticleAnalyzed) == {LLM}


def test_selected_resources_unions_over_the_selection():
    assert selected_resources({"ArticleAnalyzed", "ProcessWiki"}) == {LLM}
    assert selected_resources({"ProcessWiki"}) == set()
