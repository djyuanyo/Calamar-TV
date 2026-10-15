"""Publica en GitHub una copia de la agenda pública de fútbol (sin tokens)."""
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

URL = "https://bp.zicotv.cc/api/v1/events?sport=Soccer"
DEST = pathlib.Path("data/football.json")

def main():
    request = urllib.request.Request(URL, headers={"Accept": "application/json", "User-Agent": "CalamarTV/1.0"})
    with urllib.request.urlopen(request, timeout=18) as response:
        body = json.load(response)
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise ValueError("Respuesta inválida")
    events = []
    for e in body["data"]:
        if not isinstance(e, dict) or e.get("sport_category") != "Soccer":
            continue
        events.append({k: e.get(k) for k in (
            "id", "title", "home_team", "away_team", "home_team_badge",
            "away_team_badge", "sport_category", "league", "venue",
            "start_time", "status", "has_stream"
        )})
    snapshot = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(events),
        "data": events
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
