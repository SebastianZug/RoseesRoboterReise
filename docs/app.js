const ROUTE_COLOR = "#1769ff";
const TRAM_COLOR = "#7b3fa0";
const TRAM_LIGHT = "#bfa3d1";

async function loadData() {
  const response = await fetch("data.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data.json laden fehlgeschlagen: ${response.status}`);
  return response.json();
}

function formatKm(km) {
  return `${km.toFixed(1).replace(".", ",")} km`;
}

function drawRoute(map, route) {
  const layer = L.layerGroup();
  if (!route.points || route.points.length < 2) return layer;
  L.polyline(route.points, { color: "#ffffff", weight: 8, opacity: 0.8, interactive: false }).addTo(layer);
  L.polyline(route.points, { color: ROUTE_COLOR, weight: 4, opacity: 0.95 })
    .bindTooltip(`${route.name} · ${formatKm(route.km)}`, { sticky: true })
    .addTo(layer);

  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  L.circleMarker(first, { radius: 8, weight: 3, color: "#ffffff", fillColor: "#0ca30c", fillOpacity: 1 })
    .bindTooltip("Start: Freiberg", { permanent: true, direction: "right" })
    .addTo(layer);
  L.circleMarker(last, { radius: 8, weight: 3, color: "#ffffff", fillColor: "#1f1f1e", fillOpacity: 1 })
    .bindTooltip("Ende Robotertrack", { direction: "right" })
    .addTo(layer);
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
      marker.bindTooltip(`${label}: ${name}`, { permanent: true, direction: "left" }).addTo(rideLayer);
    } else {
      marker.bindTooltip(`Linie 7: ${name}`, { direction: "top" }).addTo(network);
    }
  });

  return { network: network.addTo(map), ride: rideLayer.addTo(map) };
}

function buildLegend(map, entries) {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  entries.forEach(({ label, color, thick, layer }) => {
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
    swatch.className = thick ? "swatch thick" : "swatch";
    swatch.style.background = color;

    const name = document.createElement("span");
    name.textContent = label;

    row.append(checkbox, swatch, name);
    el.appendChild(row);
  });
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

  const tram = drawTram(map, state.tram);
  const route = drawRoute(map, state.route);

  const ride = state.tram.ride;
  buildLegend(map, [
    { label: `${state.route.name} (${formatKm(state.route.km)})`, color: ROUTE_COLOR, layer: route },
    {
      label: `Bahnfahrt Linie 7: ${ride.from} – ${ride.to} (${formatKm(ride.km)})`,
      color: TRAM_COLOR,
      thick: true,
      layer: tram.ride,
    },
    { label: "übrige Linie 7", color: TRAM_LIGHT, layer: tram.network },
  ]);

  const bounds = L.latLngBounds(state.route.points).extend(L.latLngBounds(ride.line));
  map.fitBounds(bounds.pad(0.05));

  setMeta(state);
}

main();
