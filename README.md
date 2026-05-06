# Rosees Roboterreise – Routenkarte

Statische Webseite mit der geplanten und der tatsächlich gefahrenen Route von Freiberg nach Dresden. Pro Track lässt sich ein Höhenprofil ein- und ausblenden.

Live: https://sebastianzug.github.io/RoseesRoboterReise/

## Aufbau

- `docs/` – statische Site (von GitHub Pages ausgeliefert)
  - `index.html`, `app.js`, `style.css` – Karte (Leaflet) + Höhenprofile (Chart.js)
  - `data.json` – generiert aus den GPX-Quellen
- `build.py` – liest die GPX-Dateien und schreibt `docs/data.json`

## Daten neu generieren

```bash
uv sync
uv run python build.py
```

Datenquelle ist standardmäßig `/home/sz/Nextcloud/2025-09-19-Freiberg nach Dresden/` und kann per Umgebungsvariable überschrieben werden:

```bash
ROBOT_ROUTE_DATA_DIR="/anderer/pfad" uv run python build.py
```

`build.py` wählt aus den gefundenen GPX-Dateien per Heuristik je eine geplante und eine gefahrene Route aus (Schlagwörter im Dateinamen, neuester Auswertungs-Ordner als Tiebreaker).

## Deployment

GitHub Pages ist auf `main` / Ordner `/docs` konfiguriert. Nach jeder Änderung:

```bash
uv run python build.py    # docs/data.json aktualisieren
git add docs/data.json
git commit -m "Routendaten aktualisiert"
git push
```
