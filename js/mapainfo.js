// js/mapainfo.js (modular, con orquestación más limpia)
// Requiere: <script type="module" src="js/mapainfo.js"></script>

import { loadProyectosXlsx } from "./core/dataLoader.js";
import { runProximityEngine } from "./features/proximity/proximityEngine.js";
import { buildReportModel } from "./report/reportModel.js";
import { createMapLayers } from "./ui/mapLayers.js";
import { createProjectsPanel } from "./ui/panel.js";
import { updateCharts } from "./ui/chartsController.js";
import { downloadProximityKMZ } from "./export/kmzExport.js";

import { getMapainfoParamsFromUrl } from "./app/router.js";
import { renderInfoBar } from "./ui/infoBar.js";
import { bindKmzButton } from "./ui/actions.js";

// -------------------
// Config
// -------------------
const DATA_XLSX_URL = "capas/nacional.xlsx";

// -------------------
// State
// -------------------
let map = null;
let mapLayers = null;
let panel = null;
let model = null;

// -------------------
// Basemap prefs (desde index.html)
// -------------------
function readBasemapPrefs() {
  try {
    const raw = localStorage.getItem("geoeva_basemap");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// -------------------
// Map init
// -------------------
function initMap({ lat, lng }) {
  map = L.map("map", { center: [lat, lng], zoom: 11, minZoom: 4, zoomControl: true });

  const prefs = readBasemapPrefs() || { addOSM: true, osmOpacity: 1.0, addIMG: true, imgOpacity: 0.1 };

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    opacity: Math.max(0, Math.min(1, Number(prefs.osmOpacity ?? 1))),
    attribution: "&copy; OpenStreetMap contributors",
  });

  const img = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: Math.max(0, Math.min(1, Number(prefs.imgOpacity ?? 0.1))) }
  );

  if (prefs.addOSM !== false) osm.addTo(map);
  if (prefs.addIMG !== false) img.addTo(map);

  L.control.scale().addTo(map);

  mapLayers = createMapLayers(map);
  setTimeout(() => map.invalidateSize(), 150);
}

// -------------------
// Panel collapse
// -------------------
function initPanelCollapse() {
  const panelToggle = document.getElementById("panelToggle");
  const projectsPanel = document.getElementById("projectsPanel");
  if (!panelToggle || !projectsPanel) return;

  panelToggle.addEventListener("click", (e) => {
    e.preventDefault();
    projectsPanel.classList.toggle("collapsed");
    setTimeout(() => map?.invalidateSize(), 200);
  });
}

// -------------------
// Main
// -------------------
async function main() {
  const params = getMapainfoParamsFromUrl();
  initMap({ lat: params.lat, lng: params.lng });

  panel = createProjectsPanel({
    containerId: "panelContent",
    countId: "panelCount",
    onSelectProject: (id) => {
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

  initPanelCollapse();

  // 1) data
  const proyectos = await loadProyectosXlsx(DATA_XLSX_URL, "mapainfo");

  // 2) engine
  const engineOutput = runProximityEngine({
    projects: proyectos,
    center: { lat: params.lat, lng: params.lng },
    modo: params.modo,
    radioKm: params.radio,
    n: params.n,
  });

  // 3) model (para UI + export)
  model = buildReportModel({
    engineOutput,
    meta: { sourceXlsx: DATA_XLSX_URL, generatedAt: new Date().toISOString() },
  });

  // Debug opcional
  window.__geoeva_model = model;

  // 4) UI: barra superior
  renderInfoBar(model);

  // 5) Map layers
  const radioFinal =
    Number.isFinite(model.query.radioKmFinal) && model.query.radioKmFinal > 0 ? model.query.radioKmFinal : params.radio;

  mapLayers.setQueryPoint(model.query.lat, model.query.lng);
  mapLayers.setQueryCircle(model.query.lat, model.query.lng, radioFinal);

  mapLayers.renderProjects(model.projects, {
    onMarkerClick: (id) => {
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

  // ✅ fit bounds usando el círculo REAL
  const bounds = typeof mapLayers.getQueryCircleBounds === "function" ? mapLayers.getQueryCircleBounds() : null;
  if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  else map.setView([model.query.lat, model.query.lng], 12);

  // 6) Panel list
  panel.render(model.projects);

  // 7) Charts
  updateCharts(model);

  // 8) KMZ (botón + compat onclick)
  bindKmzButton({
    buttonId: "btnKmz",
    getModel: () => model,
    exporter: downloadProximityKMZ,
    attachGlobalName: "downloadProximityKMZ",
  });
}

// -------------------
// Start
// -------------------
document.addEventListener("DOMContentLoaded", () => {
  main().catch((err) => {
    console.error("❌ Error fatal en mapainfo.js:", err);
    alert("Error fatal. Revisa la consola.");
  });
});
