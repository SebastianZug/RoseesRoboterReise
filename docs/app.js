const ROUTE_KEYS = ["planned", "ridden"];

async function loadData() {
  const response = await fetch("data.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`data.json laden fehlgeschlagen: ${response.status}`);
  return response.json();
}

function drawRoute(map, route, dashed) {
  if (!route.points || route.points.length < 2) return null;
  const line = L.polyline(route.points, {
    color: route.color,
    weight: 4,
    opacity: 0.88,
    dashArray: dashed ? "7, 9" : null,
  }).addTo(map);
  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  L.circleMarker(first, { radius: 5, color: route.color, fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(`${route.name}: Start`);
  L.circleMarker(last, { radius: 5, color: route.color, fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(`${route.name}: Ziel`);
  return line;
}

function buildLegend(state, charts) {
  const el = document.getElementById("legend");
  el.innerHTML = "";

  ROUTE_KEYS.forEach((key) => {
    const route = state[key];
    if (!route || !route.points || route.points.length === 0) return;

    const row = document.createElement("label");
    row.className = "legend-row";

    const swatch = document.createElement("span");
    swatch.className = "dot";
    swatch.style.background = route.color;
    if (key === "planned") swatch.classList.add("dashed");

    const name = document.createElement("span");
    name.textContent = route.name;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.routeKey = key;
    checkbox.disabled = !route.elevation || route.elevation.length < 2;
    checkbox.title = checkbox.disabled
      ? "Keine Höhendaten verfügbar"
      : "Höhenprofil ein/ausblenden";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) charts.show(key);
      else charts.hide(key);
    });

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(checkbox);
    el.appendChild(row);
  });
}

function elevationStats(profile) {
  if (!profile || profile.length === 0) return { gain: 0, loss: 0, min: 0, max: 0 };
  let gain = 0;
  let loss = 0;
  let min = profile[0].e;
  let max = profile[0].e;
  for (let i = 1; i < profile.length; i++) {
    const dE = profile[i].e - profile[i - 1].e;
    if (dE > 0) gain += dE;
    else loss -= dE;
    if (profile[i].e < min) min = profile[i].e;
    if (profile[i].e > max) max = profile[i].e;
  }
  return { gain, loss, min, max };
}

function createChartManager(state) {
  const panel = document.getElementById("elevation-panel");
  const container = document.getElementById("charts");
  const closeBtn = panel.querySelector(".elev-close");

  const wraps = new Map();
  const instances = new Map();

  function refreshPanelVisibility() {
    panel.hidden = wraps.size === 0;
  }

  function show(key) {
    if (wraps.has(key)) return;
    const route = state[key];
    if (!route || !route.elevation || route.elevation.length < 2) return;

    const wrap = document.createElement("section");
    wrap.className = "chart-block";

    const title = document.createElement("h3");
    title.textContent = route.name;

    const stats = elevationStats(route.elevation);
    const totalKm = route.elevation[route.elevation.length - 1].d;
    const meta = document.createElement("p");
    meta.className = "chart-meta";
    meta.textContent =
      `${totalKm.toFixed(1)} km · ↑ ${stats.gain.toFixed(0)} m · ↓ ${stats.loss.toFixed(0)} m · ` +
      `${stats.min.toFixed(0)}–${stats.max.toFixed(0)} m`;

    const canvas = document.createElement("canvas");
    canvas.className = "chart-canvas";

    wrap.appendChild(title);
    wrap.appendChild(meta);
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    wraps.set(key, wrap);

    const labels = route.elevation.map((p) => p.d);
    const values = route.elevation.map((p) => p.e);

    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Höhe (m)",
            data: values,
            borderColor: route.color,
            backgroundColor: route.color + "22",
            borderWidth: 1.5,
            fill: true,
            tension: 0.2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].parsed.x.toFixed(2)} km`,
              label: (item) => `${item.parsed.y.toFixed(0)} m`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Distanz (km)" },
            ticks: { font: { size: 10 } },
          },
          y: {
            title: { display: true, text: "Höhe (m)" },
            ticks: { font: { size: 10 } },
          },
        },
      },
    });
    instances.set(key, chart);
    refreshPanelVisibility();
  }

  function hide(key) {
    const wrap = wraps.get(key);
    if (wrap) {
      wrap.remove();
      wraps.delete(key);
    }
    const instance = instances.get(key);
    if (instance) {
      instance.destroy();
      instances.delete(key);
    }
    refreshPanelVisibility();
  }

  function hideAll() {
    Array.from(wraps.keys()).forEach(hide);
    document.querySelectorAll('#legend input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
  }

  closeBtn.addEventListener("click", hideAll);

  return { show, hide };
}

function setMeta(state) {
  const meta = document.getElementById("meta");
  const parts = [];
  if (state.generatedAt) {
    const dt = new Date(state.generatedAt);
    parts.push(`Stand: ${dt.toLocaleDateString("de-DE")}`);
  }
  if (state.planned && state.planned.file) parts.push(`Geplant: ${state.planned.file}`);
  if (state.ridden && state.ridden.file) parts.push(`Gefahren: ${state.ridden.file}`);
  meta.textContent = parts.join(" · ");
}

async function main() {
  let state;
  try {
    state = await loadData();
  } catch (error) {
    document.getElementById("map").textContent = `Daten konnten nicht geladen werden: ${error.message}`;
    return;
  }

  const map = L.map("map").setView(state.center, 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const plannedLine = drawRoute(map, state.planned, true);
  const riddenLine = drawRoute(map, state.ridden, false);

  const layers = [plannedLine, riddenLine].filter(Boolean);
  if (layers.length > 0) {
    const group = L.featureGroup(layers);
    map.fitBounds(group.getBounds().pad(0.05));
  }

  const layerControl = L.control.layers(null, {}, { position: "topright", collapsed: false });
  if (plannedLine) layerControl.addOverlay(plannedLine, "Geplante Route");
  if (riddenLine) layerControl.addOverlay(riddenLine, "Gefahrene Route");
  layerControl.addTo(map);

  const charts = createChartManager(state);
  buildLegend(state, charts);
  setMeta(state);
}

main();
