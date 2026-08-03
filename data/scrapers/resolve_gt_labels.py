"""Resolve per-vote extraction labels into one ground-truth label per fact.

Rule (agreed):
- Per vote: `insufficient` OVERRIDES the correct/incorrect axis.
    insufficient set        -> "insufficient"
    correct == 1            -> "correct"
    correct == -1           -> "incorrect"
- Per fact (multiple reviewers): `insufficient` is a veto — if ANY reviewer's
  resolved verdict is insufficient, the fact is "insufficient". Otherwise the
  sign of the summed correct votes decides; a 0 sum (pure disagreement) -> "conflict".

Writes extraction_gt.jsonl / .csv: one row per extraction_id with the resolved
label, vote counts, and the fact content.
"""

import collections
import csv
import json

FACT_FIELDS = [
    "fact_type", "url", "justification", "justification_in_text",
    "person", "organization", "role", "party", "subject", "object", "relation",
    "articleUrl", "articleDomain", "tag",
]


def vote_verdict(row: dict) -> str:
    if row.get("insufficient"):
        return "insufficient"
    if row.get("correct") == 1:
        return "correct"
    if row.get("correct") == -1:
        return "incorrect"
    return "unknown"


def resolve(verdicts: list[str], correct_sum: int) -> str:
    if "insufficient" in verdicts:      # veto
        return "insufficient"
    if correct_sum > 0:
        return "correct"
    if correct_sum < 0:
        return "incorrect"
    return "conflict"                    # reviewers split evenly, no insufficient


rows = [json.loads(l) for l in open("extraction_labels.jsonl")]
by = collections.defaultdict(list)
for r in rows:
    by[r["extraction_id"]].append(r)

out = []
for eid, votes in by.items():
    verdicts = [vote_verdict(v) for v in votes]
    correct_sum = sum(v["correct"] for v in votes if v["correct"] in (1, -1))
    label = resolve(verdicts, correct_sum)
    fact = votes[0]  # fact content identical across a fact's votes
    rec = {
        "extraction_id": eid,
        "label": label,
        "n_reviewers": len(votes),
        "n_correct": sum(1 for v in verdicts if v == "correct"),
        "n_incorrect": sum(1 for v in verdicts if v == "incorrect"),
        "n_insufficient": sum(1 for v in verdicts if v == "insufficient"),
        **{f: fact.get(f) for f in FACT_FIELDS},
    }
    out.append(rec)

with open("extraction_gt.jsonl", "w") as f:
    for r in out:
        f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")

with open("extraction_gt.csv", "w", newline="") as f:
    fields = ["extraction_id", "label", "n_reviewers", "n_correct",
              "n_incorrect", "n_insufficient", *FACT_FIELDS]
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(out)

print(f"facts: {len(out)}")
print("label distribution:", dict(collections.Counter(r["label"] for r in out)))
multi = [r for r in out if r["n_reviewers"] > 1]
print(f"multi-reviewer facts: {len(multi)}")
for r in multi:
    print(f"  {r['extraction_id']}  label={r['label']:12s} "
          f"(correct={r['n_correct']} incorrect={r['n_incorrect']} insuf={r['n_insufficient']})")
