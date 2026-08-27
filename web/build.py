#!/usr/bin/env python3
"""Wrap web/app.html (which is body-content only, so it can be published
straight to a Claude Artifact) into a standalone web/index.html that works
when opened from disk or served as a static file."""

import pathlib

HERE = pathlib.Path(__file__).parent
SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#e7eaee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1216" media="(prefers-color-scheme: dark)">
<meta name="description" content="Fits a physical heating model to probe readings and says when to next open the oven.">
<style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>
{HEAD}
</head>
<body>
{BODY}
</body>
</html>
"""


def main() -> None:
    src = (HERE / "app.html").read_text()
    # Keep <title> and the font <link>s in the head; everything else is body.
    head_lines, body_lines = [], []
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("<title>") or stripped.startswith("<link "):
            head_lines.append(line)
        else:
            body_lines.append(line)
    out = SHELL.replace("{HEAD}", "\n".join(head_lines)).replace("{BODY}", "\n".join(body_lines))
    (HERE / "index.html").write_text(out)
    print(f"wrote {HERE / 'index.html'} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
