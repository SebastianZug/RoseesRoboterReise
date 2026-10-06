const ROUTE_COLOR = "#1769ff";
const TRAM_COLOR = "#7b3fa0";
const TRAM_LIGHT = "#bfa3d1";
const DEFAULT_START = "07:30";
const DEFAULT_SPEED = 5; // km/h

async function loadData() {
  const response = await fetch("data.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data.json laden fehlgeschlagen: ${response.status}`);
  return response.json();
}

function formatKm(km) {
  return `${km.toFixed(1).replace(".", ",")} km`;
}

function formatClock(minutes) {
  const m = Math.round(minutes) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function parseClock(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

// Kumulierte Distanz je Routenpunkt, skaliert auf die Länge des unvereinfachten Tracks.
function cumulativeKm(points, totalKm) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + L.latLng(points[i - 1]).distanceTo(points[i]) / 1000);
  }
  const scale = totalKm / cum[cum.length - 1];
  return cum.map((d) => d * scale);
}

function pointAtKm(points, cum, km) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < km) i++;
  const f = cum[i] === cum[i - 1] ? 0 : (km - cum[i - 1]) / (cum[i] - cum[i - 1]);
  const [a, b] = [points[i - 1], points[i]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function nearestIndex(points, latlng) {
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = latlng.distanceTo(p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Uhrzeit-Marken alle 30 min entlang der Route; volle Stunden dauerhaft beschriftet.
function renderSchedule(layer, route, cum, schedule, boarding) {
  layer.clearLayers();
  const { start, speed } = schedule;
  if (!(speed > 0) || Number.isNaN(start)) return;
  const totalMin = (route.km / speed) * 60;

  for (let clock = Math.floor(start / 30) * 30 + 30; clock < start + totalMin; clock += 30) {
    const km = ((clock - start) / 60) * speed;
    const fullHour = clock % 60 === 0;
    L.circleMarker(pointAtKm(route.points, cum, km), {
      radius: fullHour ? 6 : 4,
      weight: 2,
      color: "#1f1f1e",
      fillColor: fullHour ? "#ffd23f" : "#ffffff",
      fillOpacity: 1,
    })
      .bindTooltip(fullHour ? formatClock(clock) : `ca. ${formatClock(clock)} · km ${km.toFixed(1).replace(".", ",")}`, {
        permanent: fullHour,
        direction: "top",
        className: fullHour ? "time-label" : "",
      })
      .addTo(layer);
  }

  const startLabel = `Start ${formatClock(start)}`;
  L.tooltip({ permanent: true, direction: "bottom", offset: [0, 10], className: "time-label" })
    .setLatLng(route.points[0])
    .setContent(startLabel)
    .addTo(layer);

  if (boarding) {
    const at = start + (cum[boarding.index] / speed) * 60;
    L.tooltip({ permanent: true, direction: "bottom", className: "time-label" })
      .setLatLng(route.points[boarding.index])
      .setContent(`ca. ${formatClock(at)} an ${boarding.name}`)
      .addTo(layer);
  }

  L.tooltip({ permanent: true, direction: "right", className: "time-label" })
    .setLatLng(route.points[route.points.length - 1])
    .setContent(`Trackende ca. ${formatClock(start + totalMin)}`)
    .addTo(layer);
}

function drawRoute(map, route, cum, schedule) {
  const layer = L.layerGroup();
  if (!route.points || route.points.length < 2) return layer;
  L.polyline(route.points, { color: "#ffffff", weight: 8, opacity: 0.8, interactive: false }).addTo(layer);
  const line = L.polyline(route.points, { color: ROUTE_COLOR, weight: 4, opacity: 0.95 })
    .bindTooltip(`${route.name} · ${formatKm(route.km)}`, { sticky: true })
    .addTo(layer);
  line.on("mousemove", (e) => {
    const km = cum[nearestIndex(route.points, e.latlng)];
    const at = schedule.speed > 0 ? ` · ca. ${formatClock(schedule.start + (km / schedule.speed) * 60)}` : "";
    line.setTooltipContent(`${route.name} · km ${km.toFixed(1).replace(".", ",")}${at}`);
  });

  const last = route.points[route.points.length - 1];
  L.circleMarker(last, { radius: 8, weight: 3, color: "#ffffff", fillColor: "#1f1f1e", fillOpacity: 1 })
    .bindTooltip("Ende Robotertrack", { direction: "right" })
    .addTo(layer);
  return layer.addTo(map);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function placeCard(label, place) {
  const logos = place.logos.map((src) => `<img src="${escapeHtml(src)}" alt="" />`).join("");
  return (
    `<div class="place-card"><div class="place-logos">${logos}</div>` +
    `<strong>${escapeHtml(label)}: ${escapeHtml(place.name)}</strong>` +
    `<span>${escapeHtml(place.address)}</span></div>`
  );
}

// Start- und Zielort mit Logos sowie Fußweg von der Ausstiegshaltestelle zum Ziel.
function drawPlaces(map, places, walk) {
  const layer = L.layerGroup();
  L.polyline(walk.line, { color: "#1f1f1e", weight: 3, opacity: 0.85, dashArray: "2, 6" })
    .bindTooltip(`Fußweg ${walk.from} – ${walk.to} (ca. ${walk.m} m)`, { sticky: true })
    .addTo(layer);

  [
    ["Start", places.start, "#0ca30c", "left"],
    ["Ziel", places.goal, "#e5007d", "top"],
  ].forEach(([label, place, color, direction]) => {
    L.circleMarker(place.latlng, { radius: 9, weight: 3, color: "#ffffff", fillColor: color, fillOpacity: 1 })
      .bindTooltip(placeCard(label, place), {
        permanent: true,
        direction,
        offset: direction === "top" ? [0, -8] : [-8, 0],
        className: "place-tooltip",
        opacity: 1,
      })
      .addTo(layer);
  });
  return layer.addTo(map);
}

function drawTram(map, tram) {
  map.createPane("tram").style.zIndex = 350; // unter der Route
  const renderer = L.svg({ pane: "tram" });
  const ride = tram.ride;
  const opts = { pane: "tram", renderer, interactive: false };

  const network = L.layerGroup();
  L.polyline(tram.segs, { ...opts, color: TRAM_LIGHT, weight: 4, opacity: 0.9 }).addTo(network);

  const rideLayer = L.layerGroup();
  L.polyline(ride.line, { ...opts, color: "#ffffff", weight: 11, opacity: 0.9 }).addTo(rideLayer);
  L.polyline(ride.line, { ...opts, color: TRAM_COLOR, weight: 7, opacity: 1 }).addTo(rideLayer);

  tram.stops.forEach(([lat, lon, name]) => {
    const isEnd = name === ride.from || name === ride.to;
    const marker = L.circleMarker([lat, lon], {
      pane: "tram",
      renderer,
      radius: isEnd ? 7 : 4,
      weight: isEnd ? 3 : 2,
      color: TRAM_COLOR,
      fillColor: isEnd ? "#ffd23f" : "#ffffff",
      fillOpacity: 1,
    });
    if (isEnd) {
      const label = name === ride.from ? "Einstieg" : "Ausstieg";
      marker.bindTooltip(`${label}: ${name}`, {
        permanent: true,
        direction: name === ride.from ? "left" : "right",
      }).addTo(rideLayer);
    } else {
      marker.bindTooltip(`Linie 7: ${name}`, { direction: "top" }).addTo(network);
    }
  });

  return { network: network.addTo(map), ride: rideLayer.addTo(map) };
}

function buildLegend(map, entries) {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  entries.forEach(({ label, color, thick, dashed, layer }) => {
    const row = document.createElement("label");
    row.className = "legend-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) layer.addTo(map);
      else map.removeLayer(layer);
    });

    const swatch = document.createElement("span");
    swatch.className = `swatch${thick ? " thick" : ""}${dashed ? " dashed" : ""}`;
    swatch.style.background = color;
    swatch.style.color = color;

    const name = document.createElement("span");
    name.textContent = label;

    row.append(checkbox, swatch, name);
    el.appendChild(row);
  });
}

function buildScheduleControls(map, layer, schedule, refresh) {
  const row = document.createElement("div");
  row.className = "legend-row schedule";

  const toggle = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) layer.addTo(map);
    else map.removeLayer(layer);
  });
  toggle.append(checkbox, " Zeitplan");

  const start = document.createElement("input");
  start.type = "time";
  start.value = DEFAULT_START;
  start.title = "Startzeit in Freiberg";

  const speed = document.createElement("input");
  speed.type = "number";
  speed.min = "0.5";
  speed.max = "30";
  speed.step = "0.5";
  speed.value = String(DEFAULT_SPEED);
  speed.title = "Durchschnittsgeschwindigkeit";

  const update = () => {
    schedule.start = parseClock(start.value || DEFAULT_START);
    schedule.speed = parseFloat(speed.value);
    refresh();
  };
  start.addEventListener("change", update);
  speed.addEventListener("change", update);

  row.append(toggle, "ab", start, "mit", speed, "km/h");
  document.getElementById("legend").appendChild(row);
}

// Foto des Roboters als einklappbare Karte unten rechts.
function addRobotPhoto(map) {
  const control = L.control({ position: "bottomright" });
  control.onAdd = () => {
    const el = L.DomUtil.create("figure", "robot-photo");
    el.innerHTML =
      '<button type="button" class="robot-photo-toggle" aria-expanded="true">Rosee ausblenden</button>' +
      '<a href="rosee.jpg" target="_blank" rel="noopener" title="Foto in voller Größe öffnen">' +
      '<img src="rosee_vorschau.jpg" alt="Roboter Rosee mit roter Fahne auf einem Feldweg" /></a>' +
      "<figcaption>So sieht Rosee aus – unterwegs auf einem Feldweg</figcaption>";
    const toggle = el.querySelector(".robot-photo-toggle");
    toggle.addEventListener("click", () => {
      const collapsed = el.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "Foto von Rosee" : "Rosee ausblenden";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    return el;
  };
  control.addTo(map);
}

function setMeta(state) {
  const parts = [];
  if (state.generatedAt) {
    parts.push(`Stand: ${new Date(state.generatedAt).toLocaleDateString("de-DE")}`);
  }
  parts.push(`Route: ${state.route.file}`);
  parts.push(`Linie 7: ${state.tram.file} (Geometrie © OpenStreetMap-Mitwirkende, ODbL)`);
  document.getElementById("meta").textContent = parts.join(" · ");
}

async function main() {
  let state;
  try {
    state = await loadData();
  } catch (error) {
    document.getElementById("map").textContent = `Daten konnten nicht geladen werden: ${error.message}`;
    return;
  }

  const map = L.map("map");
  const baseLayers = {
    OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    "Satellit (Esri)": L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery &copy; Esri" },
    ),
  };
  baseLayers.OpenStreetMap.addTo(map);
  L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const schedule = { start: parseClock(DEFAULT_START), speed: DEFAULT_SPEED };
  const cum = cumulativeKm(state.route.points, state.route.km);
  const tram = drawTram(map, state.tram);
  const route = drawRoute(map, state.route, cum, schedule);
  const places = drawPlaces(map, state.places, state.walk);

  const ride = state.tram.ride;
  const boardingStop = state.tram.stops.find((s) => s[2] === ride.from);
  const boarding = boardingStop && {
    name: ride.from,
    index: nearestIndex(state.route.points, L.latLng(boardingStop[0], boardingStop[1])),
  };
  const scheduleLayer = L.layerGroup();
  const refreshSchedule = () => renderSchedule(scheduleLayer, state.route, cum, schedule, boarding);
  refreshSchedule();

  buildLegend(map, [
    { label: `${state.route.name} (${formatKm(state.route.km)})`, color: ROUTE_COLOR, layer: route },
    {
      label: `Bahnfahrt Linie 7: ${ride.from} – ${ride.to} (${formatKm(ride.km)})`,
      color: TRAM_COLOR,
      thick: true,
      layer: tram.ride,
    },
    { label: "übrige Linie 7", color: TRAM_LIGHT, layer: tram.network },
    { label: `Start/Ziel und Fußweg (${state.walk.m} m)`, color: "#1f1f1e", dashed: true, layer: places },
  ]);
  buildScheduleControls(map, scheduleLayer, schedule, refreshSchedule);

  const bounds = L.latLngBounds(state.route.points)
    .extend(L.latLngBounds(ride.line))
    .extend(state.places.start.latlng)
    .extend(state.places.goal.latlng);
  map.fitBounds(bounds.pad(0.05));

  addRobotPhoto(map);
  setMeta(state);
}

main();
