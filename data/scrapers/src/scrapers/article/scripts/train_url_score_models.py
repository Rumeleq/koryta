"""Train the URL-only score models used by scrapers.article.scoring.

Two models, both TF-IDF(char 3-5) + Ridge over the URL string:

- koryciarski_url        : predicts koryciarski_llm_score (0-5)
                           from versioned/article_koryciarski_scores.jsonl
- ok_article_links_url   : predicts how many outbound links on a page are known
                           parsed-ok articles (log-target), from
                           versioned/article_parsed.jsonl

Run the pipelines first (e.g. `koryta ArticleKoryciarskiScores`), then:

    python -m scrapers.article.scripts.train_url_score_models

Artifacts are written to scrapers/article/models/*.joblib and loaded lazily by
scoring.py. Memory-bounded: streams the big parsed file and samples it.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.compose import TransformedTargetRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from scrapers.stores import VERSIONED_DIR

_VERSIONED = Path(VERSIONED_DIR)
_SCORES_FILE = (
    _VERSIONED / "article_koryciarski_scores" / "article_koryciarski_scores.jsonl"
)
_PARSED_FILE = _VERSIONED / "article_parsed" / "article_parsed.jsonl"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
SAMPLE_EVERY = 4  # keep 1 in N parsed rows for the link-count model


def _make_model(log_target: bool) -> Pipeline:
    vec = TfidfVectorizer(
        analyzer="char_wb", ngram_range=(3, 5),
        min_df=5, max_features=50_000, sublinear_tf=True,
    )
    ridge: Ridge | TransformedTargetRegressor = Ridge(alpha=1.0)
    if log_target:
        ridge = TransformedTargetRegressor(
            regressor=Ridge(alpha=1.0), func=np.log1p, inverse_func=np.expm1
        )
    return Pipeline([("tfidf", vec), ("ridge", ridge)])


def _norm(url: str) -> str:
    for p in ("https://", "http://"):
        if url.startswith(p):
            url = url[len(p):]
            break
    return url.rstrip("/")


def _fit_eval(name: str, urls: list[str], y: np.ndarray, log_target: bool) -> Pipeline:
    u_tr, u_te, y_tr, y_te = train_test_split(urls, y, test_size=0.2, random_state=42)
    model = _make_model(log_target)
    model.fit(u_tr, y_tr)
    mae = mean_absolute_error(y_te, model.predict(u_te))
    print(f"  [{name}] {len(urls):,} rows, held-out MAE {mae:.3f}")
    return model


def _train_koryciarski() -> Pipeline:
    print("Training koryciarski_url ...")
    urls: list[str] = []
    scores: list[float] = []
    with _SCORES_FILE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            u = r.get("url")
            s = r.get("koryciarski_llm_score")
            if r.get("error") is None and r.get("llm_is_article") is True \
                    and isinstance(u, str) and u and isinstance(s, (int, float)):
                urls.append(u)
                scores.append(float(s))
    return _fit_eval("koryciarski", urls, np.asarray(scores), log_target=False)


def _train_ok_article_links() -> Pipeline:
    print("Training ok_article_links_url ...")
    # pass 1: the set of parsed-ok article URLs (canonical, no protocol)
    ok: set[str] = set()
    with _PARSED_FILE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("parse_status") == "ok" and r.get("url"):
                ok.add(_norm(r["url"]))
    print(f"  {len(ok):,} ok-article URLs")

    # pass 2: sampled rows -> (url, count of outbound links that are ok articles)
    urls: list[str] = []
    counts: list[int] = []
    with _PARSED_FILE.open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i % SAMPLE_EVERY:
                continue
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            ob = r.get("outbound_urls")
            u = r.get("url")
            if not ob or not isinstance(u, str) or not u:
                continue
            urls.append(u)
            counts.append(sum(1 for o in ob if _norm(o) in ok))
    return _fit_eval(
        "ok_article_links", urls, np.asarray(counts, float), log_target=True
    )


def _top_ngrams(model: Pipeline, k: int = 12) -> None:
    vec = model.named_steps["tfidf"]
    reg = model.named_steps["ridge"]
    coef = (
        reg.regressor_.coef_
        if isinstance(reg, TransformedTargetRegressor)
        else reg.coef_
    )
    feat = vec.get_feature_names_out()
    tops = ", ".join(f"{feat[i]!r}" for i in np.argsort(coef)[-k:][::-1])
    print(f"    top n-grams: {tops}")


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name, trainer in (
        ("koryciarski_url", _train_koryciarski),
        ("ok_article_links_url", _train_ok_article_links),
    ):
        model = trainer()
        _top_ngrams(model)
        out = MODELS_DIR / f"{name}.joblib"
        joblib.dump(model, out, compress=3)
        print(f"  saved {out} ({out.stat().st_size / 1e6:.1f} MB)\n")
    print("Done. scoring.py loads these via 'koryciarski_ml' / 'article_hub_ml'.")


if __name__ == "__main__":
    main()
