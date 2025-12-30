// js/mapainfo.js  (NUEVO - versión modular, completa, con fitBounds correcto)
// GeoEVA - Detalle de proximidad + panel + gráficos + Export KMZ
//
// ✅ Requisitos en mapainfo.html (orden):
// 1) Leaflet
// 2) XLSX
// 3) Plotly
// 4) JSZip
// 5) graficos.js  (define window.initCharts si aplica)
// 6) mapainfo.js  (ESTE como módulo)
//
// ⚠️ mapainfo.html debe cargar este archivo así:
// <script type="module" src="js/mapainfo.js"></script>

import { loadProyectosXlsx } from "./core/dataLoader.js";
import { runProximityEngine } from "./features/proximity/proximityEngine.js";
import { buildReportModel } from "./report/reportModel.js";
import { createMapLayers } from "./ui/mapLayers.js";
import { createProjectsPanel } from "./ui/panel.js";
import { updateCharts } from "./ui/chartsController.js";
import { downloadProximityKMZ } from "./export/kmzExport.js";
import { formatMMU } from "./core/utils.js";

// ===========================
// Config
// ===========================
const DATA_XLSX_URL = "capas/nacional.xlsx";

// ===========================
// URL params
// ===========================
function getUrlParamFloat(name) {
  const v = new URLSearchParams(window.location.search).get(name);
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function getUrlParamInt(name) {
  const v = new URLSearchParams(window.location.search).get(name);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function getUrlParamStr(name, fallback = "") {
  const v = new URLSearchParams(window.location.search).get(name);
  return v == null ? fallback : String(v);
}

// lat/lng (tu estándar)
const consultaLat = getUrlParamFloat("lat") ?? -27.5;
const consultaLng = getUrlParamFloat("lng") ?? -70.25;
const modoRaw = (getUrlParamStr("modo", "proximidad") || "proximidad").toLowerCase();
const n = getUrlParamInt("n") ?? 10;
const radioKm = getUrlParamFloat("radio") ?? 10;

// ===========================
// DOM refs (mapainfo.html actual)
// ===========================
const elCoords = document.getElementById("coordsLabel");
const elModo = document.getElementById("modoLabel");
const elRadio = document.getElementById("radioLabel");
const elCount = document.getElementById("countLabel");
const elInv = document.getElementById("invLabel");
const btnKmz = document.getElementById("btnKmz");

// Panel
const panelToggle = document.getElementById("panelToggle");
const projectsPanel = document.getElementById("projectsPanel");

// ===========================
// Estado
// ===========================
let map = null;
let mapLayers = null;
let panel = null;
let model = null; // reportModel actual (para KMZ)

// ===========================
// Basemap prefs (heredadas de index.html)
// ===========================
function readBasemapPrefs() {
  try {
    const raw = localStorage.getItem("geoeva_basemap");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function initMap() {
  map = L.map("map", {
    center: [consultaLat, consultaLng],
    zoom: 11,
    minZoom: 4,
    zoomControl: true,
  });

  const prefs = readBasemapPrefs() || {
    addOSM: true,
    osmOpacity: 1.0,
    addIMG: true,
    imgOpacity: 0.1,
  };

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    opacity: Math.max(0, Math.min(1, Number(prefs.osmOpacity ?? 1))),
    attribution: "&copy; OpenStreetMap contributors",
  });

  const img = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      opacity: Math.max(0, Math.min(1, Number(prefs.imgOpacity ?? 0.1))),
    }
  );

  if (prefs.addOSM !== false) osm.addTo(map);
  if (prefs.addIMG !== false) img.addTo(map);

  L.control.scale().addTo(map);

  mapLayers = createMapLayers(map);

  // Invalidate por layout con aspect-ratio
  setTimeout(() => map.invalidateSize(), 150);
}

// ===========================
// UI: info-bar
// ===========================
function setInfoBarFromModel(m) {
  const q = m.query;
  const total = m.stats.totalProjects ?? m.projects.length;

  if (elCoords) elCoords.textContent = `Punto: lat ${q.lat.toFixed(6)}, lng ${q.lng.toFixed(6)}`;
  if (elModo) {
    elModo.textContent =
      `Modo: ${q.modo === "proximidad" ? "Proximidad (Top N aprobados)" : "Radio fijo"}`;
  }
  if (elRadio) elRadio.textContent = `Radio: ${Number.isFinite(q.radioKmFinal) ? q.radioKmFinal.toFixed(2) : "—"} km`;

  const invTotal = Number.isFinite(m.stats.invTotal) ? m.stats.invTotal : 0;

  if (elCount) {
    const a = m.stats?.counts?.Aprob ?? 0;
    const c = m.stats?.counts?.Calif ?? 0;
    const r = m.stats?.counts?.Rech ?? 0;
    const o = m.stats?.counts?.Otros ?? 0;
    elCount.textContent = `Resumen: ${total} (Aprob ${a} / Calif ${c} / Rech ${r} / Otros ${o})`;
  }

  if (elInv) elInv.textContent = `Inversión: ${formatMMU(invTotal)}`;
}

// ===========================
// UI: panel collapse
// ===========================
function initPanelCollapse() {
  if (!panelToggle || !projectsPanel) return;

  panelToggle.addEventListener("click", (e) => {
    e.preventDefault();
    projectsPanel.classList.toggle("collapsed");
    setTimeout(() => map?.invalidateSize(), 200);
  });
}

// ===========================
// Main
// ===========================
async function main() {
  // 1) init map + UI hooks
  initMap();

  panel = createProjectsPanel({
    containerId: "panelContent",
    countId: "panelCount",
    onSelectProject: (id) => {
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

  initPanelCollapse();

  // 2) Cargar proyectos (perfil completo)
  let proyectos = [];
  try {
    proyectos = await loadProyectosXlsx(DATA_XLSX_URL, "mapainfo");
  } catch (err) {
    console.error("❌ Error cargando XLSX:", err);
    alert("No se pudo cargar el Excel de proyectos. Revisa la consola.");
    return;
  }

  // 3) Engine (punto -> puntos)
  let engineOutput = null;
  try {
    engineOutput = runProximityEngine({
      projects: proyectos,
      center: { lat: consultaLat, lng: consultaLng },
      modo: modoRaw === "radio" ? "radio" : "proximidad",
      radioKm,
      n,
    });
  } catch (err) {
    console.error("❌ Error en proximityEngine:", err);
    alert("Error al calcular proximidad. Revisa la consola.");
    return;
  }

  // 4) Modelo estándar (para UI + export)
  model = buildReportModel({
    engineOutput,
    meta: {
      sourceXlsx: DATA_XLSX_URL,
      generatedAt: new Date().toISOString(),
    },
  });

  // Debug opcional
  window.__geoeva_model = model;

  // 5) UI: info-bar
  setInfoBarFromModel(model);

  // 6) Map layers: punto + círculo + markers
  const radioFinal = Number.isFinite(model.query.radioKmFinal) && model.query.radioKmFinal > 0
    ? model.query.radioKmFinal
    : radioKm;

  mapLayers.setQueryPoint(model.query.lat, model.query.lng);
  mapLayers.setQueryCircle(model.query.lat, model.query.lng, radioFinal);

  mapLayers.renderProjects(model.projects, {
    onMarkerClick: (id) => {
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

  // ✅ FIT BOUNDS CORRECTO: usar el círculo REAL (no uno temporal)
  // Requiere que ui/mapLayers.js exponga getQueryCircleBounds()
  const bounds = typeof mapLayers.getQueryCircleBounds === "function"
    ? mapLayers.getQueryCircleBounds()
    : null;

  if (bounds) {
    map.fitBounds(bounds, { padding: [20, 20] });
  } else {
    map.setView([model.query.lat, model.query.lng], 12);
  }

  // 7) Panel list
  panel.render(model.projects);

  // 8) Charts (si graficos.js expone initCharts)
  updateCharts(model);

  // 9) Export KMZ (botón + compat global)
  const doKmz = async () => {
    if (!model) return;
    try {
      await downloadProximityKMZ({ model });
    } catch (err) {
      console.error("❌ Error exportando KMZ:", err);
      alert("No se pudo exportar KMZ. Revisa la consola.");
    }
  };

  // Compat: si el HTML aún tiene onclick
  window.downloadProximityKMZ = doKmz;

  if (btnKmz) {
    btnKmz.disabled = false;
    btnKmz.addEventListener("click", (e) => {
      e.preventDefault();
      doKmz();
    });
  }
}

// ===========================
// Start
// ===========================
document.addEventListener("DOMContentLoaded", () => {
  main().catch((err) => {
    console.error("❌ Error fatal en mapainfo.js:", err);
    alert("Error fatal. Revisa la consola.");
  });
});
