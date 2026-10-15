#!/usr/bin/env python3
"""Builds data/tdt.json from the public TDTChannels list of Spanish free-to-air channels.

Source: https://github.com/LaQuay/TDTChannels (TELEVISION.md). Only official HTTPS HLS links
without placeholders are kept. Channels without such a link keep their official web page.

Usage: sync_tdt.py [SOURCE_FILE_OR_URL] [OUTPUT]
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request

SOURCE = "https://raw.githubusercontent.com/LaQuay/TDTChannels/master/TELEVISION.md"
ATTRIBUTION = "TDTChannels · https://github.com/LaQuay/TDTChannels"
# Spanish sections only; international, streamer and religious lists are left out.
GROUPS = {
    "Nacionales": "Generalistas",
    "Informativos": "Informativos",
    "Deportivos": "Deportes",
    "Infantiles": "Infantiles",
    "Musicales": "Música",
    "Autonómicos": "Autonómicos",
}
LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")


def slug(text):
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def links(cell):
    return LINK.findall(cell)


def parse(markdown):
    channels, seen = [], set()
    group = region = None
    for line in markdown.splitlines():
        if line.startswith("## "):
            group, region = GROUPS.get(line[3:].strip()), None
            continue
        if line.startswith("### "):
            region = line[4:].strip()
            continue
        if not group or not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
        # Skip the header and separator rows; channel names may also start with "Canal".
        if len(cells) < 6 or cells[0] == "Canal" or set(cells[0]) <= {"-", " "}:
            continue
        name, streams_cell, web_cell, logo_cell, _epg, info = cells[:6]
        streams = []
        for label, url in links(streams_cell):
            if "m3u8" not in label.lower() or "[" in url or not url.startswith("https://"):
                continue
            if url not in streams:
                streams.append(url)
        web = next((u for _, u in links(web_cell) if u.startswith("https://")), "")
        logo = next((u for _, u in links(logo_cell) if u.startswith("https://")), "")
        if not streams and not web:
            continue
        base = slug(name) or "canal"
        ident, n = base, 2
        while ident in seen:
            ident, n = f"{base}-{n}", n + 1
        seen.add(ident)
        flags = [f for f in re.split(r"[,\s]+", info) if f and f != "-"]
        channels.append(
            {
                "id": ident,
                "name": name,
                "group": group,
                "region": region or "",
                "logo": logo,
                "web": web,
                "streams": streams,
                "geo": "GEO" in flags,
            }
        )
    return channels


def read(source):
    if source.startswith("https://"):
        request = urllib.request.Request(source, headers={"User-Agent": "CalamarTV-sync"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8")
    with open(source, encoding="utf-8") as handle:
        return handle.read()


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else SOURCE
    output = sys.argv[2] if len(sys.argv) > 2 else "data/tdt.json"
    channels = parse(read(source))
    playable = sum(1 for c in channels if c["streams"])
    # Refuse to replace a good catalog with a broken parse of a changed source format.
    if playable < 40:
        sys.exit(f"Solo {playable} canales reproducibles; se conserva el catálogo anterior")
    try:
        with open(output, encoding="utf-8") as handle:
            if json.load(handle).get("channels") == channels:
                print(f"Sin cambios: {len(channels)} canales")
                return
    except (OSError, ValueError):
        pass
    payload = {
        "source": ATTRIBUTION,
        "updated_at": int(time.time() * 1000),
        "channels": channels,
    }
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    print(f"{len(channels)} canales, {playable} reproducibles")


if __name__ == "__main__":
    main()
