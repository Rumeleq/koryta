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

## Monitor Sądowy i Gospodarczy (MSiG)

The only free source that gives people's names in full. `api-krs.ms.gov.pl`
masks them by law -- a board member reads `G******* S********` with a PESEL of
`6**********` -- and the unmasked "Full API" needs a decision from the
Minister of Justice that a transparency project will not get. The Monitor
published the KRS entries themselves, and those spell out
`GOSIEWSKI STANISŁAW ANTONI 69032811497`.

`wyszukiwarka-msig.ms.gov.pl` runs an undocumented JSON API under its Angular
app: no key, no captcha, no robots.txt. `scrapers/msig/api.py` has the
particulars, including the two parameters that 444 the request by their
absence.

**Two things bound what this is worth.**

KRS entries stopped being published in the Monitor at the turn of 2026, when
the obligation to publish them was repealed. Measured on the search itself,
day by day: 201 entries on 2025-08-04, 3 on 2026-02-04, 1 on 2026-08-03; by
month, 1622 in November 2025 down to 4 in July 2026. So this is a closed
archive -- 2001 to late 2025 -- and nothing after it. Names of people
appointed since then have no free source at all.

And the whole Monitor is far too big to take: one publication day carries
around 4000 KRS entries, which is tens of millions of announcements over the
archive. The sweep therefore goes company by company, over the KRS numbers
`CompaniesKRS` already knows, which is on the order of half a million
requests.

```bash
uv run koryta_scrape_msig --limit 20   # a pilot, twenty companies
uv run koryta_scrape_msig --dry-run    # what a full sweep would cover
uv run koryta_scrape_msig              # the sweep: hours, resumable
```

It writes to `koryta-pl-crawled` under
`hostname=wyszukiwarka-msig.ms.gov.pl/date=<crawl>/uid_*.tar.gz` -- batched,
because half a million 5 KB objects is half a million GCS operations to write
and to read back. `Conductor.read_many` unpacks such archives transparently
and hands their members back under the object names they would have had
unbatched, so pipelines do not know the difference.

Resuming reads what actually landed in the bucket rather than a local ledger:

```bash
uv run koryta_scrape_msig --refresh MSiGCrawled   # after a previous run
```

Then the two pipelines, neither of which touches the network:

```bash
uv run koryta PeopleMSiG  --refresh PeopleMSiG    # people, one row per entry
uv run koryta CompanyMSiG --refresh CompanyMSiG   # names, REGON, seats
```

`PeopleMSiG` is a history of appointments and dismissals, not a roster: each
row says that on a date somebody was written into or struck from a post
(`action`), because that is what the Monitor publishes. `dla_pozycji` is a
third case -- named while some other field of theirs was amended, so: sitting
at the time. A roster on a date is a replay of the rows up to it.

The intended use is unmasking. Take the masked current board from
`KRSCensoredPeople`, match first letter, surname length and the PESEL's first
digit against the candidates `PeopleMSiG` holds for the same KRS, and the
match is usually unique. Entries from 2026 on will not have a candidate.

`scrapers/msig/people.py` classifies a rubryka before reading anybody out of
it, and counts the ones it cannot classify. If a run prints `unclassified
rubryki holding names`, the register has a kind of post that module has not
been taught -- the rows are dropped, deliberately and loudly.

## Centralny Rejestr Umów (CRU)

`CruDump` fetches the public contracts register from a postgres mirror of the
[rejestrumow.gov.pl](https://rejestrumow.gov.pl) API and leaves a compressed
dump at `downloaded/rejestrumow_dump.sql.gz`; `CruUmowy` turns that into one
JSONL line per contract, with the contract's parties nested.

```bash
uv run koryta CruDump  --refresh CruDump --output formatted   # ~14s
uv run koryta CruUmowy --refresh CruUmowy                     # ~16s, 149k lines
```

Only `CruDump` needs credentials, and it takes them from `~/.pgpass` -- never
from a flag or the repo:

```
2a09:8280:1::5b:776c:5432:rejestr_umow:koryta_ro_user:<password>
```

It also needs a `pg_dump` at least as new as the server (15.10 today; Ubuntu
24.04's `postgresql-client-16` is fine).

Without those, `CruDump` falls back to `downloaded/` and then to the artifact
in the shared cache, so `CruUmowy` still runs on a checkout with no database
access at all. That last rung needs `USERNAME` set in `.env` like every other
shared-cache read does -- `get_username()` otherwise prompts, which is an
`EOFError` rather than a fallback on a headless run. `--cru-no-redump` skips
the mirror outright, and
`--cru-dump-file <path>` adopts a dump you already have. The artifact is
published to the shared cache only when it was freshly dumped *and* its sha256
changed, because that bucket partitions by timestamp and is never pruned.

## The compressed mirror

Pipelines that read a whole hostname prefix -- the KRS ones, off
`hostname=rejestr.io` -- go through `gs://koryta-pl-compressed` rather than
fetching each object. GCS gives about 5-7 small objects a second, so the ~29k
rejestr.io responses took most of an hour; the same data is one 18 MB archive
that reads in seconds. Each run prints which archives it used, dates included.

That archive is a snapshot. To rebuild it for one host:

```bash
cd ../compressor
go run ./cmd/compressor \
  -in-bucket koryta-pl-crawled -out-bucket koryta-pl-compressed \
  -incremental -hostname rejestr.io
```

Pass `--no-mirror` to skip it and read the bucket object by object instead.
That is much slower, but it sees everything written since the last rebuild,
which is what you want when iterating on a scrape:

```bash
uv run koryta ScrapeRejestrIO --no-mirror
```

## The nightly pipeline run

`.github/workflows/pipelines.yml` runs the pipelines on CI in two tiers.

- **slice**, on every pull request touching `data/scrapers/`. One multistream
  shard of the Wikipedia dump (~230 MB), `ProcessWiki` only, a few minutes, no
  credentials. Most pipeline breakage is structural and shows up on a shard
  exactly as it would on the whole dump.
- **full**, nightly at 03:00 UTC. The whole 2.9 GB dump, every pipeline except
  `ScrapeRejestrIO` (bills per query) and `ProcessWikiNer` (its own extra pass
  over the dump), reprocessed from scratch.

Both then run `src/tests/pipelines`, which the unit-test job cannot: those
tests call `read_or_process` and so need real downloaded data, which is what
issue #196 is about. On the full tier the pipeline step has already written
`versioned/`, so they read that instead of reprocessing, and cost almost
nothing.

The slice tier runs only `test_person_pkw.py`, and the reason is runtime, not
access: only `ProcessWiki` ran there, so any other module would execute its
whole graph from scratch and turn a pull request into a full run. PKW is the
cheapest, and `PeoplePKW -> Teryt` needs no credentials at all, so it works on
a fork's pull request too. Widen the list in the workflow if you want more --
a same-repo pull request does get bucket access, it will just be slow.

`test_scrape_rejestr_io.py` is excluded from both. With no versioned output and
backups disabled it would not read a cached result; it would run the scraper,
and that one bills per query.

Both pin a dated dump rather than `latest`, which rotates roughly twice a month
-- on `latest` a red build cannot tell "the pipeline broke" from "Wikipedia
changed", and the download cache key is never stable. The date is
`DEFAULT_DUMP_DATE` in the workflow; wikimedia prunes old runs, so when the
resolve step reports a 404 that variable needs bumping.

CI reads GCS through Workload Identity Federation, so no key file: set the
repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_PIPELINES_SERVICE_ACCOUNT`. `roles/storage.objectViewer` on
`gs://koryta-pl-crawled` is the whole grant. Nothing here touches the live
Firestore -- what `scrapers.koryta.download` calls a `FirestoreCollection` is a
leveldb export of it sitting in that same bucket -- and the run passes
`--no-backup`, so it never writes anywhere.

A fork's pull request gets no OIDC token, so it runs without credentials. That
is fine: the slice tier's pipelines do not need any.

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
