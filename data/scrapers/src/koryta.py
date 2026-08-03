import argparse
import json
import os
import sys

import pandas as pd

from conductor import setup_context
from pipelines import PIPELINES
from scrapers.stores import (
    Pipeline,
    ProcessPolicy,
    iterate_pipeline_dict,
)
from scrapers.wiki import dump as wiki_dump_args

ARTICLE_PIPELINES = {
    "ArticleAnalyzed",
    "ArticleDoneUrls",
    "ArticleDomainSelectors",
    "ArticleExtractedFacts",
    "ArticleFactsVerified",
    "ArticleKoryciarskiScores",
    "ArticleParsed",
}


class Printer:
    def __init__(self, args):
        self.args = args
        self.output = sys.stderr if self.args.output == "stderr" else sys.stdout

    def print_results(self, res):
        if self.args.output in {"stdout", "stderr", "formatted"}:
            for item in self.iterate(res):
                print(self.format_dict(item), file=self.output)
        else:
            print("Finished processing")

    def format_dict(self, d):
        if self.args.output == "formatted":
            return json.dumps(d, default=str, ensure_ascii=False, indent=2)
        else:
            # Returns as sinle elements in a line
            return json.dumps(d, default=str, ensure_ascii=False)

    def iterate(self, res):
        if isinstance(res, pd.DataFrame):
            yield from iterate_pipeline_dict(res)
        elif isinstance(res, list):
            for item in res:
                yield item


def get_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh",
        help="Pipeline name to refresh, : to exclude or 'all'",
        action="append",
        default=[],
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Disable uploading/reading versioned backups to/from shared GCS "
        "(also settable via DISABLE_BACKUP in the environment or .env)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run every pipeline except ScrapeRejestrIO, which bills per query.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Pipeline name to skip running. Repeatable, and applies to --all.",
    )
    parser.add_argument(
        "pipeline",
        help="Pipeline to be run - available are "
        + " ".join(pt.__name__ for pt in PIPELINES),
        default=None,
        nargs="*",
    )
    parser.add_argument(
        "--output",
        type=str,
        choices=["file", "stdout", "stderr", "formatted"],
        default="file",
        help="Output channel (file or stdout)",
    )
    parser.add_argument(
        "--llm",
        action="store_true",
        help="Initialize the OpenAI-compatible local LLM client.",
    )
    parser.add_argument(
        "--llm-model",
        default="Qwen/Qwen3-14B",
        help="Model name for local OpenAI-compatible LLM servers.",
    )
    parser.add_argument(
        "--llm-ports",
        default="6000-6015",
        help="LLM ports as an inclusive range or comma list, e.g. 6000-6015.",
    )
    parser.add_argument(
        "--llm-per-port-concurrency",
        type=int,
        default=4,
        help="Concurrent requests allowed per LLM port.",
    )
    parser.add_argument(
        "--llm-base-url",
        default=None,
        help="OpenAI-compatible base URL (e.g. https://openrouter.ai/api/v1). "
        "When set, requests go here instead of local ports. API key is read "
        "from --llm-api-key or the OPENROUTER_APIKEY / OPENAI_API_KEY env var.",
    )
    parser.add_argument(
        "--llm-api-key",
        default=None,
        help="Bearer token for --llm-base-url (falls back to env).",
    )
    parser.add_argument(
        "--llm-request-timeout-seconds",
        type=int,
        default=1800,
        help="HTTP timeout for each LLM request.",
    )
    parser.add_argument(
        "--article-workers",
        type=int,
        default=4,
        help="Parallel workers for article parsing pipelines.",
    )
    parser.add_argument(
        "--article-facts-min-koryciarski-score",
        type=int,
        default=None,
        help=(
            "Only run ArticleExtractedFacts LLM extraction for uncached articles "
            "with koryciarski_llm_score >= N."
        ),
    )
    parser.add_argument(
        "--article-facts-max-tokens",
        type=int,
        default=None,
        help="Max completion tokens for ArticleExtractedFacts LLM requests.",
    )
    parser.add_argument(
        "--article-facts-text-limit",
        type=int,
        default=None,
        help="Max article text characters fed to the facts extraction prompt.",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="Tag for this pipeline run (e.g. v1_qwen3-32b), stored in output records.",
    )
    # Read by scrapers.wiki.dump, registered here so their values are not
    # mistaken for pipeline names by the positional below.
    wiki_dump_args.add_arguments(parser)
    args, _ = parser.parse_known_args()
    return args


def _parse_ports(raw_ports: str) -> list[int]:
    raw_ports = raw_ports.strip()
    if not raw_ports:
        return []
    ports: list[int] = []
    for part in raw_ports.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            if end < start:
                raise ValueError("--llm-ports range end must be >= start")
            ports.extend(range(start, end + 1))
        else:
            ports.append(int(part))
    return ports


def main():
    args = get_args()
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    refresh = []
    exclude_refresh = []
    if args.refresh:
        for r in args.refresh:
            if r.startswith(":"):
                exclude_refresh.append(r[1:])
            else:
                refresh.append(r)

    policy = ProcessPolicy.with_default(refresh, exclude_refresh=exclude_refresh)

    pipeline_names = set(pt.__name__ for pt in PIPELINES)
    exclude = set(args.exclude)
    unknown = (exclude | set(args.pipeline)) - pipeline_names
    if unknown:
        raise ValueError(
            f"Pipeline(s) not found: {' '.join(sorted(unknown))}. "
            f"Available: {' '.join(sorted(pipeline_names))}"
        )

    if args.all:
        if args.pipeline:
            raise ValueError("--all runs everything, so it takes no pipeline names")
        # ScrapeRejestrIO bills per query -- never part of a bulk run.
        selected = pipeline_names - {"ScrapeRejestrIO"} - exclude
    elif args.pipeline:
        selected = set(args.pipeline) - exclude
    else:
        raise ValueError("No pipeline specified, use koryta PipelineName or --all")

    needs_llm = args.llm or bool(selected & ARTICLE_PIPELINES)
    ctx, dumper = setup_context(
        False,
        use_llm=needs_llm,
        llm_ports=_parse_ports(args.llm_ports),
        llm_model=args.llm_model,
        llm_per_port_concurrency=args.llm_per_port_concurrency,
        llm_request_timeout_seconds=args.llm_request_timeout_seconds,
        llm_base_url=args.llm_base_url,
        llm_api_key=(
            args.llm_api_key
            or os.environ.get("OPENROUTER_APIKEY")
            or os.environ.get("OPENAI_API_KEY")
        ),
        article_workers=args.article_workers,
        article_facts_min_koryciarski_score=(
            args.article_facts_min_koryciarski_score
        ),
        article_facts_max_tokens=args.article_facts_max_tokens,
        article_facts_text_limit=args.article_facts_text_limit,
        article_tag=args.tag,
        policy=policy,
    )

    for p_name in sorted(selected):
        print(f"Will run pipeline: {p_name}")

    printer = Printer(args)
    try:
        for p_type in PIPELINES:
            if p_type.__name__ in selected:
                print(f"Processing {p_type.__name__}")
                p: Pipeline = Pipeline.create(p_type)
                res = p.read_or_process(ctx)
                printer.print_results(res)
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")


if __name__ == "__main__":
    main()
