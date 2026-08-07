import argparse
import json
import sys
import time
import typing

import numpy as np
import requests

from analysis.interesting import Companies
from conductor import setup_context
from entities.company import display_name
from entities.composite import PersonScore
from entities.person import is_pipeline_uid
from scrapers.stores import iterate_pipeline_dict
from stores.auth import authenticate_user
from stores.upload_state import STATE_DIR, UploadState, target_slug
from util.firestore import BATCH_LIMIT, Firestore

#: Votes per Firestore batch, and the rest between batches. Together they cap
#: how fast `onVoteWritten` invocations pile up: the default lets through about
#: a hundred a second, against the several thousand a second an unpaced run
#: managed. Raise them for an emulator, which has no such queue to overwhelm.
DEFAULT_BATCH_SIZE = 100
DEFAULT_BATCH_PAUSE = 1.0


class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)


class Args:
    endpoint: str
    submit: bool
    type: typing.Literal["person", "company", "region", "score", "extraction"]
    database: str
    limit: int | None
    offset: int | None
    model: str | None
    batch_size: int
    batch_pause: float
    max_operations: int | None
    resume: bool
    state_dir: str


def parse_args() -> Args:
    parser = argparse.ArgumentParser(
        description="Upload koryta data to Firestore from stdin."
    )
    parser.add_argument(
        "--endpoint", default="http://localhost:3000", help="API endpoint URL"
    )
    parser.add_argument("--submit", action="store_true", help="Submit data to the API")
    parser.add_argument(
        "--type",
        choices=["person", "company", "region", "score", "extraction"],
        help="Entity type to query",
    )
    parser.add_argument(
        "--database", type=str, default="koryta-pl", help="Firebase Database ID"
    )
    parser.add_argument(
        "--limit", type=int, help="Maximum number of entities to upload."
    )
    parser.add_argument(
        "--offset", type=int, default=0, help="Skip the first N entities."
    )
    parser.add_argument(
        "--prod", action="store_true", help="Production mode (requires token auth)"
    )
    parser.add_argument(
        "--model",
        type=str,
        help="For --type score: store the votes under this pipeline uid instead "
        "of the one the rows carry. The name must contain 'pipeline', which is "
        "what marks a vote as not cast by a person. With --resume, resume only "
        "this model rather than everything outstanding.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"For --type score: votes per Firestore batch (max {BATCH_LIMIT}).",
    )
    parser.add_argument(
        "--batch-pause",
        type=float,
        default=DEFAULT_BATCH_PAUSE,
        help="For --type score: seconds to rest between batches. 0 uploads as "
        "fast as the network allows, which is what overwhelms the vote trigger.",
    )
    parser.add_argument(
        "--max-operations",
        type=int,
        help="For --type score: stop after this many votes and leave the rest "
        "for a later --resume. Lets one plan be spread over several runs.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="For --type score: read nothing, and instead finish the plans an "
        "earlier run left outstanding. Without --submit, lists them.",
    )
    parser.add_argument(
        "--state-dir",
        type=str,
        default=STATE_DIR,
        help="Where unfinished score uploads are kept between runs.",
    )
    args = parser.parse_known_args()[0]
    return args  # type: ignore


def clean_payload(payload):
    if isinstance(payload, dict):
        return {k: clean_payload(v) for k, v in payload.items() if v is not None}
    elif isinstance(payload, list):
        return [clean_payload(v) for v in payload if v is not None]
    else:
        return payload


class Uploader:
    # Per-type ingest URLs handled by the generic submit_entity path. Extraction
    # is handled by ExtractionUploader (batched), so it is intentionally absent.
    TYPE_URLS: dict[str, str] = {}

    def __init__(self, args: Args):
        self.args = args

        if args.type in ["score"]:
            self.firestore = Firestore(args)
        else:
            token = authenticate_user(args.endpoint)
            self.headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            }

    @staticmethod
    def create(args: Args) -> "Uploader":
        if args.type == "person":
            return PersonUploader(args)
        if args.type == "company":
            return CompanyUploader(args)
        if args.type == "extraction":
            return ExtractionUploader(args)
        if args.type == "score":
            return ScoreUploader(args)
        return Uploader(args)

    def submit_entity(self, payload) -> requests.Response:
        url = self.TYPE_URLS.get(self.args.type, None)

        if url is None:
            raise NotImplementedError(
                f"This function is not implemented for ${self.args.type}"
            )

        return self.submit_payload(url, payload)

    def submit_payload(self, url, payload, fail=True, verbose=False):
        print(
            f"Uploading {payload['name']}... to {url}",
            end=" ",
            file=sys.stderr,
        )
        cleaned_payload = clean_payload(payload)
        request = json.dumps(cleaned_payload, cls=NumpyEncoder)
        if verbose:
            print(request, file=sys.stderr)
            print(payload, file=sys.stderr)
            print(cleaned_payload, file=sys.stderr)
        resp = requests.post(
            url,
            data=request,
            headers=self.headers,
        )
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            if fail:
                raise Exception(
                    f"API error: {resp.status_code} - {resp.text} for: {payload}"
                )

        return resp

    def submit_results(self, entities):
        self.success_count = 0
        self.total = 0
        for idx, payload in enumerate(entities):
            if self.args.limit is not None and idx >= self.args.limit:
                print(f"Reached limit {self.args.limit}")
                break
            time.sleep(0.3)
            name = payload.get("name", None) if payload is not None else None
            if payload is None or name is None:
                print(
                    f"[{idx + 1}/{self.total}] Skipping invalid payload ...",
                    file=sys.stderr,
                )
                continue

            self.check_success(self.submit_entity(payload))

        failures = self.total - self.success_count
        print(
            f"\nUpload complete. Success: {self.success_count}, Failed: {failures}",
            file=sys.stderr,
        )

    def check_success(self, resp):
        self.total += 1
        if resp.status_code == 200:
            self.success_count += 1
        return resp


class CompanyUploader(Uploader):
    def __init__(self, args: Args):
        super().__init__(args)
        self._company_payloads: dict | None = None

    @typing.override
    def submit_entity(self, payload):
        mapped_payload = dict(payload)
        return self.submit_company(mapped_payload["krs"], mapped_payload)

    @property
    def company_payloads(self) -> dict:
        """Company payloads keyed by KRS, loaded lazily from the Companies
        pipeline.

        Only needed as a fallback when a caller asks to submit a company by KRS
        without providing a payload (e.g. PersonUploader creating a missing
        company). Uploading companies with explicit payloads from stdin never
        triggers this, so `--type company` avoids re-running the whole
        (expensive) Companies pipeline.
        """
        if self._company_payloads is None:
            print("Loading company payloads from Companies pipeline")
            df = Companies().read_or_process(setup_context()[0])
            self._company_payloads = {c["krs"]: c for c in iterate_pipeline_dict(df)}
        return self._company_payloads

    def submit_company(self, krs: str, payload: dict | None):
        current_target_url = f"{self.args.endpoint}/api/ingest/company"
        if payload is None:
            payload = self.company_payloads.get(krs, None)
            if payload is None:
                raise ValueError(f"Couldn't look up {krs} in Companies pipeline")

        assert payload is not None

        # TODO move it somewhere else - Companies pipeline?
        owners = []
        for parent in payload.get("parents", []):
            if isinstance(parent, dict) and parent.get("krs"):
                owners.append(parent["krs"])
        payload["owners"] = owners
        if "teryt_code" in payload and payload["teryt_code"]:
            payload["teryt"] = payload["teryt_code"]
        # A company created because a person works there comes straight from
        # the Companies pipeline rather than through CompaniesPayloads, so it
        # needs the same disambiguation.
        payload["name"] = display_name(payload.get("name"), payload.get("city"))
        return self.submit_payload(
            current_target_url,
            payload,
        )


class PersonUploader(CompanyUploader):
    """PersonUploader submits results for a given person.

    It inherits CompanyUplader, since it needs to upload companies
    if they are missing."""

    @typing.override
    def submit_entity(self, payload):
        current_target_url = f"{self.args.endpoint}/api/ingest/person"
        resp = self.check_success(
            self.submit_payload(
                current_target_url,
                payload,
                fail=False,
            )
        )
        if resp.status_code == 404:
            # Deduplicate, e.g if a person was employed there twice
            for krs in set(resp.json()["data"]):
                self.submit_company(krs, None)
            # Try submitting again
            return self.submit_payload(current_target_url, payload, fail=False)
        else:
            return resp


class ScoreUploader(Uploader):
    """Uploads one scoring model's shortlist of people worth a look.

    Scores go straight to Firestore rather than through the API: they are the
    pipeline's own opinion rather than a fact about a person, and they are
    stored as votes so that the site's existing aggregate does the combining.
    Each model votes under its own uid, so uploading one model never touches
    another's scores.

    Unlike the per-entity uploaders it decides what to write for the whole run
    at once, because what to write can only be decided against what the model
    wrote last time - see `Firestore.plan_scores`. Sending that plan is a
    separate, slower step: the votes go out in paced batches, and what has not
    gone out yet is kept on disk so an interrupted upload can be finished
    without re-running the pipeline that produced the scores.
    """

    @property
    def target(self) -> str:
        return target_slug(self.args.endpoint, self.args.database)

    @typing.override
    def submit_results(self, entities):
        rows = [PersonScore(**e) for e in entities if e is not None]
        if not rows:
            print("No scores to upload.", file=sys.stderr)
            return

        model = self.model_of(rows)
        # Only part of the run reached us, so a person missing from it may
        # simply have been cut off rather than dropped by the model.
        partial = bool(self.args.limit or self.args.offset)
        operations = self.firestore.plan_scores(model, rows, retract=not partial)

        left_over = UploadState.load(
            UploadState.path_for(model, self.target, self.args.state_dir)
        )
        if left_over is not None and left_over.pending:
            print(
                f"{model}: an earlier run left {len(left_over.pending)} operations "
                "outstanding; the plan above was diffed against Firestore as it "
                "stands, so it already covers them.",
                file=sys.stderr,
            )

        self.total = len(rows)
        self.success_count = len(rows)
        if not operations:
            if left_over is not None:
                left_over.finish()
            print(f"\n{model}: already up to date, nothing to upload.", file=sys.stderr)
            return

        state = UploadState.start(model, self.target, operations, self.args.state_dir)
        self.drain(state)

    def resume(self) -> None:
        """Finish the plans earlier runs did not get through."""
        states = UploadState.pending_runs(
            self.target, self.args.model, self.args.state_dir
        )
        if not states:
            print(f"Nothing outstanding for {self.target}.", file=sys.stderr)
            return

        for state in states:
            print(
                f"{state.model}: {len(state.pending)} of {state.planned} operations "
                f"still to send ({state.applied} already written).",
                file=sys.stderr,
            )

        if not self.args.submit:
            print("\nUse --submit to send them.", file=sys.stderr)
            return

        for state in states:
            self.drain(state)

    def drain(self, state: UploadState) -> None:
        """Send as much of `state` as this run is allowed to, then report.

        Records progress as it goes rather than at the end: whatever this
        returns without sending stays on disk, so a later `--resume` - or the
        next full run, which re-diffs and finds the same gap - picks it up.
        """
        # Slices a copy even when max_operations is None, so `state.advance`
        # is not editing the list being sent.
        todo = state.pending[: self.args.max_operations]
        capped = len(todo) < len(state.pending)

        print(
            f"{state.model}: sending {len(todo)}"
            + (f" of {len(state.pending)}" if capped else "")
            + f" operations, {self.args.batch_size} at a time, "
            f"{self.args.batch_pause}s apart.",
            file=sys.stderr,
        )

        try:
            self.firestore.apply_scores(
                state.model,
                todo,
                batch_size=self.args.batch_size,
                pause=self.args.batch_pause,
                on_batch=state.advance,
            )
        finally:
            if state.pending:
                print(
                    f"\n{state.model}: {len(state.pending)} operations left of "
                    f"{state.planned}. Finish them with:\n"
                    f"  koryta_uploader --type score --submit --resume "
                    f"--endpoint {self.args.endpoint}",
                    file=sys.stderr,
                )
            else:
                state.finish()
                print(
                    f"\nUpload complete. Model: {state.model}, "
                    f"{state.applied} operations written.",
                    file=sys.stderr,
                )

    def model_of(self, rows: list[PersonScore]) -> str:
        """The uid to store this run under, and a check that it is a robot's.

        A vote whose uid does not read as the pipeline's would be counted as
        human review by the frontend, which would mark thousands of people as
        looked at by somebody when nobody has looked at them.
        """
        if self.args.model:
            model = self.args.model
        else:
            models = {row.model for row in rows}
            if len(models) != 1:
                raise ValueError(
                    f"Expected one model per upload, got {sorted(models)}. "
                    "Upload each model's scores separately, or pass --model."
                )
            model = models.pop()

        if not is_pipeline_uid(model):
            raise ValueError(
                f"Model uid {model!r} does not contain 'pipeline', so the site "
                "would count its votes as human review."
            )
        return model


class ExtractionUploader(Uploader):
    """Uploads facts extracted from newspaper articles.

    Each stdin line is a full article carrying an ``extracted_facts`` list. The
    ``/api/ingest/extraction`` endpoint accepts a batch of articles in a single
    request, so unlike the per-entity uploaders we post everything at once. The
    articles have no ``name`` field, so the generic ``submit_results`` (which
    skips nameless payloads and prints ``payload['name']``) doesn't apply.
    """

    @typing.override
    def submit_results(self, entities):
        url = f"{self.args.endpoint}/api/ingest/extraction"
        articles = [e for e in entities if e is not None]
        fact_count = sum(len(a.get("extracted_facts") or []) for a in articles)
        self.total = fact_count
        self.success_count = 0

        print(
            f"Uploading {len(articles)} articles ({fact_count} facts) to {url}...",
            end=" ",
            file=sys.stderr,
        )
        # Note: do not run clean_payload here — the endpoint schema keeps
        # `title`/`publication_date` as nullable-but-required, so stripping
        # their `null` values would fail validation.
        resp = requests.post(
            url,
            data=json.dumps({"articles": articles}, cls=NumpyEncoder),
            headers=self.headers,
        )
        if resp.status_code in [200, 201]:
            print("  OK", file=sys.stderr)
            self.success_count = fact_count
        else:
            print(f"FAILED ({resp.status_code}): {resp.text}", file=sys.stderr)
            raise Exception(f"API error: {resp.status_code} - {resp.text}")

        print(
            f"\nUpload complete. Articles: {len(articles)}, Facts: {fact_count}",
            file=sys.stderr,
        )


def print_results(entities):
    print("\n--- Payload Preview (First 3) ---", file=sys.stderr)
    for i in range(min(3, len(entities))):
        print(json.dumps(entities[i], indent=2, ensure_ascii=False), file=sys.stderr)


def read_payloads_filtered(args) -> list[dict]:
    # Read from stdin
    entities = []
    skipped = 0
    count = 0

    if sys.stdin.isatty():
        print("Waiting for JSONL data on standard input...", file=sys.stderr)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            print(f"Error parsing JSON on line: {e}", file=sys.stderr)
            continue

        # Allow offsetting the reads, skipping the 'offset' first entries.
        if skipped < args.offset:
            skipped += 1
            continue

        entities.append(payload)
        count += 1

        if args.limit and count >= args.limit:
            break

    return entities


def main():
    args = parse_args()

    if args.resume:
        # Nothing to read: what to send is already on disk, which is the whole
        # point - the rows came from a pipeline run nobody wants to repeat.
        if args.type != "score":
            raise ValueError("--resume only applies to --type score")
        typing.cast(ScoreUploader, Uploader.create(args)).resume()
        return

    entities = read_payloads_filtered(args)
    print(f"Query returned {len(entities)} rows.", file=sys.stderr)

    if len(entities) == 0:
        print("No results.", file=sys.stderr)
        sys.exit(0)

    if not args.submit:
        print_results(entities)
        print("\nUse --submit to upload.", file=sys.stderr)
    else:
        uploader = Uploader.create(args)
        uploader.submit_results(entities)


if __name__ == "__main__":
    main()
