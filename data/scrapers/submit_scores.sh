#!/usr/bin/env bash
set -e

# Runs every scoring model and uploads each one's shortlist under its own
# pipeline uid, so the site can tell which model nominated whom.
#
#   ./submit_scores.sh                    # against a local dev stack
#   ./submit_scores.sh prod               # against autopush
#   ./submit_scores.sh "" PeopleScoresPageRank   # one model only
#   ./submit_scores.sh prod "" resume     # send what an earlier run did not
#
# Each model is uploaded separately on purpose: `koryta_uploader --type score`
# reconciles a whole model at once, writing only what changed and retracting
# what the model no longer stands behind, and it can only do that for one model
# per run.
#
# The votes leave in paced batches rather than all at once. Every vote written
# fires `onVoteWritten`, which queries every vote on that node and rewrites the
# node's aggregate, so a shortlist pushed at full speed lands on the backend as
# tens of thousands of function invocations at the same moment. BATCH_SIZE and
# BATCH_PAUSE set the rate; MAX_OPERATIONS stops a run early and leaves the
# rest for `resume`. What has not been sent is kept in versioned/score_uploads,
# so an interrupted upload finishes without re-running the pipelines.
#
#   BATCH_PAUSE=0 ./submit_scores.sh              # emulator: no trigger to spare
#   MAX_OPERATIONS=5000 ./submit_scores.sh prod   # a slice per run, from cron

if [[ $1 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi

MODELS=${2:-"PeopleScores PeopleScoresPageRank PeopleScoresCoappointment PeopleScoresTurnover PeopleScoresCapture"}

BATCHING="--batch-size ${BATCH_SIZE:-100} --batch-pause ${BATCH_PAUSE:-1}"
if [[ -n $MAX_OPERATIONS ]]; then
	BATCHING="$BATCHING --max-operations $MAX_OPERATIONS"
fi

if [[ $3 == resume ]]; then
	echo "koryta_uploader --type score --submit --resume $BATCHING $SUFFIX"
	uv run koryta_uploader --type score --submit --resume $BATCHING $SUFFIX
	exit 0
fi

echo "Prerunning the models"
for MODEL in $MODELS; do
	echo "koryta $MODEL --no-backup"
	uv run koryta "$MODEL" --no-backup
done

for MODEL in $MODELS; do
	echo "koryta $MODEL | koryta_uploader --type score --submit $BATCHING $SUFFIX"
	uv run koryta "$MODEL" --no-backup --output stderr 2>&1 1>/dev/null |
		uv run koryta_uploader --type score --submit $BATCHING $SUFFIX
done
