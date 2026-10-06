"""Build static site data: read GPX files and emit docs/data.json."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import gpxpy

DATA_ROOT = Path(
    os.environ.get(
        "ROBOT_ROUTE_DATA_DIR",
        "/home/sz/Nextcloud/2025-09-19-Freiberg nach Dresden",
    )
).expanduser()

OUTPUT_FILE = Path(__file__).parent / "docs" / "data.json"


def list_gpx(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(p for p in root.rglob("*.gpx") if p.is_file())


def score_planned(path: Path) -> int:
    name = path.name.lower()
    score = 0
    for token in ("geplant", "planung", "plan", "neuplanung"):
        if token in name:
            score += 10
    if "auswertung" in str(path.parent).lower():
        score += 2
    return score


def score_ridden(path: Path) -> int:
    name = path.name.lower()
    score = 0
    for token in ("gefahren", "handy", "norman", "radfahren"):
        if token in name:
            score += 8
    if "auswertung" in str(path.parent).lower():
        score += 2
    if "geplant" in name:
        score -= 100
    return score


def score_planned_v2(path: Path) -> int:
    full = str(path).lower()
    score = 0
    if "neuplanung" in full:
        score += 20
    if "2026" in full:
        score += 5
    return score


def pick_routes(gpx_files: list[Path]) -> tuple[Path | None, Path | None, Path | None]:
    if not gpx_files:
        return None, None, None

    planned_v2 = max(gpx_files, key=lambda p: (score_planned_v2(p), p.stat().st_mtime))
    if score_planned_v2(planned_v2) <= 0:
        planned_v2 = None

    pool = [p for p in gpx_files if p != planned_v2]
    planned = max(pool, key=lambda p: (score_planned(p), p.stat().st_mtime), default=None)
    rest = [p for p in pool if p != planned]
    ridden = max(rest, key=lambda p: (score_ridden(p), p.stat().st_mtime), default=None)

    if planned and score_planned(planned) <= 0:
        planned = max(pool, key=lambda p: p.stat().st_mtime, default=None)
    if ridden and score_ridden(ridden) <= 0:
        ridden = max(rest, key=lambda p: p.stat().st_mtime, default=None)
    return planned, planned_v2, ridden


def parse_track(gpx_path: Path) -> dict[str, Any]:
    """Return points + cumulative-distance elevation profile for the first non-empty source."""
    with gpx_path.open("r", encoding="utf-8", errors="ignore") as fh:
        gpx = gpxpy.parse(fh)

    points: list[list[float]] = []
    profile: list[dict[str, float]] = []
    cumulative_km = 0.0
    prev = None

    sources = (
        [pt for trk in gpx.tracks for seg in trk.segments for pt in seg.points]
        or [pt for rt in gpx.routes for pt in rt.points]
        or list(gpx.waypoints)
    )

    for pt in sources:
        points.append([round(pt.latitude, 6), round(pt.longitude, 6)])
        if prev is not None:
            step = prev.distance_3d(pt) or prev.distance_2d(pt) or 0.0
            cumulative_km += step / 1000.0
        elevation = pt.elevation if pt.elevation is not None else 0.0
        profile.append({"d": round(cumulative_km, 3), "e": round(elevation, 1)})
        prev = pt

    has_elevation = any(
        pt.elevation is not None and pt.elevation != 0 for pt in sources
    )

    return {
        "points": points,
        "elevation": profile if has_elevation else [],
    }


def relative_to_data_root(path: Path) -> str:
    try:
        return str(path.relative_to(DATA_ROOT)).replace(os.sep, "/")
    except ValueError:
        return str(path)


def build() -> dict[str, Any]:
    if not DATA_ROOT.exists():
        raise FileNotFoundError(f"Datenordner nicht gefunden: {DATA_ROOT}")

    gpx_files = list_gpx(DATA_ROOT)
    planned_file, planned_v2_file, ridden_file = pick_routes(gpx_files)
    if planned_file is None and planned_v2_file is None and ridden_file is None:
        raise ValueError(f"Keine GPX-Dateien in {DATA_ROOT} gefunden")

    empty = {"points": [], "elevation": []}
    planned = parse_track(planned_file) if planned_file else empty
    planned_v2 = parse_track(planned_v2_file) if planned_v2_file else empty
    ridden = parse_track(ridden_file) if ridden_file else empty

    all_points = planned["points"] + planned_v2["points"] + ridden["points"]
    if all_points:
        center = [
            round(sum(p[0] for p in all_points) / len(all_points), 6),
            round(sum(p[1] for p in all_points) / len(all_points), 6),
        ]
    else:
        center = [51.05, 13.74]

    return {
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "center": center,
        "planned": {
            "name": "Routenplanung V1",
            "color": "#1769ff",
            "dash": "long",
            "file": relative_to_data_root(planned_file) if planned_file else None,
            **planned,
        },
        "plannedV2": {
            "name": "Routenplanung V2",
            "color": "#b03090",
            "dash": "short",
            "file": relative_to_data_root(planned_v2_file) if planned_v2_file else None,
            **planned_v2,
        },
        "ridden": {
            "name": "Mit dem Fahrrad evaluiert",
            "color": "#008f5d",
            "dash": "none",
            "file": relative_to_data_root(ridden_file) if ridden_file else None,
            **ridden,
        },
    }


def main() -> int:
    payload = build()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    for key, label in (("planned", "V1"), ("plannedV2", "V2"), ("ridden", "Evaluiert")):
        route = payload[key]
        if route["file"]:
            print(f"{label}: {route['file']} ({len(route['points'])} Punkte)")
        else:
            print(f"{label}: keine Datei gefunden")
    print(f"Geschrieben: {OUTPUT_FILE} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
