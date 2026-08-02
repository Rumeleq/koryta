# Development

## Default Credentials

When running locally with `npm run dev:local`, the following default accounts are seeded:

- Admin level access
  - **Email:** `admin@koryta.pl`
  - **Password:** `password123`
- Normal user
  - **Email:** `user@koryta.pl`
  - **Password:** `password123`

You can use this account to log in and test authenticated features.

## Preview deployments

A branch can be put on a real URL, which is the only practical way to look at a
change on a phone. It deploys to the `preview` App Hosting backend and reads
the **preview databases** — a copy of the nightly export — so nothing done
there reaches koryta.pl.

### Deploying a branch

Push the branch, then either:

- add the **`preview`** label to its pull request (adding the label again after
  a push redeploys — it is the one "deploy now" gesture that works from a
  phone), or
- run **Actions → Preview deployment → Run workflow** and name a branch, or
- from a laptop: `npm run preview:deploy` for the current branch, or
  `npm run preview:deploy -- some-branch`.

The build runs on Google's side from the branch **as GitHub has it**, so
anything unpushed is not in the deployment. Expect a few minutes.

There is one backend, not one per pull request: whoever deploys last owns the
URL. The workflow run and the pull request comment say which branch is on it.

### What "safe" means here

The preview runs in the same Firebase project as production — same web app,
same Auth users, same App Check registration, so signing in works with the
account you already have — but every store it writes to is its own:

|                    | production               | preview             |
| ------------------ | ------------------------ | ------------------- |
| Firestore          | `koryta-pl`              | `koryta-pl-preview` |
| `users` collection | `(default)`              | `koryta-pl-preview` |
| Realtime Database  | `koryta-pl-default-rtdb` | `koryta-pl-preview` |

Those ids live in `shared/firebase-env.ts` and reach the running app through
`runtimeConfig`. Nothing addresses a database by name at the call site: use
`appFirestore()` / `appUsersFirestore()` / `appDatabase()` in `app/`, and
`adminFirestore()` / `adminDatabase()` in `server/`. A test in
`tests/shared/firebase-env.test.ts` fails the build if a literal creeps back
in, and `server/plugins/firebase.server.ts` refuses to boot a preview whose
configuration still names a production database — a preview that lost its
environment variables dies instead of writing to the live data.

Auth is shared on purpose, so the accounts are the same ones. That is also the
edge: **changing a password or deleting an account from the preview site does
it for real.** Data is isolated; identity is not.

The preview is served with `NUXT_PUBLIC_SITE_INDEXABLE=false`, so
`@nuxtjs/robots` disallows everything and it cannot compete with koryta.pl in
search results.

### What the preview does not have: triggers

The Cloud Functions in `functions/` are deployed once per project, and their
triggers name the database they watch (`database: "koryta-pl"` in
`functions/src/*.ts`). They therefore do **not** fire for writes to the preview
database. Reading the site is unaffected — the export already contains
everything they would have derived — but a node, edge, revision or vote created
_through the preview site_ leaves the derived fields it would normally maintain
untouched. `getPageMeta` is a plain callable and works.

Closing that would mean deploying a second copy of each trigger under different
names, bound to the preview database. It doubles the deployed functions, so it
is worth doing when the edit flow is what needs previewing, and not before.

### Refreshing the data

```
npm run db:preview:refresh           # import the newest nightly export
npm run db:preview:refresh -- --fresh  # drop the database first
```

Both read the same export `npm run db:pull` downloads for the emulator, but
import it server-side, so nothing comes through your machine. A plain refresh
_merges_: documents deleted in production since the last refresh, and anything
edited through the preview site, stay. `--fresh` recreates the database and is
the only way to get a faithful copy.

The preview Realtime Database is not copied. It only ever receives writes
(`user/<uid>` from the profile and login pages), so it starts empty.

### One-time setup

`npm run preview:setup` creates the Firestore database, the Realtime Database
instance and their rules, then prints the one step it cannot do unattended:
creating the App Hosting backend with a repository connection. Two details on
that backend matter —

- **Environment name `preview`**, which is what makes it read
  `apphosting.preview.yaml`. Without it the build comes up pointed at
  production and refuses to serve.
- **Automatic rollouts off**, so pushes to `main` do not land on it.

CI needs two repository variables — `GCP_PREVIEW_SERVICE_ACCOUNT` (with
`roles/firebaseapphosting.admin`, reachable through the existing workload
identity provider) and `PREVIEW_URL` (what the workflow tells people to open).

### Pointing local tools at the preview data

The scripts under `scripts/migrate/` and the e2e specs take the database id
from the environment, so a migration can be rehearsed against the preview copy:

```
NUXT_PUBLIC_FIRESTORE_DATABASE=koryta-pl-preview npx tsx scripts/migrate/... --prod
```
