# Rosees Roboterreise – Routenkarte

Statische Webseite mit der finalen Route von Freiberg nach Dresden und der Straßenbahnfahrt mit Linie 7 (Altnossener Straße – Bischofsweg) in Dresden.

Live: https://sebastianzug.github.io/RoseesRoboterReise/

## Aufbau

- `docs/` – statische Site (von GitHub Pages ausgeliefert)
  - `index.html`, `app.js`, `style.css` – Karte (Leaflet)
  - `data.json` – generiert aus den Quelldateien in `sources/`
  - `logos/` – TU Bergakademie Freiberg, RoboLab (Start) und 4transfer (Ziel)
- `sources/` – Kartenexporte als Datenquelle
  - `20261005_FG_DD_corrected.html` – finale Route
  - `20260930_103443_FG_DD_enhanced.html` – Linie 7 (OSM-Relation 1894481) und geplante Bahnfahrt
  - `fussweg_bischofsweg_4transferlab.json` – Fußweg von der Haltestelle Bischofsweg zum 4transferLab (OSRM, OSM-Daten)
- `build.py` – enthält Start (RoboLab, Burgstraße 36) und Ziel (4transferLab, Fritz-Reuter-Straße 1), liest die Quellen und schreibt `docs/data.json` (Route vereinfacht auf 1 m Toleranz)
- `archive/` – frühere Entwürfe (Routenplanung V1/V2, Fahrrad-Evaluierung)

## Daten neu generieren

```bash
uv run python build.py
```

Bei einer neuen Route die Datei in `sources/` ablegen und `ROUTE_FILE` bzw. `TRAM_FILE` in `build.py` anpassen.

## Deployment

GitHub Pages ist auf `main` / Ordner `/docs` konfiguriert. Nach jeder Änderung:

```bash
uv run python build.py    # docs/data.json aktualisieren
git add docs/data.json
git commit -m "Routendaten aktualisiert"
git push
```
