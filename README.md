# Rosees Roboterreise – Routenkarte

Statische Webseite mit der finalen Route von Freiberg nach Dresden und der Straßenbahnfahrt mit Linie 7 (Altnossener Straße – Bischofsweg) in Dresden.

Live: https://sebastianzug.github.io/RoseesRoboterReise/

## Aufbau

- `docs/` – statische Site (von GitHub Pages ausgeliefert)
  - `index.html`, `app.js`, `style.css` – Karte (Leaflet)
  - `data.json` – generiert aus den Quelldateien in `sources/`
  - `logos/` – TU Bergakademie Freiberg, RoboLab (Start) und 4transfer (Ziel)
  - `fotos.json`, `fotos/` – Fotos von unterwegs (automatisch erzeugt, siehe unten)
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

## Fotos von unterwegs

Fotos in `fotos-upload/` hochladen (z. B. am Handy über github.com → Ordner → „Add file → Upload files“).
Die Action [`fotos.yml`](.github/workflows/fotos.yml) startet bei jedem Upload und ruft `tools/process_photos.py` auf:

- liest GPS-Position und Aufnahmezeit aus den EXIF-Daten,
- veröffentlicht nur Fotos höchstens 250 m neben Route, Bahnfahrt oder Fußweg,
- schreibt verkleinerte Fassungen ohne Metadaten nach `docs/fotos/` und trägt sie in `docs/fotos.json` ein,
- entfernt den Upload; Fotos ohne GPS bleiben liegen, Fotos abseits der Strecke werden gelöscht.

Das Ergebnis steht in der Zusammenfassung des Action-Laufs. Ein Foto wieder entfernen: Eintrag aus
`docs/fotos.json` und die drei Dateien in `docs/fotos/` löschen.

## Deployment

GitHub Pages ist auf `main` / Ordner `/docs` konfiguriert. Nach jeder Änderung:

```bash
uv run python build.py    # docs/data.json aktualisieren
git add docs/data.json
git commit -m "Routendaten aktualisiert"
git push
```
