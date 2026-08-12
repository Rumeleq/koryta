"""Where the CRU mirror is, and what the run is allowed to do with it.

Runtime config goes through parse_known_args, same as `scrapers.wiki.dump` and
`scrapers.koryta.differ`, so these flags can be handed straight to `koryta`.
"""

import argparse
import os
from functools import cache

#: The postgres mirror of the CRU API. No password: libpq resolves one from
#: ~/.pgpass against the host:port:database:user quadruple, and a password in
#: a conninfo string would end up in the manifest, in `ps`, and in this repo.
#: The address is bracketed because it is IPv6 and the port would otherwise be
#: taken for another hextet.
[hostname, port, database, user] = os.getenv("CRU_POSTGRES", ":::").rsplit(":", 3)

DEFAULT_DSN = (
    f"postgresql://{user}@[{hostname}]:{port}/{database}"
    "?connect_timeout=10&application_name=koryta-cru"
)

#: The shared-cache key for the dump artifact, and the name it takes in
#: `downloaded/`. Deliberately not the same as `CruDump.filename`: the manifest
#: is a separate object in the same bucket, and `download_backup` picks the
#: last blob under a key, so sharing one would hand the reader whichever of the
#: two sorted higher.
ARTIFACT_NAME = "rejestrumow_dump"
ARTIFACT_FILENAME = f"{ARTIFACT_NAME}.sql.gz"

#: The tables the dump carries, in the order pg_dump emits them.
TABLES = ("umowa", "strona_umowy", "wynik_wyszukiwania")


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Registers the CRU flags on a parser.

    Every entry point that takes positional arguments has to call this, not
    just the one that reads them: parse_known_args sets an unknown *flag*
    aside but leaves its value looking like a positional, so `koryta` would
    otherwise take the DSN for a pipeline name.
    """
    parser.add_argument(
        "--cru-dsn",
        default=DEFAULT_DSN,
        help="libpq conninfo for the CRU mirror. Never put a password here -- "
        "put it in ~/.pgpass.",
    )
    parser.add_argument(
        "--cru-dump-file",
        default=None,
        help="Adopt this .sql.gz as the dump instead of running pg_dump. For "
        "replaying a run against an artifact you already have.",
    )
    parser.add_argument(
        "--cru-no-redump",
        action="store_true",
        help="Never contact the mirror. Use downloaded/ or the shared cache, "
        "and fail if neither has the artifact.",
    )
    parser.add_argument(
        "--cru-no-publish",
        action="store_true",
        help="Do not upload a freshly made artifact to the shared cache.",
    )
    parser.add_argument(
        "--cru-dump-timeout",
        type=int,
        default=900,
        help="Seconds before a pg_dump pass is killed. The full dump takes "
        "about 7s over a good link.",
    )


@cache
def args():
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]
