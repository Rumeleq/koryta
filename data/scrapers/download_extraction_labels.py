"""Download extraction-labeling results, joined with fact content.

Streams the live Firestore `votes` collection, keeps the documents that carry
an `extractionId` (fact categorization votes, not node/person votes), then joins
each vote with its fact from the `extractions` collection. Writes JSONL + CSV.

Auth: application default credentials, e.g.
    gcloud auth application-default login
Run:
    python download_extraction_labels.py --out extraction_labels
"""

import argparse
import csv
import json

from google.cloud import firestore

# ExtractionFact fields worth carrying into the labeled dataset (see
# frontend/shared/model.ts). Fields vary by fact_type; missing ones become None.
FACT_FIELDS = [
    "fact_type",
    "url",
    "justification",
    "justification_in_text",
    "person",
    "organization",
    "role",
    "party",
    "subject",
    "object",
    "relation",
    "articleUrl",
    "articleDomain",
    "articleNodeId",
    "tag",
    "createdAt",
    "uploaderUid",
]


def download_votes(db: firestore.Client, only_user: str | None) -> list[dict]:
    rows: list[dict] = []
    for doc in db.collection("votes").stream():
        data = doc.to_dict() or {}
        extraction_id = data.get("extractionId")
        if not extraction_id:
            continue  # node/person votes use nodeId — skip them
        if only_user and data.get("userUid") != only_user:
            continue
        category_votes = data.get("categoryVotes") or {}
        if not isinstance(category_votes, dict):
            continue
        rows.append(
            {
                "vote_id": doc.id,
                "extraction_id": extraction_id,
                "user_uid": data.get("userUid"),
                "correct": category_votes.get("correct"),
                "insufficient": category_votes.get("insufficient"),
                "updated_at": str(data["updatedAt"]) if data.get("updatedAt") else None,
            }
        )
    return rows


def fetch_facts(db: firestore.Client, ids: list[str]) -> dict[str, dict]:
    """Batch-fetch extraction docs by id via get_all (only the referenced ones)."""
    col = db.collection("extractions")
    facts: dict[str, dict] = {}
    CHUNK = 300
    for i in range(0, len(ids), CHUNK):
        refs = [col.document(_id) for _id in ids[i : i + CHUNK]]
        for snap in db.get_all(refs):
            if snap.exists:
                facts[snap.id] = snap.to_dict() or {}
    return facts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="extraction_labels", help="Output basename")
    parser.add_argument("--user", default=None, help="Only this userUid")
    args = parser.parse_args()

    db = firestore.Client(project="koryta-pl", database="koryta-pl")

    votes = download_votes(db, args.user)
    print(f"Found {len(votes)} extraction votes")

    unique_ids = sorted({v["extraction_id"] for v in votes})
    print(f"Joining with {len(unique_ids)} unique extractions...")
    facts = fetch_facts(db, unique_ids)
    missing = len(unique_ids) - len(facts)
    if missing:
        print(f"  warning: {missing} extraction_ids had no matching fact doc")

    rows = []
    for v in votes:
        fact = facts.get(v["extraction_id"], {})
        row = dict(v)
        for field in FACT_FIELDS:
            row[field] = fact.get(field)
        rows.append(row)

    with open(f"{args.out}.jsonl", "w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")

    flat_fields = [
        "vote_id",
        "extraction_id",
        "user_uid",
        "correct",
        "insufficient",
        "updated_at",
        *FACT_FIELDS,
    ]
    with open(f"{args.out}.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=flat_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    correct = sum(1 for r in rows if r["correct"] == 1)
    incorrect = sum(1 for r in rows if r["correct"] == -1)
    insufficient = sum(1 for r in rows if r["insufficient"])
    print(f"  correct: {correct}  incorrect: {incorrect}  insufficient: {insufficient}")
    print(f"Wrote {args.out}.jsonl and {args.out}.csv ({len(rows)} rows)")


if __name__ == "__main__":
    main()
