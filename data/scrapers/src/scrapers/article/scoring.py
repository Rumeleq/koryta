"""URL scoring for the article crawler.

Assigns priority scores to URLs based on keyword relevance.
"""

from pathlib import Path
from typing import Any, Callable

from entities.util import NormalizedParse
from util.polish import remove_polish_diacritics

# Internal type: all registered scorers accept domains_of_interest
_RawScorer = Callable[[str, frozenset[str]], int]
# Public type returned by get_scoring_function (domains already bound)
ScoringFunction = Callable[[str], int]

SCORING_FUNCTIONS: dict[str, _RawScorer] = {}


def score_function(name: str):
    def decorator(fn: _RawScorer) -> _RawScorer:
        SCORING_FUNCTIONS[name] = fn
        return fn

    return decorator


def get_scoring_function(
    name: str, domains_of_interest: frozenset[str] = frozenset()
) -> ScoringFunction:
    """Look up a scoring function by name.

    Available: {list(SCORING_FUNCTIONS.keys())}
    """
    if name not in SCORING_FUNCTIONS:
        available = ", ".join(SCORING_FUNCTIONS.keys())
        raise ValueError(f"Unknown scoring function: {name!r}. Available: {available}")
    fn = SCORING_FUNCTIONS[name]
    return lambda url: fn(url, domains_of_interest)


def tag_in_url(tag: str, url: str) -> bool:
    tag = remove_polish_diacritics(tag.lower().replace(" ", "-"))
    return tag in url.lower()


_ARTICLE_KEYWORDS = [
    # corruption / crime
    "afera",
    "korupcja",
    "skandal",
    "uklad",
    "mafia",
    "nepotyzm",
    "lapowka",
    "defraudacja",
    "malwersacja",
    "przekret",
    "kumoterstwo",
    "konflikt-interesow",
    # public funds / procurement
    "przetarg",
    "dotacje",
    "fundusz",
    "prywatyzacja",
    # officials
    "polityk",
    "polityczny",
    "polityczna",
    "partia",
    "radny",
    "burmistrz",
    "wojt",
    "starosta",
    # investigations
    "zarzuty",
    "prokuratura",
    "zatrzyman",
    "cba",
    # elections
    "wybory",
]

_LISTING_SEGMENTS = (
    "/tag/", "/tagi/", "/kategoria/", "/autor/", "/strona/", "/page/", "/feed", "/rss"
)
_OFFPATH_SECTIONS = (
    "/sport/", "/rozrywka/", "/pogoda/", "/moda/", "/kuchnia/", "/lifestyle/"
)
_SKIP_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif")


@score_function("default")
def url_score(url: str, domains_of_interest: frozenset[str] = frozenset()) -> int:
    score = 0
    parsed_url = NormalizedParse.parse(url)

    if parsed_url.hostname_normalized in domains_of_interest:
        score += 10

    # Match keywords in the article slug/title only. Title slugs are almost
    # always the longest path segment, so pick that rather than relying on
    # position (which varies by site — some append a short ID after the title).
    # If there are no path segments (bare domain URL), fall back to the full path.
    path_parts = [p for p in parsed_url.path.split("/") if p]
    if path_parts:
        longest = max(path_parts, key=len)
        slug = remove_polish_diacritics(longest.lower())
        if longest == parsed_url.hostname_normalized:
            slug = remove_polish_diacritics(parsed_url.path.lower())
    else:
        slug = remove_polish_diacritics(parsed_url.path.lower())
    for k in _ARTICLE_KEYWORDS:
        if remove_polish_diacritics(k) in slug:
            score += 1

    path_lower = parsed_url.path.lower()

    if tag_in_url("polityka prywatnosci", parsed_url.path):
        score -= 10
    if any(seg in path_lower for seg in _LISTING_SEGMENTS):
        score -= 5
    if any(sec in path_lower for sec in _OFFPATH_SECTIONS):
        score -= 3
    if path_lower.endswith(_SKIP_EXTENSIONS):
        score -= 10

    return max(0, score)


@score_function("kalisz")
def url_score_kalisz(
    url: str, domains_of_interest: frozenset[str] = frozenset()
) -> int:
    score = 0

    wrong_ends = [
        ".pdf",
        ".jpg",
        ".webp",
        ".png",
    ]
    for wrong_end in wrong_ends:
        if url.endswith(wrong_end):
            return 0

    keywords = [
        "gloswielkopolski.pl",
        "kalisz24.info.pl",
        "kalisz.naszemiasto.pl",
        "kalisz.wyborcza.pl",
        "kurierostrowski.pl/",
        "latarnikkaliski.pl",
        "m.rc.fm",
        "ostrzeszowinfo.pl",
        "poznan.tvp.pl",
        "poznan.wyborcza.pl",
        "pzkol.pl",
        "radiopoznan.fm/informacje",
        "wiadomosci.onet.pl/poznan",
        "wlkp24.info",
        "faktykaliskie.info",
        "zyciekalisza.pl",
    ]
    for k in keywords:
        score += tag_in_url(k, url) * 10

    keywords = [
        "afera",
        "korupcja",
        "skandal",
        "układ",
        "mafia",
        "nepotyzm",
        "polityk",
        "partia",
        "dotacje",
        "prywatyzacja",
        "fundusz",
        "wybory",
        "polityczny",
        "polityczna",
        "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, url)

    return max(0, score)


# --- ML URL scorers -------------------------------------------------------
# Models trained by scrapers.article.scripts.train_url_score_models and stored
# as joblib artifacts next to this module. sklearn/joblib are imported lazily so
# the crawler only pays for them when an ML scorer is actually selected.

_MODELS_DIR = Path(__file__).parent / "models"
_loaded_models: dict[str, Any] = {}


def _load_url_model(name: str) -> Any:
    if name not in _loaded_models:
        import joblib  # noqa: PLC0415  (lazy: keep sklearn off the crawler path)

        path = _MODELS_DIR / f"{name}.joblib"
        if not path.exists():
            raise FileNotFoundError(
                f"URL score model {path} not found. Train it with "
                "`python -m scrapers.article.scripts.train_url_score_models`."
            )
        _loaded_models[name] = joblib.load(path)
    return _loaded_models[name]


# Model file backing each ML scorer, so batch scoring can reach it directly.
_ML_SCORER_MODELS = {
    "koryciarski_ml": "koryciarski_url",
    "article_hub_ml": "ok_article_links_url",
}

# Spread each raw prediction onto the 0..100 priority axis so the queue isn't
# millions of URLs tied at one value. The raw ranges are small (koryciarski
# ~0-5, ok-link count ~0-20), so without scaling `priority = 100 - score`
# collapses everything into 95-100. Tunable per model.
_ML_SCORE_SCALE = {
    "koryciarski_url": 20.0,
    "ok_article_links_url": 5.0,
}


def _predict_raw(model_name: str, urls: list[str]) -> list[float]:
    """Raw float predictions. Keeping the sub-integer signal (0.4, not round→0)
    is what lets priorities actually spread out."""
    return [float(p) for p in _load_url_model(model_name).predict(urls)]


def _host_of_interest(url: str, domains: frozenset[str]) -> bool:
    """True if the URL's host is a seed domain or a subdomain of one."""
    host = NormalizedParse.parse(url).hostname_normalized
    return host in domains or any(host.endswith("." + d) for d in domains)


def _ml_priority_score(
    model_name: str, raw: float, url: str, domains: frozenset[str]
) -> int:
    """Scale a raw prediction to 0..100. URLs outside the seed domains (e.g.
    cba.pl, which isn't in seed.csv) score 0 -> priority 100 (crawled last), so
    the crawler stays on domains we actually care about."""
    if domains and not _host_of_interest(url, domains):
        return 0
    scale = _ML_SCORE_SCALE.get(model_name, 1.0)
    return max(0, min(100, round(raw * scale)))


def get_batch_scoring_function(
    name: str, domains_of_interest: frozenset[str] = frozenset()
) -> Callable[[list[str]], list[int]]:
    """Like get_scoring_function but scores a whole list at once.

    ML scorers run a single vectorized model.predict over the batch (far faster
    than one call per URL); other scorers fall back to per-URL evaluation.
    """
    if name in _ML_SCORER_MODELS:
        model_name = _ML_SCORER_MODELS[name]

        def scorer(urls: list[str]) -> list[int]:
            raw = _predict_raw(model_name, urls)
            return [
                _ml_priority_score(model_name, r, u, domains_of_interest)
                for u, r in zip(urls, raw)
            ]

        return scorer
    fn = get_scoring_function(name, domains_of_interest)
    return lambda urls: [fn(u) for u in urls]


@score_function("koryciarski_ml")
def url_score_koryciarski_ml(
    url: str, domains_of_interest: frozenset[str] = frozenset()
) -> int:
    """Predicted koryciarski score, scaled to 0..100 and seed-gated."""
    raw = _predict_raw("koryciarski_url", [url])[0]
    return _ml_priority_score("koryciarski_url", raw, url, domains_of_interest)


@score_function("article_hub_ml")
def url_score_article_hub_ml(
    url: str, domains_of_interest: frozenset[str] = frozenset()
) -> int:
    """Predicted number of ok article links, scaled to 0..100 and seed-gated."""
    raw = _predict_raw("ok_article_links_url", [url])[0]
    return _ml_priority_score(
        "ok_article_links_url", raw, url, domains_of_interest
    )
