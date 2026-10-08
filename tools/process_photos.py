"""Fotos aus fotos-upload/ verarbeiten und in docs/fotos.json eintragen.

Für jedes Foto im Upload-Ordner:
- GPS-Position und Aufnahmezeit aus den EXIF-Daten lesen,
- prüfen, ob es nahe der Strecke liegt (Route, Straßenbahn Linie 7 oder Fußweg),
- verkleinerte Fassungen ohne Metadaten nach docs/fotos/ schreiben,
- den Eintrag in docs/fotos.json ergänzen.

Fotos ohne GPS bleiben im Upload-Ordner liegen (sie enthalten keine Position) – außer ihre Position
steht in fotos-upload/positionen.json, z. B. für Fotos anderer, deren Metadaten verloren gingen:
  {"datei.jpg": {"km": 17.15, "date": "2026-10-07", "between": ["14:41", "14:52"], "credit": "Name"}}
("credit" ist optional; erledigte Einträge werden aus der Datei entfernt.)
Fotos weit abseits der Strecke werden gelöscht und nicht veröffentlicht.
Ein Bericht geht nach stdout und, in GitHub Actions, in die Job-Zusammenfassung.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "fotos-upload"
OUT_DIR = ROOT / "docs" / "fotos"
INDEX_FILE = ROOT / "docs" / "fotos.json"
POSITIONS_FILE = UPLOAD_DIR / "positionen.json"
DATA_FILE = ROOT / "docs" / "data.json"

MAX_DISTANCE_M = 250
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SIZES = {"full": 1600, "thumb": 600}
PIN_SIZE = 160

GPS_IFD = 0x8825
EXIF_IFD = 0x8769
TAG_DATETIME_ORIGINAL = 36867
TAG_OFFSET_TIME_ORIGINAL = 36881
TAG_DATETIME = 306


def to_degrees(value, ref) -> float | None:
    try:
        d, m, s = (float(v) for v in value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if any(math.isnan(v) for v in (d, m, s)):
        return None
    deg = d + m / 60 + s / 3600
    return -deg if ref in ("S", "W") else deg


def read_gps(exif) -> list[float] | None:
    gps = exif.get_ifd(GPS_IFD)
    if not gps:
        return None
    lat = to_degrees(gps.get(2), gps.get(1))
    lon = to_degrees(gps.get(4), gps.get(3))
    # Android ersetzt die Position beim Weitergeben oft durch Nullen.
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None
    return [round(lat, 6), round(lon, 6)]


def read_time(exif) -> str | None:
    sub = exif.get_ifd(EXIF_IFD)
    raw = sub.get(TAG_DATETIME_ORIGINAL) or exif.get(TAG_DATETIME)
    if not raw:
        return None
    try:
        dt = datetime.strptime(str(raw).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    offset = str(sub.get(TAG_OFFSET_TIME_ORIGINAL) or "").strip("\x00 ")
    return dt.isoformat() + (offset if re.fullmatch(r"[+-]\d\d:\d\d", offset) else "")


class Track:
    """Polylinie in lokalen Metern für Abstand und Streckenkilometer."""

    def __init__(self, points: list[list[float]], lat0: float, total_km: float | None = None):
        k = 6371000 * math.pi / 180
        self.kx, self.ky = k * math.cos(math.radians(lat0)), k
        self.xy = [(p[1] * self.kx, p[0] * self.ky) for p in points]
        self.cum = [0.0]
        for a, b in zip(self.xy, self.xy[1:]):
            self.cum.append(self.cum[-1] + math.dist(a, b))
        self.scale = (total_km * 1000 / self.cum[-1]) if total_km and self.cum[-1] else 1.0

    def point_at(self, km: float) -> list[float]:
        """Koordinate beim Streckenkilometer km."""
        target = km * 1000 / self.scale
        i = next((j for j in range(1, len(self.cum)) if self.cum[j] >= target), len(self.cum) - 1)
        span = self.cum[i] - self.cum[i - 1]
        f = 0.0 if span == 0 else (target - self.cum[i - 1]) / span
        (ax, ay), (bx, by) = self.xy[i - 1], self.xy[i]
        return [round((ay + f * (by - ay)) / self.ky, 6), round((ax + f * (bx - ax)) / self.kx, 6)]

    def locate(self, latlng: list[float]) -> tuple[float, float]:
        """Abstand in m und Streckenkilometer des nächstgelegenen Punkts."""
        px, py = latlng[1] * self.kx, latlng[0] * self.ky
        best = (math.inf, 0.0)
        for i, ((ax, ay), (bx, by)) in enumerate(zip(self.xy, self.xy[1:])):
            dx, dy = bx - ax, by - ay
            seg = dx * dx + dy * dy
            t = 0.0 if seg == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d < best[0]:
                best = (d, (self.cum[i] + t * math.sqrt(seg)) * self.scale / 1000)
        return best


class MultiTrack:
    """Mehrere Teilstücke (z. B. alle Gleisabschnitte von Linie 7) als eine Strecke."""

    def __init__(self, parts: list[Track]):
        self.parts = parts

    def locate(self, latlng: list[float]) -> tuple[float, float]:
        return min(part.locate(latlng) for part in self.parts)


def load_tracks() -> dict[str, Track | MultiTrack]:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    route = data["route"]
    lat0 = route["points"][0][0]
    return {
        "route": Track(route["points"], lat0, route["km"]),
        # Ganze Linie 7, nicht nur die geplante Fahrt – Einstieg kann abweichen.
        "tram": MultiTrack(
            [Track(data["tram"]["ride"]["line"], lat0)]
            + [Track(seg, lat0) for seg in data["tram"]["segs"] if len(seg) > 1]
        ),
        "walk": Track(data["walk"]["line"], lat0),
    }


def save_variants(img: Image.Image, photo_id: str) -> dict[str, str]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    names = {}
    for key, size in SIZES.items():
        copy = img.copy()
        copy.thumbnail((size, size))
        name = f"{photo_id}.jpg" if key == "full" else f"{photo_id}_{key}.jpg"
        copy.save(OUT_DIR / name, quality=82, optimize=True, progressive=True)  # ohne EXIF
        names[key] = f"fotos/{name}"
    pin = ImageOps.fit(img, (PIN_SIZE, PIN_SIZE), Image.LANCZOS)
    pin.save(OUT_DIR / f"{photo_id}_pin.jpg", quality=85, optimize=True)
    names["pin"] = f"fotos/{photo_id}_pin.jpg"
    return names


def main() -> int:
    index = json.loads(INDEX_FILE.read_text(encoding="utf-8")) if INDEX_FILE.exists() else []
    known = {entry["id"] for entry in index}
    tracks = load_tracks()
    report: list[str] = []
    positions = json.loads(POSITIONS_FILE.read_text(encoding="utf-8")) if POSITIONS_FILE.exists() else {}

    uploads = sorted(p for p in UPLOAD_DIR.glob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)
    for path in uploads:
        raw = path.read_bytes()
        photo_id = hashlib.sha1(raw).hexdigest()[:12]
        if photo_id in known:
            path.unlink()
            report.append(f"- `{path.name}`: bereits veröffentlicht, Upload entfernt")
            continue

        with Image.open(path) as opened:
            exif = opened.getexif()
            latlng = read_gps(exif)
            taken_at = read_time(exif)
            img = ImageOps.exif_transpose(opened).convert("RGB")

        if latlng is None and path.name in positions:
            manual = positions.pop(path.name)
            entry = {
                "id": photo_id,
                **save_variants(img, photo_id),
                "takenAt": None,
                "date": manual.get("date"),
                "between": manual.get("between"),
                "sortAt": f"{manual.get('date')}T{(manual.get('between') or ['00:00'])[0]}:59",
                "latlng": tracks["route"].point_at(manual["km"]),
                "section": "route",
                "km": manual["km"],
                "manual": True,
            }
            if manual.get("credit"):
                entry["credit"] = manual["credit"]
            index.append(entry)
            known.add(photo_id)
            path.unlink()
            report.append(f"- `{path.name}`: veröffentlicht (km {manual['km']:.1f}, Position von Hand zugeordnet)")
            continue

        if latlng is None:
            report.append(f"- `{path.name}`: **keine GPS-Position** – nicht veröffentlicht, bleibt im Upload-Ordner")
            continue

        where = {name: track.locate(latlng) for name, track in tracks.items()}
        section, (distance, km) = min(where.items(), key=lambda item: item[1][0])
        if distance > MAX_DISTANCE_M:
            path.unlink()
            report.append(
                f"- `{path.name}`: **{distance / 1000:.1f} km abseits der Strecke** – nicht veröffentlicht, Upload gelöscht"
            )
            continue

        entry = {
            "id": photo_id,
            **save_variants(img, photo_id),
            "takenAt": taken_at,
            "latlng": latlng,
            "section": section,
        }
        if section == "route":
            entry["km"] = round(where["route"][1], 2)
        index.append(entry)
        known.add(photo_id)
        path.unlink()
        detail = f"km {entry['km']:.1f}" if section == "route" else section
        report.append(f"- `{path.name}`: veröffentlicht ({detail}, {distance:.0f} m von der Strecke)")

    if POSITIONS_FILE.exists():
        if positions:
            POSITIONS_FILE.write_text(json.dumps(positions, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        else:
            POSITIONS_FILE.unlink()

    index.sort(key=lambda e: e.get("takenAt") or e.get("sortAt") or "")
    INDEX_FILE.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    text = "\n".join(["## Fotos von unterwegs", *(report or ["- keine neuen Fotos"])])
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
