#!/usr/bin/env bash
set -e

# Runs every scoring model and uploads each one's shortlist under its own
# pipeline uid, so the site can tell which model nominated whom.
#
#   ./submit_scores.sh                    # against a local dev stack
#   ./submit_scores.sh prod               # against autopush
#   ./submit_scores.sh "" PeopleScoresPageRank   # one model only
#
# Each model is uploaded separately on purpose: `koryta_uploader --type score`
# reconciles a whole model at once, writing only what changed and retracting
# what the model no longer stands behind, and it can only do that for one model
# per run.

if [[ $1 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi

MODELS=${2:-"PeopleScores PeopleScoresPageRank PeopleScoresCoappointment PeopleScoresTurnover PeopleScoresCapture"}

echo "Prerunning the models"
for MODEL in $MODELS; do
	echo "koryta $MODEL --no-backup --all"
	uv run koryta "$MODEL"  --no-backup --all
done

for MODEL in $MODELS; do
	echo "koryta $MODEL | koryta_uploader --type score --submit $SUFFIX"
	uv run koryta "$MODEL"  --no-backup --all --output stderr 2>&1 1>/dev/null |
		koryta_uploader --type score --submit $SUFFIX
done
