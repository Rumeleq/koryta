"""Back up the four article datasets (.bak if missing) and subset article_parsed
+ koryciarski_scores down to just the labeled URLs, for fast facts-extraction
iteration against the website labels as ground truth.

- article_parsed, koryciarski_scores: MOVE original -> .bak (if no .bak yet),
  then write a subset (only labeled URLs) back to the original path.
- article_facts, article_analyzed: COPY original -> .bak (if no .bak yet),
  leave original in place (the re-run will overwrite it).
"""

import json
import os
import shutil

V = "versioned"
PARSED = f"{V}/article_parsed/article_parsed.jsonl"
SCORES = f"{V}/article_koryciarski_scores/article_koryciarski_scores.jsonl"
FACTS = f"{V}/article_facts/article_facts.jsonl"
ANALYZED = f"{V}/article_analyzed/article_analyzed.jsonl"

# 1. Labeled URLs (the join key is the article `url` on each vote row).
labeled = {json.loads(l)["url"] for l in open("extraction_labels.jsonl")}
print(f"labeled URLs: {len(labeled)}")


def backup_move(path: str) -> str:
    """Move original to .bak (only if .bak absent). Returns the full-data source."""
    bak = path + ".bak"
    if not os.path.exists(bak):
        if os.path.exists(path):
            shutil.move(path, bak)
            print(f"backup (move): {path} -> {bak}")
        else:
            raise FileNotFoundError(f"{path} missing and no {bak}")
    else:
        print(f"backup exists, keeping: {bak}")
    return bak


def backup_copy(path: str) -> None:
    bak = path + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
        print(f"backup (copy): {path} -> {bak}")
    else:
        print(f"backup exists, keeping: {bak}")


def subset(src_bak: str, dst: str) -> None:
    """Stream full-data .bak, keep rows whose url is labeled, write to dst."""
    kept = 0
    seen: set[str] = set()
    with open(src_bak) as fin, open(dst, "w") as fout:
        for line in fin:
            # Cheap pre-filter before json parsing the big lines.
            if not any(u in line for u in labeled):
                continue
            try:
                url = json.loads(line).get("url")
            except json.JSONDecodeError:
                continue
            if url in labeled:
                fout.write(line)
                kept += 1
                seen.add(url)
    print(f"subset -> {dst}: {kept} rows, {len(seen)}/{len(labeled)} labeled URLs matched")
    missing = labeled - seen
    if missing:
        print(f"  MISSING ({len(missing)}): {sorted(missing)[:5]}")


# 2. Backups.
parsed_bak = backup_move(PARSED)
scores_bak = backup_move(SCORES)
backup_copy(FACTS)
backup_copy(ANALYZED)

# 3. Subsets (regenerated from pristine .bak each run -> idempotent).
subset(parsed_bak, PARSED)
subset(scores_bak, SCORES)
print("done.")
