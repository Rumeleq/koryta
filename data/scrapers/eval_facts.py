"""Evaluate a facts-extraction run against the labeling rulebook.

Two layers (see facts_labeling_rules.md):
  * mechanical_grade(): deterministic checks that can conclusively assign
      - incorrect  (invalid subject/object name — §2/§4)
      - insufficient (subject/object name not present in the justification — §2)
    ...but never `correct` (that needs §1 language + §3 grounding), so it
    returns None ("needs judge") for facts with no mechanical defect.
  * llm_judge(): optional LLM-as-judge that applies the FULL rulebook; used for
    the facts mechanical grading leaves as None.

Usage:
  python eval_facts.py --validate               # mechanical vs GT (no LLM)
  python eval_facts.py --validate --llm         # mechanical+LLM vs GT
  python eval_facts.py --run article_facts.jsonl [--llm]

LLM endpoint (OpenAI-compatible): --llm-base-url (default http://localhost:6000/v1),
--llm-model. Grades one fact per request.
"""

import argparse
import collections
import json
import re
import unicodedata

GT_PATH = "extraction_gt.jsonl"
RULES_PATH = "facts_labeling_rules.md"

# Words that mark a "subject" as a description/relation rather than a name.
DESC_WORDS = {
    "ojciec", "ojca", "syn", "syna", "córka", "corka", "córki", "żona", "zona",
    "żonę", "mąż", "maz", "męża", "matka", "matki", "brat", "siostra",
    "konkubina", "małżonka", "malzonka", "partner", "partnerka", "rodzina",
}
INITIAL = re.compile(r"[A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśźż]?\.")  # "R.", "Cz."


def subject_of(f: dict) -> str:
    return (f.get("person") or f.get("subject") or "").strip()


def object_of(f: dict) -> str:
    return (f.get("object") or "").strip()


def just_text(f: dict) -> str:
    """Evidence to grade against = the VERBATIM article span, never the LLM's
    (possibly rewritten / name-prepended) justification field. Empty when the
    matcher found no verbatim span."""
    return (f.get("justification_in_text") or "").strip()


def valid_name(s: str) -> bool:
    """§2/§4: 'Imię Nazwisko' or anonymized 'Imię N.'; reject roles/descriptions."""
    s = s.strip()
    if not s:
        return False
    low = s.lower()
    if any(re.search(rf"\b{re.escape(w)}\b", low) for w in DESC_WORDS):
        return False
    toks = s.split()
    if toks[0][0].islower():                       # role/title, e.g. "prezes"
        return False
    if len(toks) == 1:                             # mononym or bare initial "M."
        return False
    last = toks[-1]
    return bool(INITIAL.fullmatch(last)) or last[0].isupper()


def _stem(tok: str) -> str:
    return tok[:4] if len(tok) >= 5 else tok


def name_in_justification(name: str, just: str, other: str = "") -> bool:
    """§2: a name token (stem, inflection-tolerant) must appear in the
    justification. Any token counts (first name or surname), EXCEPT a surname
    shared with the other relation endpoint — that would let a relative's name
    (Banaś, Horyń...) falsely satisfy the check, so we drop it."""
    just_l = (just or "").lower()
    toks = [t for t in name.split() if len(t.strip(".")) > 1]
    if not toks:
        return False
    if other:
        shared = {_stem(t.lower()) for t in other.split() if len(t.strip(".")) > 1}
        kept = [t for t in toks if _stem(t.lower()) not in shared]
        toks = kept or toks[:1]  # fall back to first name if all tokens shared
    return any(_stem(t.lower()) in just_l for t in toks)


def mechanical_grade(f: dict) -> tuple[str | None, str]:
    """Return (label|None, reason). None == no mechanical defect -> needs judge."""
    subj = subject_of(f)
    just = just_text(f)  # verbatim span only
    if not valid_name(subj):
        return "incorrect", f"subject '{subj}' is not a valid name (§2)"
    if f.get("fact_type") == "personal_relation":
        obj = object_of(f)
        if not valid_name(obj):
            return "incorrect", f"object '{obj}' is not a valid name (§4)"
        if not name_in_justification(obj, just, other=subj):
            return "insufficient", f"object '{obj}' not named in justification (§2/§4)"
        if not name_in_justification(subj, just, other=obj):
            return "insufficient", f"subject '{subj}' not named in justification (§2)"
        return None, "no mechanical defect (needs §1/§3 judge)"
    if not name_in_justification(subj, just):
        return "insufficient", f"subject '{subj}' not named in justification (§2)"
    return None, "no mechanical defect (needs §1/§3 judge)"


# --------------------------------------------------------------------------- #
# Optional LLM-as-judge for the facts mechanical grading can't decide.
# --------------------------------------------------------------------------- #
def llm_judge(f: dict, base_url: str, model: str, api_key: str | None) -> tuple[str, str]:
    import requests  # lazy: only when --llm is used

    rules = open(RULES_PATH, encoding="utf-8").read()
    fact_view = {k: f.get(k) for k in (
        "fact_type", "person", "subject", "role", "party", "organization",
        "object", "relation") if f.get(k) is not None}
    # Judge against the verbatim span, not the LLM's justification field.
    fact_view["justification"] = just_text(f)
    sys = (
        "You label extracted facts using this rulebook. Judge ONLY from the "
        "justification span. Reply with a single compact JSON object "
        '{"label": "correct|incorrect|insufficient", "reason": "..."}.\n\n' + rules
    )
    import time
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": 16000,  # reasoning judges (R1) need room before the JSON
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(fact_view, ensure_ascii=False)},
        ],
    }
    last = ""
    for attempt in range(4):  # R1 is flaky: empty content / non-JSON body / 5xx
        try:
            r = requests.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers, json=payload, timeout=240,
            )
            if r.status_code >= 500 or r.status_code == 429:
                last = f"http {r.status_code}"; time.sleep(2 * (attempt + 1)); continue
            r.raise_for_status()
            msg = r.json()["choices"][0]["message"]
            # R1 sometimes puts everything in `reasoning` with content=None.
            txt = msg.get("content") or msg.get("reasoning") or ""
            m = (re.search(r"\{[^{}]*\"label\"[^{}]*\}", txt, re.S)
                 or re.search(r"\{.*\}", txt, re.S))
            if not m:
                last = "no json"; time.sleep(1); continue
            obj = json.loads(m.group(0))
            lab = obj.get("label", "unknown")
            return (lab if lab in {"correct", "incorrect", "insufficient"}
                    else "unknown", obj.get("reason", ""))
        except (requests.RequestException, ValueError) as e:
            last = str(e)[:80]; time.sleep(1.5 * (attempt + 1))
    return "unknown", f"judge failed: {last}"


def grade(f: dict, use_llm: bool, base_url: str, model: str, api_key: str | None = None) -> tuple[str, str]:
    lab, reason = mechanical_grade(f)
    if lab is not None:
        return lab, reason
    if use_llm:
        return llm_judge(f, base_url, model, api_key)
    return "needs_judge", reason


# --------------------------------------------------------------------------- #
def _confusion(pairs) -> None:
    conf = collections.Counter(pairs)
    labels = ["correct", "incorrect", "insufficient", "needs_judge", "unknown"]
    present = [l for l in labels if any(p[1] == l for p in pairs)]
    print(f"  {'human/GT':13s}" + "".join(f"{p:>13s}" for p in present))
    for gtl in ["correct", "incorrect", "insufficient"]:
        row = "".join(f"{conf[(gtl, p)]:>13d}" for p in present)
        print(f"  {gtl:13s}{row}")


def _grade_all(facts, use_llm, base_url, model, api_key, concurrency=8, judge_all=False):
    """Grade every fact. Mechanical is instant; LLM-deferred facts run in a
    thread pool so a run of ~100 doesn't take 15 minutes serially.
    judge_all=True sends EVERY fact to the LLM judge (skips the mechanical
    pre-filter) — a fully independent LLM verdict on all facts."""
    from concurrent.futures import ThreadPoolExecutor

    results: list[tuple[str, str]] = [("", "")] * len(facts)
    deferred_idx = []
    for i, f in enumerate(facts):
        if judge_all and use_llm:
            deferred_idx.append(i)
            continue
        lab, reason = mechanical_grade(f)
        if lab is not None:
            results[i] = (lab, reason)
        elif use_llm:
            deferred_idx.append(i)
        else:
            results[i] = ("needs_judge", reason)

    def _judge(i):
        return i, llm_judge(facts[i], base_url, model, api_key)

    if deferred_idx:
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            for i, res in ex.map(_judge, deferred_idx):
                results[i] = res
    return results


def validate(use_llm, base_url, model, api_key=None, concurrency=8, judge_all=False) -> None:
    gt = [json.loads(l) for l in open(GT_PATH)]
    results = _grade_all(gt, use_llm, base_url, model, api_key, concurrency, judge_all)
    pairs = [(f["label"], lab) for f, (lab, _) in zip(gt, results)]
    decided = [(g, p) for g, p in pairs if p not in ("needs_judge", "unknown")]
    agree = sum(g == p for g, p in decided)
    print(f"GT facts: {len(gt)}   graded (non-deferred): {len(decided)}   "
          f"agreement on graded: {agree}/{len(decided)} = {agree/max(len(decided),1):.0%}")
    print("confusion (GT rows -> predicted cols):")
    _confusion(pairs)


def _idkey(f: dict) -> tuple:
    subj = subject_of(f)
    norm = "".join(c for c in unicodedata.normalize("NFKD", subj.lower())
                   if not unicodedata.combining(c))
    first = next((t for t in norm.split() if len(t.strip(".")) > 1), norm)
    return (f.get("articleUrl") or f.get("url"), f.get("fact_type"), first)


def score_run(path, use_llm, base_url, model, api_key=None, concurrency=8, judge_all=False, dump=None) -> None:
    facts = [json.loads(l) for l in open(path)]
    results = _grade_all(facts, use_llm, base_url, model, api_key, concurrency, judge_all)
    dist, rules, graded = collections.Counter(), collections.Counter(), []
    for f, (lab, reason) in zip(facts, results):
        dist[lab] += 1
        rules[reason.split("(")[-1].rstrip(") ")] += 1
        graded.append((f, lab))
    if dump:
        with open(dump, "w") as _d:
            for f, (lab, reason) in zip(facts, results):
                rec = {"label": lab, "reason": reason, "fact_type": f.get("fact_type"),
                       "person": f.get("person"), "subject": f.get("subject"),
                       "object": f.get("object"), "role": f.get("role"),
                       "party": f.get("party"), "organization": f.get("organization"),
                       "relation": f.get("relation"),
                       "justification_in_text": f.get("justification_in_text")}
                _d.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"wrote per-fact labels+reasons -> {dump}")
    n = len(facts)
    print(f"run: {path}   facts: {n}")
    print("label distribution:", dict(dist))
    good = dist["correct"]
    print(f"quality: correct={good} ({good/max(n,1):.0%})  "
          f"incorrect={dist['incorrect']}  insufficient={dist['insufficient']}")

    # Coverage of the gold 'correct' facts on these articles.
    gold = {_idkey(f) for f in map(json.loads, open(GT_PATH)) if f["label"] == "correct"}
    run_correct = {_idkey(f) for f, lab in graded if lab == "correct"}
    hit = len(gold & run_correct)
    print(f"gold-correct facts covered: {hit}/{len(gold)} "
          f"({hit/max(len(gold),1):.0%})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--run", metavar="FACTS_JSONL")
    ap.add_argument("--llm", action="store_true", help="use LLM judge for deferred facts")
    ap.add_argument("--llm-base-url", default="http://localhost:6000/v1")
    ap.add_argument("--llm-model", default="Qwen/Qwen3-32B")
    ap.add_argument("--llm-api-key", default=None)
    ap.add_argument("--judge-all", action="store_true", help="send every fact to the LLM judge (skip mechanical pre-filter)")
    ap.add_argument("--dump", default=None, help="write per-fact label+reason jsonl")
    a = ap.parse_args()
    import os
    api_key = a.llm_api_key or os.environ.get('OPENROUTER_APIKEY') or os.environ.get('OPENAI_API_KEY')
    if a.validate:
        validate(a.llm, a.llm_base_url, a.llm_model, api_key, judge_all=a.judge_all)
    if a.run:
        score_run(a.run, a.llm, a.llm_base_url, a.llm_model, api_key, judge_all=a.judge_all, dump=a.dump)
    if not a.validate and not a.run:
        ap.error("pass --validate and/or --run")


if __name__ == "__main__":
    main()
