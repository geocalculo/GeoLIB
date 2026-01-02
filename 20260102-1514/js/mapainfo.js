// js/mapainfo.js (modular, con orquestación más limpia + modo móvil mejorado)
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
import { bindKmzButton, bindReportButton } from "./ui/actions.js";

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
// Helpers
// -------------------
function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

// Basemap prefs (desde index.html)
function readBasemapPrefs() {
  try {
    const raw = localStorage.getItem("geoeva_basemap");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Política UX móvil:
 * - 1 dedo: NO se arrastra el mapa (la página puede scrollear)
 * - 2 dedos: pinch zoom (y opcional pan con 2 dedos, activado acá)
 */
function enableTwoFingerZoomOnly(map) {
  if (!map) return;
  if (!isMobile()) return;

  // Base: NO pan con 1 dedo, SÍ pinch con 2 dedos
  map.dragging.disable();
  map.touchZoom.enable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();

  if (map.tap) map.tap.enable(); // tap para markers

  const container = map.getContainer();

  // Permite scroll vertical del documento con 1 dedo
  container.style.touchAction = "pan-y";

  // Con 2 dedos: evitamos scroll/pinch del navegador, para que Leaflet haga pinch
  container.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches.length >= 2) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // (Opcional) Permitir PAN solo mientras hay 2 dedos
  container.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches && e.touches.length >= 2) map.dragging.enable();
      else map.dragging.disable();
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    () => {
      map.dragging.disable();
    },
    { passive: true }
  );
}

// -------------------
// Mobile bottom sheet
// -------------------
function initMobileSheet() {
  const sheet = document.getElementById("mobileSheet");
  const backdrop = document.getElementById("mobileSheetBackdrop");
  const btnClose = document.getElementById("msClose");
  const handle = document.getElementById("mobileSheetHandle");

  if (!sheet || !backdrop) return;

  function close() {
    sheet.classList.add("hidden");
    backdrop.classList.add("hidden");
    sheet.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");

    // Al cerrar, volvemos a la política móvil del mapa (1 dedo scroll, 2 dedos zoom)
    if (window.__leafletMap) enableTwoFingerZoomOnly(window.__leafletMap);
  }

  function open() {
    sheet.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");

    // Si el sheet está abierto, mantenemos el mapa "amigable":
    // seguimos permitiendo pinch a 2 dedos, pero sin pan con 1 dedo (ya lo hace la política).
    if (window.__leafletMap) enableTwoFingerZoomOnly(window.__leafletMap);
  }

  backdrop.addEventListener("click", close);
  btnClose?.addEventListener("click", close);
  handle?.addEventListener("click", close);

  window.__openMobileSheet = open;
  window.__closeMobileSheet = close;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openMobileSheet(p) {
  if (!isMobile()) return;

  const title = document.getElementById("msTitle");
  const meta = document.getElementById("msMeta");
  const exp = document.getElementById("msExp");
  const anx = document.getElementById("msAnx");

  if (!title || !meta || !exp || !anx) return;

  title.textContent = p?.nombre || "Proyecto";

  const dist = Number.isFinite(p?.distKm) ? `${p.distKm.toFixed(2)} km` : "—";
  const estado = p?.estado || "—";
  const sector = p?.sector || "—";

  meta.innerHTML = `
    <div><b>Distancia:</b> ${dist}</div>
    <div><b>Estado:</b> ${escapeHtml(estado)}</div>
    <div><b>Sector:</b> ${escapeHtml(sector)}</div>
  `;

  const expUrl = (p?.web || "").trim();
  const anxUrl = (p?.anexos || "").trim();

  if (expUrl) {
    exp.href = expUrl;
    exp.style.opacity = "1";
    exp.style.pointerEvents = "auto";
  } else {
    exp.href = "#";
    exp.style.opacity = "0.5";
    exp.style.pointerEvents = "none";
  }

  if (anxUrl) {
    anx.href = anxUrl;
    anx.style.opacity = "1";
    anx.style.pointerEvents = "auto";
  } else {
    anx.href = "#";
    anx.style.opacity = "0.5";
    anx.style.pointerEvents = "none";
  }

  window.__openMobileSheet?.();
}

// Exponer API para otros módulos (mapLayers)
window.openMobileSheet = openMobileSheet;
window.__isMobile = isMobile;

// (Test manual desde consola)
window.openMobileSheetTest = function () {
  const sheet = document.getElementById("mobileSheet");
  const backdrop = document.getElementById("mobileSheetBackdrop");
  const title = document.getElementById("msTitle");
  const meta = document.getElementById("msMeta");

  if (!sheet || !backdrop) {
    alert("No existe mobileSheet en el HTML (revisa que esté dentro de <body>).");
    return;
  }

  title.textContent = "PROYECTO TEST";
  meta.innerHTML = `
    <div><b>Distancia:</b> 2.34 km</div>
    <div><b>Estado:</b> Aprobado</div>
    <div><b>Sector:</b> Energía</div>
  `;

  sheet.classList.remove("hidden");
  backdrop.classList.remove("hidden");
};

// -------------------
// Map init
// -------------------
function initMap({ lat, lng }) {
  map = L.map("map", { center: [lat, lng], zoom: 11, minZoom: 4, zoomControl: true });

  // Exponer mapa para otros módulos
  window.__leafletMap = map;

  // Política móvil (1 dedo scroll / 2 dedos zoom)
  enableTwoFingerZoomOnly(map);

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

  // Modo móvil: simplificar UX (Top N fijo)
  if (isMobile()) params.n = 10;

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
      // Desktop: highlight + popup (o sheet si en móvil)
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

  // fit bounds (si existe)
  const bounds = typeof mapLayers.getQueryCircleBounds === "function" ? mapLayers.getQueryCircleBounds() : null;
  if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  else map.setView([model.query.lat, model.query.lng], 12);

  // 6) Panel list (desktop)
  if (!isMobile()) {
    panel.render(model.projects);
  }

  // 7) Charts (desktop)
  if (!isMobile()) {
    updateCharts(model);
  }

  // 8) KMZ
  bindKmzButton({
    buttonId: "btnKmz",
    getModel: () => model,
    exporter: downloadProximityKMZ,
    attachGlobalName: "downloadProximityKMZ",
  });

  // 9) Informe (Desktop/PDF)
  bindReportButton({
    buttonId: "btnPdf",
    getModel: () => model,
    reportPage: "report.html",
    attachGlobalName: "openReport",
  });
}

// -------------------
// Start
// -------------------
document.addEventListener("DOMContentLoaded", () => {
  initMobileSheet();

  main().catch((err) => {
    console.error("❌ Error fatal en mapainfo.js:", err);
    alert("Error fatal. Revisa la consola.");
  });
});
