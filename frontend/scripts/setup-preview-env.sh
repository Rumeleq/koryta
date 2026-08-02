#!/bin/bash

# Creates the preview environment: a Firestore database and a Realtime Database
# instance beside production's, in the same Firebase project, plus the rules
# that govern them. Run once, by someone with owner rights on koryta-pl - the
# App Hosting backend is the one piece the CLI cannot create unattended, so the
# script stops and prints what to click.
#
# Everything here is idempotent; re-running it after a failure is fine.
#
#   npm run preview:setup

set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-koryta-pl}"
DATABASE="${PREVIEW_FIRESTORE_DATABASE:-koryta-pl-preview}"
RTDB="${PREVIEW_RTDB_INSTANCE:-koryta-pl-preview}"
LOCATION="${PREVIEW_FIRESTORE_LOCATION:-europe-central2}"
BACKEND="${PREVIEW_BACKEND:-preview}"
# The instance URL is not free-form: us-central1 instances answer on
# <id>.firebaseio.com, everywhere else on <id>.<region>.firebasedatabase.app.
# Production is us-central1, and shared/firebase-env.ts pins the matching
# preview URL, so this stays where the default puts it.
RTDB_URL="https://$RTDB.firebaseio.com"

if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: gcloud not found. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install" >&2
    exit 1
fi

echo "== Firestore database $DATABASE =="
if gcloud firestore databases describe \
    --database="$DATABASE" --project="$PROJECT" >/dev/null 2>&1; then
    echo "already exists"
else
    gcloud firestore databases create \
        --database="$DATABASE" --location="$LOCATION" \
        --type=firestore-native --project="$PROJECT"
fi

echo "== Realtime Database instance $RTDB =="
# Only ever written to (user/<uid> from the profile and login pages), so it
# starts empty rather than being copied from production.
if npx firebase database:instances:list --project "$PROJECT" 2>/dev/null |
    grep -qw "$RTDB"; then
    echo "already exists"
else
    npx firebase database:instances:create "$RTDB" --project "$PROJECT"
fi
echo "expected URL: $RTDB_URL"
echo "(if the console shows a different one, shared/firebase-env.ts is wrong)"

echo "== Rules and indexes =="
# firebase.preview.json exists so this can never be confused with the config
# that deploys production.
npx firebase deploy --only firestore,database \
    --config ../firebase.preview.json --project "$PROJECT"

echo "== Data =="
bash "$(dirname "${BASH_SOURCE[0]}")/refresh-preview-db.sh"

echo
echo "== Left to do by hand, once =="
cat <<EOF
The App Hosting backend cannot be created non-interactively with a repository
connection, so create it in the console:

  https://console.firebase.google.com/project/$PROJECT/apphosting

  * Backend id:       $BACKEND
  * Region:           the same one autopush runs in
  * Repository:       SzymonPajzert/koryta
  * Live branch:      main, with "automatic rollouts" OFF
                      (rollouts are triggered per branch by
                      .github/workflows/preview.yml, not by pushes)
  * Root directory:   frontend
  * Environment name: preview
                      This is what makes the backend read
                      frontend/apphosting.preview.yaml, which is where the
                      preview database ids live. Without it the build comes up
                      pointing at production and refuses to serve.

Then, so the workflow can roll out to it, grant the CI service account
(vars.GCP_PREVIEW_SERVICE_ACCOUNT) roles/firebaseapphosting.admin on $PROJECT.
EOF
