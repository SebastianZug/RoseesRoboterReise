"""Build static site data: extract the final route and tram line 7 from the map exports.

Sources (Leaflet exports in sources/):
- *_corrected.html  -> final robot route (`const D = {...}`)
- *_enhanced.html   -> tram line 7 geometry and planned tram ride (`const TRAM7`, `const RIDE`)
"""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent
SOURCES = ROOT / "sources"
ROUTE_FILE = SOURCES / "20261005_FG_DD_corrected.html"
TRAM_FILE = SOURCES / "20260930_103443_FG_DD_enhanced.html"
WALK_FILE = SOURCES / "fussweg_bischofsweg_4transferlab.json"
OUTPUT_FILE = ROOT / "docs" / "data.json"

# Koordinaten per Nominatim (OpenStreetMap) zur jeweiligen Adresse ermittelt.
PLACES = {
    "start": {
        "name": "RoboLab der TU Bergakademie Freiberg",
        "address": "Burgstraße 36, 09599 Freiberg",
        "latlng": [50.919087, 13.341896],
        "logos": ["logos/tubaf.png", "logos/robolab.png"],
    },
    "goal": {
        "name": "4transferLab",
        "address": "Fritz-Reuter-Straße 1, 01097 Dresden",
        "latlng": [51.072288, 13.744634],
        "logos": ["logos/4transfer.png"],
    },
}

# Abschnitte, die Rosee am 7.10.2026 im Auto zurückgelegt hat (Streckenkilometer).
# Abgeleitet aus den Fotos: 16:09 Uhr im Kofferraum bei km 21,2, ab 16:46 Uhr wieder unterwegs bei km 29,1.
CAR_SECTIONS = [
    {
        "from_km": 21.2,
        "to_km": 29.1,
        "label": "Nachmittags mit dem Auto",
        "reason": "wegen hoher Verkehrsbelastung im Feierabendverkehr",
    }
]

# Douglas-Peucker tolerance in metres; keeps data.json small without visible change.
SIMPLIFY_M = 1.0


def extract_const(html: str, name: str) -> Any:
    match = re.search(rf"const {name} = (\{{.*?\}});\n", html, re.S)
    if not match:
        raise ValueError(f"const {name} nicht gefunden")
    return json.loads(match.group(1))


def to_xy(points: list[list[float]]) -> list[tuple[float, float]]:
    lat0 = math.radians(sum(p[0] for p in points) / len(points))
    k = 6371000 * math.pi / 180
    return [(p[1] * k * math.cos(lat0), p[0] * k) for p in points]


def simplify(points: list[list[float]], tol: float) -> list[list[float]]:
    if len(points) < 3:
        return points
    xy = to_xy(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, best_d = -1, tol
        for i in range(a + 1, b):
            px, py = xy[i]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > best_d:
                best, best_d = i, d
        if best >= 0:
            keep[best] = True
            stack += [(a, best), (best, b)]
    return [p for p, k in zip(points, keep) if k]


def length_km(points: list[list[float]]) -> float:
    xy = to_xy(points)
    return sum(math.dist(xy[i - 1], xy[i]) for i in range(1, len(xy))) / 1000


def sub_line(points: list[list[float]], total_km: float, from_km: float, to_km: float) -> list[list[float]]:
    """Teilstück der Route zwischen zwei Streckenkilometern (auf die Gesamtlänge skaliert)."""
    xy = to_xy(points)
    cum = [0.0]
    for a, b in zip(xy, xy[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    scale = total_km * 1000 / cum[-1]
    cum = [c * scale / 1000 for c in cum]

    def at(km: float) -> list[float]:
        i = next((j for j in range(1, len(cum)) if cum[j] >= km), len(cum) - 1)
        f = 0.0 if cum[i] == cum[i - 1] else (km - cum[i - 1]) / (cum[i] - cum[i - 1])
        a, b = points[i - 1], points[i]
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

    inner = [p for p, c in zip(points, cum) if from_km < c < to_km]
    return [at(from_km), *inner, at(to_km)]


def rounded(points: list[list[float]]) -> list[list[float]]:
    return [[round(p[0], 6), round(p[1], 6)] for p in points]


def build() -> dict[str, Any]:
    route_data = extract_const(ROUTE_FILE.read_text(encoding="utf-8"), "D")
    tram_html = TRAM_FILE.read_text(encoding="utf-8")
    tram = extract_const(tram_html, "TRAM7")
    ride = extract_const(tram_html, "RIDE")

    walk = json.loads(WALK_FILE.read_text(encoding="utf-8"))

    raw = [[p[0], p[1]] for p in route_data["points"]]
    route = rounded(simplify(raw, SIMPLIFY_M))

    return {
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "places": PLACES,
        "walk": {"from": walk["from"], "to": walk["to"], "m": walk["m"], "line": walk["line"]},
        "route": {
            "name": "Finale Route",
            "file": ROUTE_FILE.name,
            "km": round(length_km(raw), 2),
            "points": route,
            "car": [
                {**section, "points": rounded(sub_line(route, round(length_km(raw), 2), section["from_km"], section["to_km"]))}
                for section in CAR_SECTIONS
            ],
        },
        "tram": {
            "name": "Straßenbahn Linie 7",
            "file": TRAM_FILE.name,
            "segs": tram["segs"],
            "stops": tram["stops"],
            "ride": {
                "from": ride["from"],
                "to": ride["to"],
                "km": ride["km"],
                "stops": ride["stops"],
                "line": ride["line"],
            },
        },
    }


def main() -> int:
    payload = build()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    route, ride = payload["route"], payload["tram"]["ride"]
    print(f"Route: {route['file']} ({route['km']} km, {len(route['points'])} Punkte nach Vereinfachung)")
    print(f"Linie 7: {ride['from']} -> {ride['to']} ({ride['km']} km, {len(payload['tram']['stops'])} Haltestellen)")
    print(f"Geschrieben: {OUTPUT_FILE} ({OUTPUT_FILE.stat().st_size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
