# Adding a person from a rejestr.io link

## 1. What this is

Today, the only way to get a person onto the site from a rejestr.io URL is to know that `--rejestrio-id` exists, know that the flag has to follow the pipeline name because `koryta` uses `parse_known_args` with the pipeline as a positional, know the stdout/stderr swap that `submit_people.sh` performs, and have a browser open so `stores/auth.py:54` can complete its login. Then you wait — a cold run measured 9 m 19 s and 5.18 GB — and at the end you find out whether we had any records on that person at all. Half the time the answer is no, and you paid the full run to learn it. Worse: for 833 register ids the run publishes a page carrying somebody _else's_ name and rejestr.io URL, because two humans were merged upstream by `create_people_table`'s ±1-year birth-year smoothing, and nothing tells you before the page exists.

The fix splits that into two halves that have very different costs. The **answer** — do we hold records on this person, under what name, filed under which id, are they already on the site — is a lookup in a 1.87 MB precomputed table, and Nuxt can serve it synchronously from one 7.3 kB gzipped object in a bucket it already reads. The **production** is the existing one-liner, run on predator by a systemd user timer against the corpus that already lives there, pinned with `--refresh :PeopleEnriched` so it takes 6.16 s instead of nine minutes. There is no Cloud Run job, no Cloud Tasks queue, no new service account, no Cloud Functions deploy and no composite-index deploy in this design. There is one new IAM grant, one new Firestore collection, one rules deploy, and about 700 lines of wiring around machinery that already works.

## 2. What already exists

This is mostly wiring. The expensive parts are built.

**`--rejestrio-id` is on main and works.** Declared at `analysis/extract.py:240` ("Extract a person with a given RejestrIO id"), applied at `extract.py:598-603`. It takes a bare id string, not a URL. So this runs today:

```
koryta PeoplePayloads --rejestrio-id 1242560 --output stderr 2>&1 1>/dev/null \
  | koryta_uploader --type person --submit --endpoint https://koryta.pl
```

It is **not** additive in practice, contrary to what the earlier notes said. `auto_approved_func` is `if not self.approved: return lambda row: 0` (`extract.py:545-547`), and `works_in_relevant` (`extract.py:473-515`) returns 0 for every row when `relevant_companies` is empty and `--all` is unset — and `relevant_companies` is empty without `--region`/`--krss`/`--company-category` (`extract.py:344-361`). So `relevant` is all-False before the `|` at line 603, and the run emits exactly one payload. Measured: the run log reads `Found 0 people with relevant employment / Found 1 people`, and one JSON line comes out. The 781 press-list people (`extract.py:20-51`, `listawstydupo` 427 + `tlustekotypisu` 357) only ride along under `--approved`, which `submit_people.sh` never passes.

**`--only-changed` also already exists**, on the `ingest-skip-unchanged` branch (rebased onto main and pushed, not merged), together with `--on-koryta`/`--koryta-date`, the `SiteSnapshot` transcription of the ingest in `analysis/payloads/site.py`, and `revisionChangesNothing` at `frontend/server/utils/revisions.ts:298`. **This design does not use `--only-changed`** — see §6 for why, including for the scheduled extension.

**The branch is nevertheless a hard prerequisite**, for a different reason: it moved person identity from exact name to `rejestrIo`. `lookupPersonDoc` (`frontend/server/api/ingest/person.post.ts:615`) now tries `where("rejestrIo","==",body.rejestrIo).where("type","==","person")` first, and falls back to name only onto a page carrying no rejestrIo. Without that, every run in this workflow matches by name and re-manufactures the duplicate pages `frontend/scripts/migrate/merge-duplicate-people.ts` just cleaned up for 170 people.

**Headless auth already has a working recipe in-repo.** `service/koryta_api.py:72-95` mints `auth.create_custom_token(uid, {"datascience": True})` and exchanges it at identitytoolkit `v1/accounts:signInWithCustomToken`. It needs `roles/iam.serviceAccountTokenCreator` on the job's own SA (`koryta_api.py:10-12`) and the public web API key (`service/config.py:35-37`). `firebase_admin` is already a base dependency of `pipelines` (`pyproject.toml:29`), and `stores` is outside the import-linter's forbidden-external-packages contract (`pyproject.toml:268` lists only `scrapers`, `util`, `entities`), so this lands with no pyproject churn.

**The transactional-claim pattern exists**, at `frontend/functions/src/feedback.ts:88-115`, with its reason written down at `feedback.ts:63-64`. The rate-limit pattern exists at `frontend/server/api/feedback/create.post.ts:45-63`. The bucket plumbing exists at `frontend/server/utils/crawledBucket.ts:7,13`. The systemd user-timer pattern exists on predator as koryta-morning. `report_collapsed_people` (`analysis/payloads/person.py:398`) already names every collapsed row at the end of every run. `needs_split` and `/api/nodes/split` already ship on the branch.

**What genuinely does not exist:** any table keyed by rejestr.io id, any request surface, and any way for `koryta_uploader` to get a token without a browser.

Two things that are _not_ wiring and that no earlier note caught:

**A successful import produces a draft, not a page.** `map_person_payload` sets `autoapprove = count > 0`, where `count` comes from `_hardcoded_sources_content_parties`, which is `auto_approved(row)` — the two press lists, 781 people. For anyone outside those lists, `autoapprove` is false, `person.post.ts:82-83` writes `published: ctx.autoapprove`, and `frontend/server/api/nodes/[id].get.ts:42` then throws `404 "Page {id} is not approved"`. So for ~99.3 % of imports, the link at the end of the happy path 404s. The honest terminal state is _draft created, awaiting review_, and this design says so in Polish.

**And the draft is prose-empty.** Because `count == 0` for the same people, `sources` and `content` are empty too. The created node is an edge-only stub of KRS employment and PKW candidacies. The pre-check says this before the user commits.

## 3. The request lifecycle

Paste to page, with the component doing each step.

1. **Paste.** `frontend/app/pages/dodaj-osobe.vue` — one input. The user pastes `https://rejestr.io/osoby/1242560`, or the slug form, or `http://`, or a bare id. `POST /api/person-requests` with `{url}` and no `confirm`.

2. **Parse and canonicalise.** `frontend/server/utils/rejestrioLookup.ts` extracts the digits and returns the canonical `https://rejestr.io/osoby/1242560` — the exact string `lookupNodeDoc` compares with raw equality at `person.post.ts:578-588`. No match: 422, nothing stored, _"To nie jest adres osoby w rejestr.io."_

3. **One object read.** The same util reads `rejestrio_lookup/current.json` (module-cached 5 minutes) for the current vintage, then GETs `rejestrio_lookup/<vintage>/<id % 256>.json.gz` — 7.3 kB — through `getStorage(getApp()).bucket(CRAWLED_BUCKET)`. Zero Firestore reads, zero rejestr.io calls. Measured shard sizes: 256 shards, 7,175 B average gzipped, 8,144 B max.

4. **Classify.** `index.post.ts` turns the row into one of the states in §5 and returns it _without writing anything_. The card leads with the name the run would actually publish — `coalesce(full_name[1], krs_name, base_full_name[1])`, mirroring `map_person_payload` (`person.py:160-172`) — so a mis-paste is caught here, for free. It also says what the page will contain: _"Powstanie szkic złożony wyłącznie z powiązań KRS i kandydatur PKW — bez opisu i bez źródeł."_

5. **Confirm.** For a producible id, one button. For a collapsed id, the card names the other person and offers three choices (§5). For a possible name match against an existing page with no rejestrIo, the card asks whether it is the same person. The client sends `POST /api/person-requests` again with `{url, confirm: {...}, seenVintage}`.

6. **Create.** The same endpoint re-runs steps 2-4 server-side — the client's verdict is never trusted, and making check and create one endpoint is what makes that structural rather than a rule someone has to remember. It applies the transactional daily cap in `personRequestLimits/{YYYY-MM-DD}`, then writes `personRequests/{winningId}_{uid}` with the admin SDK. The response carries the request id and `lastTickAt`, so the page can say _"W kolejce. Ostatnie uruchomienie kolejki: 12:40."_

7. **Watch.** The page subscribes to its own request document with vuefire. That single `allow get` rule is the entire live-status mechanism: no polling endpoint, no notifier.

8. **Tick.** `koryta-requests.timer` fires on predator every 20 minutes (`Persistent=true`, so a missed tick catches up). `~/.local/bin/koryta-requests.sh` takes a flock, checks `MemAvailable`, and runs `koryta_requests`.

9. **Republish the index if the corpus moved.** `koryta_requests --publish-index` compares `versioned/people_enriched/people_enriched.jsonl`'s size and mtime against the published vintage; on a change it rebuilds `RejestrioLookup` (2.09 s, 524 MB measured) and uploads 256 shards plus `current.json`.

10. **Claim.** `koryta_requests` mints a datascience token via `stores.auth.get_token` and POSTs `/api/person-requests/drain {action:"claim", limit:5}`. The endpoint runs the `onFeedbackCreated` transaction verbatim: bail on a terminal state, bail past `MAX_ATTEMPTS = 5`, otherwise `tx.update` to `claimed` with `attempts + 1`. The query is `where("status","==","requested").limit(5)` with no `orderBy`, so it rides an automatic single-field index and needs no manual composite deploy.

11. **Re-classify locally.** Against predator's own `versioned/rejestrio_lookup`, not against the shard the user saw. Two `PeopleEnriched` runs over identical inputs moved 9 of 112,196 ids between outcome classes, so a pre-check answer is only binding against the file it was computed from — and here the index and the run read the same file by construction. A disagreement is `stale_precheck`, requeued without burning an attempt.

12. **Run.** Two subprocesses, artifacts kept:

```
koryta PeoplePayloads --rejestrio-id 1242560 --refresh :PeopleEnriched --no-backup \
  --output stderr 2>"$w/payloads.jsonl" 1>"$w/run.log"

koryta_uploader --type person --submit --endpoint https://koryta.pl \
  --report-jsonl "$w/report.jsonl" --max-company-repair 5 <"$w/payloads.jsonl"
```

Measured on a half-populated `versioned/` — the state that otherwise cascades a full `ProcessWiki → PeopleWikiMerged → PeopleMerged → PeopleEnriched` rebuild: **6.16 s wall, 3.29 GB maxRSS, one payload, the right person.**

13. **Assert.** The drain checks that exactly one payload came out and that `payload["rejestrIo"] == canonical(requested)`. A mismatch is `wrong_winning_id` and nothing is uploaded — this is the design checking its own promise rather than trusting a stamped index.

14. **Upload.** `/api/ingest/person` with the datascience token (`person.post.ts:38` → `requireDatascience`, `frontend/server/utils/auth.ts:19-28`). A 404 naming unknown KRS triggers the existing repair at `uploader.py:352-357`, now capped.

15. **Complete.** `POST /api/person-requests/drain {action:"complete", ...}` with the parsed `report.jsonl` — never the uploader's stderr counters, which are double-wrapped by `check_success` in both `submit_entity` and `submit_results` and report a repaired 404 as a failure. The server records `nodeId`, `person: created|updated|unchanged`, `companiesCreated[]`, `unplacedElections`, and the terminal status.

16. **Heartbeat.** The drain posts `{action:"tick", ...}` and the endpoint overwrites `drainRuns/heartbeat` and, on a non-empty tick, writes `drainRuns/{isoTick}`. This is what makes a stalled predator visible instead of silent.

17. **Follow the draft.** On later ticks the drain re-reads the node for every request in `done_awaiting_review` and flips it to `published` (with the working link) once `published === true`. The request does not go terminal at draft creation — the requester finds out what actually happened.

## 4. Components

### 4.1 `data/pipelines/src/analysis/rejestrio_lookup.py` — new

`RejestrioLookup(Pipeline)`, `filename = "rejestrio_lookup"`, dependencies `PeopleEnriched`, `PersonKRS`, and the latest `person_koryta_<date>` export. One duckdb query producing one row per rejestr.io id:

```
status  P producible | C collapsed onto another id | N no birth date | K dropped elsewhere
name    coalesce(full_name[1], krs_name, base_full_name[1])   -- what the run will publish
filed_as        the winning id, when the row carries more than one
n_emp, n_elec_post1999
node_id, pages, canonical                                     -- joined from the site export
```

Measured over the real artifacts: build 2.09 s / 524 MB / 1,865,246 B out; classes **producible 107,694, collapsed 833, no-birth-date 3,654, krs-only 15**.

Three things are load-bearing and easy to get wrong:

- **`name` is not `krs_name`.** `krs_name` gives "Antoni Ignacy Sikoń" where the run publishes "Antoni Sikoń". The coalesce above reproduced both measured payload names exactly.
- **The winner is computed numerically, membership is compared as strings.** `one_register_entry` (`person.py:391`) sorts with `int(v) if v.isdigit()` and takes `[0]`, so `filed_as` is `list_min(list_transform(rejestrio_id, x -> CAST(x AS BIGINT)))`. But `check_rejestrio_id` (`extract.py:600-601`) is `self.rejestrio_id in set(map(str, as_sequence(ids_list)))` — a _string_ test. The index therefore keys on the string form. The build asserts every id matches `^[0-9]+$` (measured: 0 exceptions over 112,196) and fails loudly if a vintage ever writes ints or floats. `PeopleEnriched` pins no dtype, and `krs_ids()`'s docstring (`extract.py:98-111`) exists because a differently-typed frame once silently produced wrong answers.
- **It reads the dependencies' `output_path()` with duckdb, not `read_or_process`.** `pd.read_json` of `people_enriched.jsonl` costs 3.9 s and 3.17 GB for a frame that is 0.19 GB in memory. That deviation from the usual pipeline idiom gets a comment in the source, because a reader will expect the normal call.

It also emits a second, tiny artifact: **`unlinked_names`**, keyed on `casefold(first_token) + " " + casefold(last_token)` → the node ids of the 894 exported pages that carry no `rejestrIo` at all. This is §5's `possible-same-person` state, and it is the only defence against the case nobody had noticed: of those 894, 512 have a name exactly equal to a corpus payload name (the ingest's name fallback adopts them silently, so "new page" was a false promise), and roughly 314 more differ only by a middle name — "Tadeusz Jan Zieliński" against a payload "Tadeusz Zieliński". For those, the exact-name fallback fails and the run creates a _second_ page for someone we already have.

### 4.2 `publish_shards()`, same file — new

Writes 256 gzipped JSON objects keyed `rid % 256` to `gs://koryta-pl-crawled/rejestrio_lookup/<vintage>/<n>.json.gz`, plus `unlinked_names.json.gz` (894 entries, an estimated 15-25 kB gzipped — not measured) and `rejestrio_lookup/current.json`:

```json
{
  "vintage": "2026-08-30T11:56:16Z-339914677",
  "sha256": "…",
  "bytes": 339914677,
  "rows": 112196,
  "shards": 256,
  "korytaExportDate": "2026-08-29",
  "counts": { "P": 107694, "C": 833, "N": 3654, "K": 15 }
}
```

The **vintage is a content hash** of the exact `people_enriched.jsonl` that was read (sha256 of 340 MB, estimated 1-2 s, not measured), with bytes and mtime kept for a cheap early exit. A hash rather than a size+mtime stamp because it identifies the file regardless of whether it was computed locally or restored from the shared cache — the one difference that matters if the drain ever moves off predator, and the one place where the round-trip has coerced column types before.

`koryta-pl-crawled` rather than `koryta-pl-sharedcache` for one reason: `crawledBucket.ts:13` means the Nuxt server already holds a credential for it, and the only attempt in the notes to even `describe` the sharedcache bucket returned PERMISSION_DENIED. The prefix sits outside `hostname=`, so `KorytaExport`'s 142,365-object listing (`scrapers/koryta/download.py:187-200`) is untouched. It is a namespace squat on the crawl mirror, paid for by not adding an IAM grant and a region question to slice one.

### 4.3 `data/pipelines/src/pipelines.py` — change

Import and register `RejestrioLookup` in `PIPELINES`.

### 4.4 `frontend/server/utils/rejestrioLookup.ts` — new

```ts
parseRejestrioId(input: string): { id: string; canonical: string } | null
loadManifest(): Promise<Manifest>          // current.json, module-cached 5 min
lookup(id: string): Promise<Row | null>    // one shard, LRU of 16 (~120 kB)
unlinkedNameCandidates(name: string): Promise<string[]>
```

`parseRejestrioId` accepts `https://rejestr.io/osoby/1242560`, the slug tail, `http://`, `www.`, a query string or fragment, and a bare id. The whole index is never resident: a full in-memory `Map` costs 239 ms to load and 61 MB heap / 120 MB RSS, on a backend with a documented nitro full-collection-cache OOM in its history. A cold shard read is one class-B GCS operation.

### 4.5 `frontend/server/api/person-requests/index.post.ts` — new

`getUser`-gated. Body `{ url, confirm?, seenVintage? }`. Without `confirm` it classifies and returns; with `confirm` it re-classifies server-side, applies the cap, and writes. Writes go through the admin SDK, which is what lets the pre-check _gate_ the queue — the collection only ever holds work that is known to be doable.

The daily cap is `slackForwardAllowed`'s shape (`feedback/create.post.ts:45-63`): a transactional counter in `personRequestLimits/{YYYY-MM-DD}`, and on breach the document is still written with `hold: "daily_cap"` rather than the user being turned away. No honeypot — creation requires auth.

### 4.6 `frontend/server/api/person-requests/index.get.ts` — new

Returns the caller's own requests; for `requireDatascience` callers, all of them plus `drainRuns/heartbeat`. It exists because the rules deny `list`, so there is no client-side way for a requester to find their request again.

### 4.7 `frontend/server/api/person-requests/drain.post.ts` — new

`requireDatascience`. Three actions.

`claim` — the `onFeedbackCreated` transaction (`feedback.ts:88-115`), `MAX_ATTEMPTS = 5`, over `where("status","==","requested").limit(5)`.

`complete` — records the report line. It resolves the node itself with `where("rejestrIo","==",canonical).limit(2)`; two hits mean a duplicate page exists and the request goes to `failed:duplicate-page`, which is the signal that `/api/nodes/merge` is owed.

`tick` — overwrites `drainRuns/heartbeat` and, when the tick did work, writes `drainRuns/{isoTick}` with the ids, durations, per-status counts and `companiesCreated[]`. This ledger is the cheapest thing in the design and the only artifact that will still be legible in six months.

Both queries are single-field. Nothing here needs `firestore.indexes.json`.

### 4.8 `frontend/server/api/person-requests/adopt.post.ts` — new

`requireDatascience`. Writes `rejestrIo` onto a chosen existing node and returns the request to `requested`. This resolves `possible-same-person`: the ingest adopts a page by exact name already, but the ~314 middle-name cases need a human to say two names are one person, and doing so silently rewires which page every future run updates. Admin-only for that reason.

### 4.9 `firestore.rules` — change

```
// A person somebody asked us to import, named by their rejestr.io id.
// Everything here is written by the server with the admin SDK: the pre-check
// has to run server-side anyway, because a client-supplied verdict would be
// deciding whether we spend a pipeline run. Once creation is a server call
// there is nothing left for a client rule to authorise, and what remains is
// the one read that makes the request page live - your own document, never
// the collection, which would hand any signed-in account every requester's uid.
match /personRequests/{requestId} {
  allow get: if request.auth != null
      && resource.data.requestedBy == request.auth.uid;
  allow list: if false;
  allow create, update, delete: if false;
}

// Per-user daily counters and the drain's ledger. Server-side only, for the
// reason feedbackLimits gives: a client that could read these would learn how
// close the cap is, and one that could write them would lift it.
match /personRequestLimits/{key} { allow read, write: if false; }
match /drainRuns/{runId}        { allow read, write: if false; }
```

One `get` predicate is the entire client-facing rules surface, which matters because `@firebase/rules-unit-testing` is not installed anywhere in the repo and there is no rules test suite to exercise anything more elaborate.

### 4.10 `frontend/app/pages/dodaj-osobe.vue` — new

Paste box, debounced verdict card, one action per state, then the vuefire subscription. Entry points: the OmniSearch empty state and `/eksploruj`. All copy is in §5, and it is written to avoid grammatical agreement with a person whose gender we do not know — "tej osoby nie ma w naszym zrzucie", never "nie ma jej"; "wpis jest scalony z wpisem: Jacek Sokołowski", never "scalona z Jacek Sokołowski".

### 4.11 `frontend/shared/qa.ts` — change

One QA changelog entry, in the same commit as the frontend change, per repo convention.

### 4.12 `frontend/scripts/migrate/canonicalize-rejestrio.ts` — new

One-off, `--prod` dry-run first, mirroring `merge-duplicate-people.ts`. Rewrites the 10 nodes whose stored `rejestrIo` carries a name slug or `http://` — `4LBhOZImAHBd1m9U1tLM` … `zd2AjKHUN3wPvc548sFN`, listed in full in the verification notes — to `https://rejestr.io/osoby/{id}`. This must ship **with** slice one, not after it: `lookupNodeDoc` (`person.post.ts:578-588`) is raw string equality with no normalisation anywhere in the file, and `person.post.ts:634` refuses the name fallback when `storedRegister !== body.rejestrIo`. So a run for one of those ten creates a duplicate page today, and a pre-check that advertises the workflow without the migration is advertising a page-duplicator.

### 4.13 `frontend/server/api/ingest/company.post.ts` — change (one line, conditional)

`const user = requireDatascience(await getUser(event));`

Today it is `getUser` only (`company.post.ts:37`) and publishes brand-new companies outright (`company.post.ts:388-389`), which contradicts `frontend/server/utils/auth.ts:5-13`'s own stated policy that every other write path proposes a revision. The drain's token already satisfies `requireDatascience`, so this costs the workflow nothing. **Verify the caller set first** — a 403 here surfaces inside the uploader's 404-repair, which is exactly the path whose counters we already say cannot be trusted. If anything other than the uploader posts there, ship the cap in §4.16 alone and leave this alone.

### 4.14 `data/pipelines/src/stores/auth.py` — change

Add `get_token(endpoint_url)`: `KORYTA_ID_TOKEN` if set, else `service_account_token()` when `KORYTA_AUTH=service-account`, else the existing `authenticate_user` browser login unchanged — so nothing about running `submit_people.sh` on a laptop changes. `service_account_token()` is `koryta_api.py:72-95` lifted down a layer: `auth.create_custom_token(uid, {"datascience": True})` then the identitytoolkit exchange with `FIREBASE_WEB_API_KEY` (public by design, `config.py:35-37` — a plain env var, not a secret). `identity_toolkit_url` moves here and is re-exported from `service/koryta_api.py` so `service/test_koryta_api.py:5` keeps compiling; `service` already imports `stores.llm`, so that direction is established.

The switch was compiled and smoke-tested against all four branches (env token, browser default, missing-key error, emulator/production URL split) during verification.

### 4.15 `data/pipelines/src/service/koryta_api.py` — change

Delete the local `identity_toolkit_url` and re-export it from `stores.auth`.

### 4.16 `data/pipelines/src/uploader.py` — change

Five edits, all small:

- `authenticate_user(args.endpoint)` → `get_token(args.endpoint)` at both call sites (`uploader.py:105`, `:108`). The `--type score` path is unaffected: `util/firestore.py:275` reads `KORYTA_ID_TOKEN` itself before calling `login`, and short-circuits localhost to the Admin SDK at line 271.
- **`--report-jsonl PATH`**: one line per payload — `{rejestrIo, name, status, personId, person, missingKrs, error}` — written from the response body, which already carries `personId` and `person: created|updated|unchanged`. `submit_entity` (`uploader.py:342-359`) already returns the `requests.Response`, so this is cheap. It is the only clean way past the counters.
- **`--max-company-repair N`** (drain passes 5 interactively, **0** in batch): above N, stop POSTing to `/api/ingest/company` and return a marker. The repair loop is unbounded today and the measured blast radius per person is median 1, p90 2, p99 7, **max 73** distinct KRS. It also lazily runs the whole `Companies` pipeline (`uploader.py:234-248`), which the same cap bounds.
- Fix the double `check_success` wrap so `Success: N, Failed: M` stops being 2× inflated.
- Delete `--prod` (`uploader.py:70`), which is declared and read nowhere. `submit_people.sh`'s `$2 == prod` branch keeps `--endpoint` and loses the flag.

### 4.17 `data/pipelines/src/analysis/extract.py` — change

`--rejestrio-id` becomes `action="append", default=[]`, with an `@/path/to/ids.txt` form, and `check_rejestrio_id` becomes a set intersection. Nothing in the single-person path needs this; it is what lets one corpus read serve a whole batch in §6, where 200 ids on a command line is fine and 6,000 is not.

### 4.18 `data/pipelines/src/request_drain.py` — new, console script `koryta_requests`

```python
for req in claim(limit=5):
    row = index.lookup(req["rejestrioId"])
    if row is None or row.status != "P" or index.vintage != file_vintage():
        complete(req, "stale_precheck", seen=req["precheck"], now=row)   # no attempt burnt
        continue
    run(["koryta", "PeoplePayloads", "--rejestrio-id", req["rejestrioId"],
         "--refresh", ":PeopleEnriched", "--no-backup", "--output", "stderr"],
        stderr=payloads, stdout=runlog)
    payload = one_payload_or_fail(payloads)          # 0 -> no_payload (alarmed)
    if payload["rejestrIo"] != canonical(req["rejestrioId"]):
        complete(req, "wrong_winning_id", got=payload["rejestrIo"]); continue
    run(["koryta_uploader", "--type", "person", "--submit", "--endpoint", ENDPOINT,
         "--report-jsonl", report, "--max-company-repair", "5"], stdin=payloads)
    complete(req, **read_report(report))
```

Modes: `--drain` (the above), `--publish-index`, `--follow-drafts` (re-read nodes for `done_awaiting_review` requests and flip them to `published`), `--refresh-stale N` (§6), and `--self-test`.

`--self-test` asserts that id `1242560` classifies producible, that a run against it emits exactly one payload, and that the payload's name is `Antoni Sikoń` and its `rejestrIo` is `https://rejestr.io/osoby/1242560`. It is wired into the existing morning check, and it is the cheapest available answer to "does this rot if nobody touches it for two months".

`run.log` is kept per request and its tail stored on the document on failure — it contains `report_collapsed_people`'s output (`person.py:398`), which names every collapsed row the run saw.

### 4.19 `data/pipelines/pyproject.toml` — change

`koryta_requests = "request_drain:main"` in `[project.scripts]`.

### 4.20 predator: `~/.local/bin/koryta-requests.sh` + systemd user units — new, outside the repo

koryta-morning's shape: linger already on, `OnCalendar=*-*-* *:0/20:00` with an explicit `Europe/Warsaw` (the box is UTC), `Persistent=true`, PATH resolved the koryta-morning way, `timeout` around each step, exit codes as the report (0 / 10 no-op / 20 partial / 30 failed).

Two guards that koryta-morning does not need and this does. The run is 3.29 GB on a 16 GB box that also runs the e2e suite under `DEVNS_SLOTS=1` and has a documented seven-day swap pin: the script **takes the same flock `devlock` takes** (read the path out of `~/.claude/bin/devlock` rather than guessing it) and **skips the tick when `MemAvailable` is under 5 GB**, logging a skip rather than firing into a Playwright run.

And the notifier is **turned on**, not left commented out the way koryta-morning's is. Without it, a drain exiting 30 every twenty minutes for a week produces nothing but journald lines nobody reads.

### 4.21 GCP — two one-off changes

- `roles/iam.serviceAccountTokenCreator` on `dev-workflow@koryta-pl.iam.gserviceaccount.com`, **member = itself**. This is the only new IAM in the design.
- A lifecycle rule on `gs://koryta-pl-crawled` deleting objects under `rejestrio_lookup/` older than 14 days. The dev-workflow SA can create objects there and can never remove them, so without this every rebuild leaves 1.87 MB that nobody on this box can delete — trivial on day one and impossible to care about on day 400.

`FIREBASE_WEB_API_KEY` goes in predator's env as a plain value; it is in `nuxt.config.ts` already.

## 5. The states a request can reach

Counts are from the 2026-08-30 vintage. The older notes quote 3,557 and 832 for the third and fourth rows — the same populations at an older build.

| state                             | count                      | terminal             | what the user is told                                                                                                                                                                                |
| --------------------------------- | -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-a-url`                       | —                          | yes, unstored        | _"To nie jest adres osoby w rejestr.io."_                                                                                                                                                            |
| `not-in-corpus`                   | ~97 % of the id space      | no — a standing wish | _"Nie mamy danych o tej osobie. To nie znaczy, że taka osoba nie istnieje — znaczy, że nie ma jej w naszym zrzucie KRS i PKW. Zapisaliśmy zgłoszenie i sprawdzimy je po każdej przebudowie danych."_ |
| `held-not-producible`             | 3,654 (3,557 older)        | yes                  | _"Mamy wpisy KRS dla tej osoby, ale bez daty urodzenia nie potrafimy ich połączyć w jedną osobę. Tego zgłoszenia nie da się zrealizować."_                                                           |
| `held-krs-only`                   | 15                         | yes, flagged         | _"Mamy wpisy KRS, ale ta osoba wypada z naszych danych z nieznanego nam powodu. Zgłosiliśmy to do sprawdzenia."_                                                                                     |
| `collapsed-onto-another`          | 833 (832 older)            | needs a choice       | _"W naszych danych ten wpis jest scalony z wpisem: Jacek Sokołowski (rejestr.io/osoby/853648). To znany błąd scalenia po naszej stronie."_                                                           |
| `nothing-to-publish`              | —                          | yes                  | _"Znamy tę osobę, ale nie mamy nic, co moglibyśmy opublikować: żadnych powiązań KRS ani kandydatur po 1999 roku."_                                                                                   |
| `already-on-site`                 | 6,262 of 6,368 on-site ids | link, or refresh     | _"Ta osoba ma już stronę: …. Możesz poprosić o odświeżenie danych."_                                                                                                                                 |
| `already-on-site-duplicated`      | 56 ids                     | yes, flagged         | _"Ta osoba ma u nas dwie strony. To błąd po naszej stronie — trzeba je scalić, zanim cokolwiek dopiszemy."_                                                                                          |
| `possible-same-person`            | 894 unlinked pages         | needs a choice       | _"Mamy już stronę „Tadeusz Jan Zieliński" bez wpisu rejestr.io. Czy to ta sama osoba?"_                                                                                                              |
| `held:daily_cap`                  | —                          | no                   | _"Przyjęliśmy dziś już maksymalną liczbę zgłoszeń od Ciebie. To zgłoszenie poczeka do jutra."_                                                                                                       |
| `requested`                       | —                          | no                   | _"W kolejce. Ostatnie uruchomienie kolejki: 12:40."_                                                                                                                                                 |
| `claimed`                         | —                          | no                   | _"Przetwarzamy."_                                                                                                                                                                                    |
| `stale_precheck`                  | —                          | no, self-healing     | _"Nasze dane zmieniły się od Twojego zgłoszenia. Sprawdzamy je ponownie."_                                                                                                                           |
| `no_payload`                      | —                          | yes, alarmed         | _"Spodziewaliśmy się danych o tej osobie, a uruchomienie nic nie zwróciło. Zajmiemy się tym ręcznie."_                                                                                               |
| `wrong_winning_id`                | —                          | yes, alarmed         | _"Uruchomienie wyprodukowało stronę innej osoby, niż zapowiadaliśmy. Wstrzymaliśmy zgłoszenie."_                                                                                                     |
| `blocked_missing_company`         | —                          | yes, human           | _"Ta osoba jest powiązana ze spółkami, których nie mamy. Nie tworzymy ich automatycznie — ktoś musi na to spojrzeć."_                                                                                |
| `done_awaiting_review`            | the normal outcome         | no                   | _"Utworzyliśmy szkic strony. Będzie widoczna publicznie po zatwierdzeniu. Szkic zawiera wyłącznie powiązania z KRS i kandydatury PKW — bez opisu i bez źródeł."_                                     |
| `done_unchanged`                  | —                          | yes                  | _"Mieliśmy już wszystkie te dane — nic się nie zmieniło."_                                                                                                                                           |
| `published`                       | —                          | yes                  | _"Gotowe: /osoba/…"_                                                                                                                                                                                 |
| `failed:duplicate-page`           | —                          | yes, flagged         | _"Powstały dwie strony dla tej samej osoby. Trzeba je scalić."_                                                                                                                                      |
| `failed:run` / `failed:exhausted` | —                          | yes                  | _"Coś poszło nie tak. Zapisaliśmy szczegóły; zajmiemy się tym ręcznie."_                                                                                                                             |

Four of these deserve their reasoning spelled out.

**`not-in-corpus` is the honest limit, and it is stored rather than discarded.** The corpus holds 112,196 ids against a maximum id of 3,710,838 — 3.0 % of the space. Separating "we never crawled them" from "that id is not a person" costs $0.10 per question (`scrapers/krs/scrape.py:59-62`: `len(calls) * 0.05`, and the only person endpoints are the two paid `krs-powiazania` ones at `scrape.py:82-87`), and the free web page is Cloudflare-403 for real and bogus ids alike — verified against `1242560`, `2822709` and `999999999`, with `example.com` returning 200 as a control. Paying would not even make the person producible; they would have to be crawled and the whole merge chain rebuilt. So we answer the question we can answer, say so plainly, and keep the request as a standing wish — which doubles as the crawl-priority signal that makes paying rational later, if the same person is asked for repeatedly.

Note also that 3.0 % is the _id-space density_, not the expected refusal rate. Pastes will be news-driven, i.e. KRS board members, i.e. the population the corpus is densest in. The one realistic proxy measured — the 6,368 distinct ids already on live pages — is **98.3 % producible**.

**`held-not-producible` is a hard no, not a "probably".** `people_krs_merged.py:38` is `WHERE birth_date IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL`, and it kills all 3,654 deterministically. They are mostly foreign nationals — Vaclav Zyder, Jiři Šmondrk, Günter Kikillis. Hedging invites the user to keep trying at something that cannot change without a corpus-wide decision this workflow has no business making.

**`collapsed-onto-another` offers three choices, and publishing under the winner is not the default.** The 833 are a known upstream defect: `create_people_table` merged two humans on ±1-year birth-year smoothing, and `one_register_entry` (`person.py:361,391`) then picks the numerically smallest id. Verified end-to-end: `--rejestrio-id 1362573` emits one payload whose `rejestrIo` is `.../853648` and whose name is "Jacek Sokołowski". The three options are (a) **report the split** — write `needs_split` on the winning node, which the branch already ships along with `/api/nodes/split`, and publish nothing; (b) publish under the winner anyway, having read whose page it will be; (c) abandon. (a) is the default the card recommends. Calling the wrong person's page a correct outcome would be laundering a data defect on a site whose whole promise is that a page reflects the register.

**`done_awaiting_review` is the normal end of a successful import, and it is not a link to a page.** See §2.

## 6. The scheduled-update extension

"Refresh people on a regular basis" is the same drain with a different source of ids, and it is the reason the index carries `node_id` at all. `koryta_requests --refresh-stale 200` reads the local `rejestrio_lookup`, takes the ids where `node_id` is set and `status = P` — **6,262 of them, 98.3 % of pages carrying a register entry** — walks them round-robin from a cursor in a single Firestore doc, and feeds the batch through the same two subprocesses. The nightly unit is the same script with a second `OnCalendar` and a different argument. Auth, claim/complete, index, and the pinning flag are all unchanged.

Four things have to change or be decided first.

**Blocker 9: `--on-koryta` is still name-based and must not be used.** `matching_one_page` (`analysis/payloads/person.py:274-307`) matches on exact `full_name`, and `only_on_koryta` (`person.py:146`) reads `submitted_df["full_name"]` — on the very branch that moved ingest identity to `rejestrIo`. This design does not fix that flag; it routes around it. The refresh set comes from the index's `node_id` column, which is keyed on `rejestrIo`, the same identity the ingest now uses. If `--on-koryta` is ever wanted for its own sake, the export already carries `rejestrIo` (6,424 of 7,330 pages) and re-keying it there is the fix.

**`--rejestrio-id` must take a list.** §4.17. One 340 MB read serving 200 people instead of 200 separate 6-second reads.

**The uploader mints its token once and never refreshes it** (`uploader.py:109-112`; `KorytaClient` has `_CachedToken` with a 300 s margin at `koryta_api.py:29-31` precisely because it is long-lived). A batch therefore has to finish inside ~55 minutes, or the drain must re-mint per sub-batch. Sizing the batch is the cheaper fix and it also bounds the nightly spend. 200 a night is a full pass over the on-site population roughly every month.

**`--max-company-repair 0` in batch mode.** 6,262 people at p99 7 distinct KRS is a great many auto-published companies. Unattended, missing KRS go into a report and nobody's company gets created at 03:00.

**`--only-changed` is probably unnecessary here too**, which is worth stating because the earlier notes assumed the opposite. `revisionChangesNothing` (`revisions.ts:298`) already makes a re-ingest of an unchanged person a server-side no-op, and the response distinguishes `created`/`updated`/`unchanged` — so `done_unchanged` is the expected outcome for most of a refresh pass and it costs one HTTP request, not a write. Turning `--only-changed` on to avoid those requests would buy a `SiteSnapshot` build that costs **two 43.6 s listings of a 142,365-object prefix plus 483 serial blob GETs (63.0 MB)** unless a primer job pre-builds `koryta_nodes_<date>`/`koryta_edges_<date>` into the shared cache, where neither artifact exists today. Measure the no-op request rate first; the primer is only worth building if the HTTP volume actually hurts. If it is ever turned on, note that `SiteSnapshot` has no year filter (`election_year` appears at `site.py:666` and `:688` only) while `submit_payload` strips every election with `election_year <= 1999` — so a payload kept solely for a pre-2000 candidacy is sent with nothing left to write and reported OK. The same cut has to go into `SiteSnapshot.changes`.

## 7. What has to happen first

Ordered. Manual deploys are marked **[manual]** — nothing in CI does any of them, so merged is not live.

1. **Land `ingest-skip-unchanged`.** Identity-by-`rejestrIo` (`person.post.ts:615`) is the foundation the index's `node_id` join and the whole no-duplicate-pages story rest on. It is rebased onto main, pushed, and verified green (`npx vitest run tests/server`, `npm run typecheck`, `.venv/bin/pytest` 158 passed, prettier clean).
2. **Check whether the two composite indexes in `firestore.indexes.json:746-773` are actually required.** `lookupPersonDoc` issues an equality-only conjunction with `limit(1)` and no ordering (`person.post.ts:583-587`), which Firestore serves by merging single-field indexes — so `nodes(rejestrIo, type)` is very likely a performance nicety, not a gate. Confirm against the live database, then **[manual]** deploy them if it is a gate, and delete the claim from the risk register if it is not.
3. **Run `canonicalize-rejestrio.ts --prod`** as a dry run, then for real, against the 10 malformed nodes. Nothing else may point at production before this.
4. **`gcloud storage buckets describe gs://koryta-pl-crawled`.** Every cost claim in §8 assumes it is in europe-central2 with the Cloud Run backend. If it is US or multi-region, every paste pays cross-region egress. This has never been established; the one attempt at the sibling bucket returned PERMISSION_DENIED.
5. **Grant `roles/iam.serviceAccountTokenCreator` on `dev-workflow@koryta-pl` to itself**, and put `FIREBASE_WEB_API_KEY` in predator's env.
6. **Ship `stores/auth.get_token` + the `uploader.py` edits** and prove them from predator with `KORYTA_AUTH=service-account` and a single hand-run import — before any timer exists.
7. **Ship `RejestrioLookup` + `publish_shards`**, build one vintage on predator, and add the bucket lifecycle rule in the same sitting.
8. **Ship `rejestrioLookup.ts` + `POST /api/person-requests` in check-only mode** plus `dodaj-osobe.vue`. **[manual]** deploy `firestore.rules` when the collection lands (step 9); until then nothing is written and no rules change is needed.
9. **Ship the collection**: rules **[manual]**, `index.get.ts`, `drain.post.ts`, `adopt.post.ts`, and the create half of `index.post.ts`.
10. **Ship `request_drain.py`**, run it by hand with `--dry-run`, then with `--limit 1`, then install the systemd units and wire `--self-test` into the morning check.
11. **Decide on `requireDatascience` for `/api/ingest/company`** after checking its caller set (§4.13).

Explicitly **not** required, in contrast to earlier drafts: no `collectionIds` entry in `frontend/functions/src/index.ts:150-160` and therefore **no Cloud Functions deploy** — no pipeline reads `personRequests`, the drain reads it over HTTP, and every collection added there costs one billed document read per document per night (the export was already a third of the database's daily cost at 94,103 documents, `index.ts:113-124`). No composite index. No Cloud Run job, Artifact Registry repo, Cloud Tasks queue, Cloud Scheduler entry or new service account.

## 8. Risks and what we accept

**Availability depends on predator.** If the box is asleep, wifi-dead or swap-thrashed, requests queue instead of running. This is a latency failure and never a correctness or a loss one: the request is in Firestore, the claim is idempotent, and the answer the user actually waits for was already given synchronously by Cloud Run from the bucket. The mitigations are the heartbeat (`drainRuns/heartbeat`, surfaced in the create response and the admin list) and the notifier being on. The escape hatch is real but deliberately undesigned: `data/pipelines/Dockerfile` plus `request_drain.py` run unchanged as a Cloud Run Job in europe-central2 — but on an **empty** `versioned/`, which is the branch that restores from the shared cache and returns (`stores/__init__.py:800-822`), so `DISABLE_BACKUP` must **not** be set (it would make `_shared_cache_active` false at `stores/__init__.py:890,910-914` and fall through to a full corpus rebuild), `USERNAME=romb` must be pinned, and the floor is 4 GiB without a duckdb fast path or 2 GiB with one. The measured unmodified restore path peaks at 3.71 GB.

**Twenty minutes of latency, and up to a day when the box is busy.** A Cloud Task would make it seconds, at the cost of a queue, a service, an OIDC audience and the retry semantics that make `articlePages` re-run its whole job on redelivery (`app.py:156`: _"500 so Cloud Tasks retries"_, with no claim anywhere — `_update_page` at `app.py:89-98` is a blind swallow-everything `.update()`).

**The index and the run can disagree.** Two `PeopleEnriched` builds over identical inputs moved 9 of 112,196 ids between classes, because `list_distinct`'s order is a hash — `one_register_entry`'s own docstring warns about this. The content-hash vintage plus the local re-classification make it a diagnosable, self-healing `stale_precheck` rather than a silent wrong answer, and `no_payload`/`wrong_winning_id` are real terminal states with an alarm on their count. It does not eliminate the disagreement.

**Companies are still created, up to five per request.** Capping is a bound, not a fix, and `/api/ingest/company` publishes outright at `company.post.ts:388-389`. Refusing the repair entirely would make a person with one unknown KRS unimportable, which is worse. Everything created is recorded on the request and in the ledger.

**Ten manual states and a Polish string each is a maintenance object.** It is smaller than the alternative designs and every state exists because the underlying data actually produces it, but it is not free, and `stale_precheck`, `no_payload` and `wrong_winning_id` will need re-reading in six months. That is what `drainRuns` is for.

**The rules block is not runtime-tested.** `@firebase/rules-unit-testing` is absent from the repo. Making everything server-created shrinks the exposure to one `get` predicate, which is the point, but if this collection ever grows client writes, that library comes with it.

**The lookup shards squat on the crawl mirror.** `gs://koryta-pl-crawled/rejestrio_lookup/` is not what that bucket is for. It was chosen because the Nuxt server already holds a credential for it (`crawledBucket.ts:13`) and the prefix is outside `hostname=`, so `KorytaExport`'s listing is untouched. The price is a slightly wrong home for the data; the alternative was an IAM grant and a region question in slice one.

**We keep a demand signal and never act on it.** `not-in-corpus` requests accumulate. Turning them into a crawl target is the obvious next thing and is out of scope here.

**Estimates, marked as such.** GCS and Firestore per-request prices below are list-price arithmetic, not measured invoices, and they assume the bucket is in-region (prerequisite 4). Per request: one class-B GCS operation on a 7.3 kB object and three Firestore writes (the request plus the transactional cap read/write) — well under a grosz. Per import: 6.16 s of predator CPU and 3.29 GB of its RAM (measured), no egress, plus the ingest's own writes — one node, one revision, a handful of edges. Per corpus vintage: 2.09 s of duckdb and 1.87 MB uploaded (measured). Nothing in the request path can touch rejestr.io: `required_resources(PeoplePayloads)` returns `[]`, so no RejestrIO client is ever constructed.

## 9. Open questions for Szymon

**1. Should the index ship in the bucket, or committed with the Nuxt deploy?** App Hosting is `alwaysDeployFromSource`, so 1.87 MB of shards committed after each rebuild would make the vintage a deploy sha and delete the manifest, the shard LRU, the bucket IAM question and the current.json-vs-shard race in one move. **Recommendation: the bucket.** A 1.87 MB binary blob committed per corpus rebuild is ~680 MB of history a year, and it couples "the corpus moved" to "deploy the website".

**2. Is the index worth building at all, given the pin?** `--refresh :PeopleEnriched` makes a real run 6.16 s, and a `--dry-run` mode on `PeoplePayloads` would answer every question the index answers — producible, under what name, filed under whom, empty after the pre-2000 strip — exactly, by construction, with no vintage protocol and no shards. **Recommendation: keep the index**, for two reasons the dry-run cannot cover: the answer has to be synchronous in Cloud Run, where the corpus does not exist, and refusals have to stay free and available when predator is down. But if the vintage protocol ever becomes annoying, the dry-run is a genuine fallback and this design should be read as reversible on that point.

**3. Does `/api/ingest/company` get `requireDatascience`?** It is a one-line behaviour change to a live endpoint that currently lets any signed-in account publish a company outright, contradicting `auth.ts:5-13`'s own stated policy. **Recommendation: yes, after grepping its callers** — and ship it as its own commit so it can be reverted without touching this workflow. The cap in §4.16 is mandatory either way; the auth gate stops a stranger, the cap stops us.

**4. Public, or admin-only to start?** Slice one could ship behind `requireDatascience` with no daily cap and no honeypot. **Recommendation: admin-only first.** The cap and the queue-abuse surface are the only parts of this with no in-repo precedent being copied verbatim, and there is no rules test harness to exercise them.

**5. Twenty minutes, or five?** Every tick that finds an empty queue still costs a Firestore query and a python start on a box that also runs the dev stack. **Recommendation: twenty**, with `Persistent=true` so a missed one catches up — and add an admin "uruchom teraz" only if the wait actually becomes irritating, since it is a single `systemctl --user start koryta-requests.service` over SSH today.

**6. What happens to `not-in-corpus` wishes that are never fulfilled?** They accumulate forever at one document each. **Recommendation: leave them.** The volume is trivial, and they are the input to the only decision that would ever justify rejestr.io's $0.10 per person — a monthly batch against the most-requested unknown ids, where a human has already said the person matters.
