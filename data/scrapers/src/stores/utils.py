import argparse
import select
import sys
from functools import cache
from urllib.parse import urljoin

from scrapers.stores import Utils


@cache
def _args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--assume-yes",
        action="store_true",
        help="Answer yes to the 'this pipeline runs long' prompts instead of "
        "waiting on stdin. Required for unattended runs.",
    )
    return parser.parse_known_args()[0]


class UtilsImpl(Utils):
    def input_with_timeout(self, msg: str, timeout: int = 10) -> str | None:
        # Without this an unattended run reads EOF from /dev/null, takes it as
        # "no", and skips every confirm_run pipeline -- silently, and long
        # before anything gets a chance to fail.
        if _args().assume_yes:
            print(f"{msg} -- answering y (--assume-yes)")
            return "y"

        print(msg)
        sys.stdout.flush()
        i, o, e = select.select([sys.stdin], [], [], timeout)

        if i:
            return sys.stdin.readline().strip()
        else:
            return None

    def join_url(self, base: str, url: str) -> str:
        return urljoin(base, url)
