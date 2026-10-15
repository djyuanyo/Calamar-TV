#!/usr/bin/env python3
"""Stamps every local script, stylesheet and module import of the built site with a version.

GitHub Pages lets browsers keep each file for about 10 minutes. Without a version a browser can mix
a new app.js with an old catalog.js after a deploy, and the page breaks until the cache expires.
With ?v=<commit> on every reference, one deploy is always loaded as a whole.

Usage: version_assets.py SITE_DIR VERSION
"""
import pathlib
import re
import sys

LOCAL_TAG = re.compile(r'((?:src|href)=")((?!https?:|//|#|data:)[\w./-]+\.(?:js|css))(")')
STATIC_IMPORT = re.compile(r"(from\s+')(\./[\w./-]+\.js)(')")
DYNAMIC_IMPORT = re.compile(r"(import\(\s*')(\./[\w./-]+\.js)('\s*\))")


def stamp(text, version, patterns):
    for pattern in patterns:
        text = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(3)}", text)
    return text


def unversioned(text, patterns):
    return [m.group(2) for p in patterns for m in p.finditer(text)]


def main():
    site, version = pathlib.Path(sys.argv[1]), sys.argv[2]
    if not re.fullmatch(r"[\w.-]+", version):
        sys.exit(f"Versión no válida: {version!r}")
    pages = list(site.glob("*.html"))
    scripts = list(site.glob("*.js"))
    for path in pages:
        path.write_text(stamp(path.read_text(encoding="utf-8"), version, [LOCAL_TAG]), encoding="utf-8")
    for path in scripts:
        path.write_text(stamp(path.read_text(encoding="utf-8"), version, [STATIC_IMPORT, DYNAMIC_IMPORT]), encoding="utf-8")
    # Anything still without a version would bring the mixed-cache problem back.
    left = [(p.name, ref) for p in pages for ref in unversioned(p.read_text(encoding="utf-8"), [LOCAL_TAG])]
    left += [(p.name, ref) for p in scripts for ref in unversioned(p.read_text(encoding="utf-8"), [STATIC_IMPORT, DYNAMIC_IMPORT])]
    if left:
        sys.exit("Referencias sin versión: " + ", ".join(f"{f} → {r}" for f, r in left))
    print(f"Versión {version} aplicada a {len(pages)} páginas y {len(scripts)} scripts")


if __name__ == "__main__":
    main()
