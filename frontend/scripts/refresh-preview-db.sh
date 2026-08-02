#!/bin/bash

# Loads the newest nightly export into the preview Firestore database - the
# same bytes `npm run db:pull` downloads for the emulator, imported server-side
# instead of downloaded, so nothing has to come through this machine.
#
# Import merges: it writes every document in the export over whatever is there
# and leaves anything else alone. So documents deleted in production since the
# last refresh, and edits made through the preview site, survive. Pass --fresh
# to drop the database and recreate it first, which is the only way to get a
# faithful copy.
#
#   npm run db:preview:refresh
#   npm run db:preview:refresh -- --fresh

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/firestore-export.sh"

PROJECT="${FIREBASE_PROJECT:-koryta-pl}"
DATABASE="${PREVIEW_FIRESTORE_DATABASE:-koryta-pl-preview}"
LOCATION="${PREVIEW_FIRESTORE_LOCATION:-europe-central2}"

fresh=false
for arg in "$@"; do
    case "$arg" in
    --fresh) fresh=true ;;
    *)
        echo "Unknown argument: $arg" >&2
        exit 2
        ;;
    esac
done

require_gcloud

# Guard against a typo pointing this at production. The preview database is
# created by setup-preview-env.sh and is never the one the site reads.
if [ "$DATABASE" = "koryta-pl" ] || [ "$DATABASE" = "(default)" ]; then
    echo "Error: $DATABASE is a production database, refusing to import into it" >&2
    exit 1
fi

if [ "$fresh" = true ]; then
    echo "Deleting $DATABASE so the import lands on an empty database..."
    gcloud firestore databases delete \
        --database="$DATABASE" --project="$PROJECT" --quiet
    echo "Recreating $DATABASE in $LOCATION..."
    gcloud firestore databases create \
        --database="$DATABASE" --location="$LOCATION" \
        --type=firestore-native --project="$PROJECT" --quiet
    echo "Redeploying rules and indexes onto the new database..."
    npx firebase deploy --only firestore \
        --config ../firebase.preview.json --project "$PROJECT"
fi

echo "Fetching the latest backup path from $BUCKET_PREFIX..."
latest_backup_path=$(latest_export_path)
# gcloud wants the export directory, without the trailing slash `ls` leaves on.
latest_backup_path="${latest_backup_path%/}"
echo "Latest backup found at: $latest_backup_path"

# An import runs asynchronously on Google's side; --async would return before
# the data is there, which is exactly when someone would open the preview site
# and find it half full.
echo "Importing into $PROJECT/$DATABASE (this takes a few minutes)..."
gcloud firestore import "$latest_backup_path" \
    --database="$DATABASE" --project="$PROJECT"

echo "Preview database refreshed from $latest_backup_path"
