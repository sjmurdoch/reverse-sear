#!/usr/bin/env python3
"""Wrap web/app.html into a standalone, deployable page.

`web/app.html` is body content only, so it can be published straight to a Claude
Artifact.  This wraps it in an HTML shell and stamps the build footer with the
commit it was built from, producing `web/index.html` by default.

    python3 web/build.py                       # -> web/index.html
    python3 web/build.py --out _site/index.html
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
REPO = HERE.parent
REPO_URL = "https://github.com/sjmurdoch/reverse-sear"

SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sear Pilot">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#e7eaee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1216" media="(prefers-color-scheme: dark)">
<meta name="description" content="Fits a physical heating model to probe readings and says when to next open the oven.">
{HEAD}
</head>
<body>
{BODY}
</body>
</html>
"""


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], cwd=REPO, capture_output=True, text=True, timeout=10
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def build_stamp() -> str:
    """`<short sha> · <commit time>`, linked to the commit on GitHub.

    Falls back to the CI environment, then to a plain development marker, so the
    page always builds -- a missing stamp must never fail a deploy.
    """
    sha = _git("rev-parse", "HEAD") or os.environ.get("GITHUB_SHA")
    iso = _git("log", "-1", "--format=%cI")

    if iso:
        when = dt.datetime.fromisoformat(iso).astimezone(dt.timezone.utc)
    elif sha:
        when = dt.datetime.now(dt.timezone.utc)
    else:
        return "development build"

    stamp = f"{sha[:7]} · {when:%d %b %Y %H:%M} UTC"
    return f'<a href="{REPO_URL}/commit/{sha}">{stamp}</a>'


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(HERE / "index.html"), help="output path")
    args = ap.parse_args()

    src = (HERE / "app.html").read_text()

    head, body = [], []
    for line in src.splitlines():
        stripped = line.strip()
        (head if stripped.startswith(("<title>", "<link ")) else body).append(line)

    page = SHELL.replace("{HEAD}", "\n".join(head)).replace("{BODY}", "\n".join(body))

    start, end = "<!--BUILD-->", "<!--/BUILD-->"
    i, j = page.index(start) + len(start), page.index(end)
    page = page[:i] + build_stamp() + page[j:]

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"wrote {out} ({len(page)} bytes)")


if __name__ == "__main__":
    main()
