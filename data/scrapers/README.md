To run the binaries in this directory you need [uv](https://docs.astral.sh/uv/). It
fetches the Python 3.13 this project pins by itself, so nothing else has to be
installed first.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh

gcloud auth login # this is needed for buckets - https://docs.google.com/document/d/1bGrtID-mIFFitvfR_cEmmbV8hvTLDIWFQhnRiSwDlyY
gcloud auth application-default set-quota-project koryta-pl  # To access Google cloud resources.

uv sync --all-groups   # creates .venv and installs everything in uv.lock
```

Leave out `--all-groups` to skip the `ml` group (torch, spacy and the nvidia
runtimes, 4.5 GB) if you are not touching the extraction models. The model
weights themselves are not dependencies: `stores.textmodel.ner` fetches each
one into `models/` the first time it is asked for.

Dependencies live in `pyproject.toml` and are pinned in `uv.lock`; run
`uv lock` after editing the former and commit both.

Data mining code is located in the `src` directory. Some tests are located in the `tests` dir, while others are in the `src`, near the libraries that are tested.

## Required access

Make sure you have:

- Read access to [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled;tab=objects?forceOnBucketsSortingFiltering=true&authuser=0&hl=en-GB&project=koryta-pl&prefix=&forceOnObjectsSortingFiltering=false) GCS (Google Cloud Storage) bucket in GCP.
- Writing access to [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled) is needed to run the scraper

## Basic information

Note that everything costs. Not too much, but don't redownload data

- Queries to Firestore cost $0.03
- GCS egress and ingress costs something as well per GB

During the course of the running of multiple binaries here, there will be two directories created along `src` and `tests` folders. They are defined in the `src/util/config.py` directory

- `versioned` - Output of the scripts - processed data. The idea is to have a versioned copy of these folders. Currently I'm copying them once a day manually, to have a data to fallback on and compare.

- `downloaded` - Downloaded local verison of the data from a [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled;tab=objects?forceOnBucketsSortingFiltering=true&authuser=0&hl=en-GB&project=koryta-pl&prefix=&forceOnObjectsSortingFiltering=false) bucket in GCP or from external sources specified in the scripts (e.g. PKW processing)

## Scripts

You can run each script with `uv run scripts-name`.

Refer to `pyproject.toml` for the most up-to-date list of the scripts available there.

## The nightly pipeline run

`.github/workflows/pipelines.yml` runs the pipelines on CI in two tiers.

- **slice**, on every pull request touching `data/scrapers/`. One multistream
  shard of the Wikipedia dump (~230 MB), `ProcessWiki` only, a few minutes, no
  credentials. Most pipeline breakage is structural and shows up on a shard
  exactly as it would on the whole dump.
- **full**, nightly at 03:00 UTC. The whole 2.9 GB dump, every pipeline except
  `ScrapeRejestrIO` (bills per query) and `ProcessWikiNer` (its own extra pass
  over the dump), reprocessed from scratch.

Both pin a dated dump rather than `latest`, which rotates roughly twice a month
-- on `latest` a red build cannot tell "the pipeline broke" from "Wikipedia
changed", and the download cache key is never stable. The date is
`DEFAULT_DUMP_DATE` in the workflow; wikimedia prunes old runs, so when the
resolve step reports a 404 that variable needs bumping.

The full tier needs two repository variables for Workload Identity Federation,
which is how it reads GCS and Firestore without a key file:
`GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_PIPELINES_SERVICE_ACCOUNT`. Give the
service account read-only access; the run passes `--no-backup` so it never
writes to the shared bucket. Fork pull requests get no OIDC token, which is why
the slice tier stays credential-free.

To reproduce a CI run locally:

```bash
uv run koryta --all --exclude ProcessWikiNer \
  --refresh all --no-backup --assume-yes \
  --wiki-dump-url https://dumps.wikimedia.org/plwiki/20260701/plwiki-20260701-pages-articles-multistream1.xml-p1p187037.bz2 \
  --wiki-dump-file plwiki-20260701-shard1.bz2
```

`--assume-yes` matters unattended: without it the "this pipeline runs long"
prompts read EOF, take it as no, and skip the wiki pass without saying much.

### Checking the output

`src/tests/e2e/` asserts on `versioned/` after a run -- that outputs exist, that
row counts are in band, and that no column quietly stopped being populated. It
never runs a pipeline itself. The tests are deselected by default (they need a
run's output); CI runs them with `KORYTA_E2E_STRICT=1`, which turns a missing
output from a skip into a failure.

```bash
uv run pytest -m e2e src/tests/e2e
```

The bands live in `src/tests/e2e/baseline.json`, and come from an observed run
rather than from anyone's guess. To record or refresh them, run the pipelines
and then:

```bash
KORYTA_E2E_UPDATE_BASELINE=1 uv run pytest -m e2e src/tests/e2e
```

then commit the diff. An entry whose `rows` is `null` is reported but not
enforced, so a new output can be added to the file before its numbers are known.
