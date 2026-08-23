# Local Development Setup

This guide explains how to set up the local development environment for the Koryta frontend, including Nuxt, Firebase Emulators, and testing tools.

## Prerequisites

- **Node.js**: v18 or later
- **Java**: Required for Firebase Emulators (JRE 11 or later recommended)

## Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

## Local Development

To run the application locally with a full Firebase Emulator suite (Auth, Firestore, Functions):

```bash
npm run dev:local
```

This command runs `concurrently`:

1.  **Firebase Emulators**: Starts emulators and imports data from `../database/current_firestore`.
2.  **Nuxt Dev Server**: Starts the frontend application.

- **Frontend**: http://localhost:3000
- **Emulator UI**: http://localhost:4000

### Database Seeding

The emulators automatically import data from `../database/current_firestore` on startup. This ensures you always have a consistent dataset for development.

## Testing

### Unit Tests (Vitest)

Run unit tests with Vitest:

```bash
npm run test
```

### End-to-End Tests (Cypress)

Run E2E tests with Cypress:

```bash
npm run test:e2e
```

This opens the Cypress interactive runner. Ensure the local development server (`npm run dev:local`) is running before starting Cypress.

## CI/CD & Pull Requests

We use GitHub Actions for continuous integration.

### Automated Checks

Every Pull Request triggers:

- **Linting**: Ensures code style consistency.
- **Unit Tests**: Runs Vitest.
- **E2E Tests**: Runs Cypress tests against the emulators.
- **Visual Regression**: Compares Playwright screenshots against committed baselines (`npm run test:visual`).

### Preview Deployments

A temporary **Preview URL** (e.g., `https://pr-123--koryta-pl.web.app`) is automatically generated for every PR. Use this to review UI changes on a live environment.

## Feedback → Slack

The "Zgłoś" button on every page writes to the `feedback` collection, and the
`onFeedbackCreated` Cloud Function forwards each report into a Slack channel.
Forwarding is off until both settings below exist: an unset token makes the
trigger log "Slack is not configured" and return, so local runs, previews and
the emulator never post to a real channel.

One-time setup:

1. Create a Slack app in the workspace, give the **bot** the `chat:write`
   scope, install it, and `/invite` it into the target channel. Forgetting the
   invite is the classic failure - the token and scopes look right and every
   post comes back `not_in_channel`.
2. Store the bot token (`xoxb-…`):
   ```bash
   firebase functions:secrets:set SLACK_BOT_TOKEN
   ```
3. Put the channel id (`C0123ABCD`, from the channel's "View channel details")
   in `frontend/functions/.env` as `SLACK_FEEDBACK_CHANNEL=…`. It is
   configuration rather than a secret, so it is not in Secret Manager.
4. Deploy. Functions are **not** deployed by CI, so a change to the card
   layout needs this by hand:
   ```bash
   firebase deploy --only functions:onFeedbackCreated
   npm --prefix frontend/functions run build   # first, in a fresh checkout
   ```

`firestore.rules` and `firestore.indexes.json` also change with this feature and
deploy separately again:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

To exercise the trigger locally, put `SLACK_BOT_TOKEN=xoxb-…` in
`frontend/functions/.secret.local` (already gitignored via `*.local`) and set
the channel to a scratch channel.

Two things post here, through the same endpoint and the same trigger: the
"Zgłoś" button, and a verdict left on an entry of the QA changelog at `/qa`
(see the README). A QA report carries `context.qa`, which is what makes its
card name the entry and link back to it.

Reports are accepted from signed-out visitors on purpose. The endpoint is
protected by a honeypot field and a daily ceiling on how many reports get
forwarded; past the ceiling reports are still saved and only the Slack forward
is suppressed, so flooding cannot silence a real reporter. `/admin/opinie` is
always the authoritative queue, and shows a "nie trafiło na Slacka" chip when a
forward failed.
