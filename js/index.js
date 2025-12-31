// js/app/index.js

import { initPanelResponsive } from "../ui/layoutController.js";
import { initFiltersController } from "../ui/filtersController.js";
import { renderSummaryTable, summarizeByRegionAndState } from "../ui/summaryTable.js";
import { buildMapainfoUrl } from "./router.js";

const DATA_XLSX_URL = "capas/nacional.xlsx";
const REGIONES_JSON_URL = "capas/regiones.json";

let map;
let markersLayer;
let proyectos = [];
let filtros;

// ===============================
// DEBUG RESUMEN MÓVIL (FORZADO)
// ===============================
function debugForceMobileSummary(n) {
  const root = document.getElementById("mobileSummary");
  if (!root) {
    console.warn("❌ mobileSummary NO existe en DOM");
    return;
  }

  root.querySelectorAll(".ms-value").forEach((el, i) => {
    el.textContent = String(n + i);
  });

  console.log("✅ mobile summary actualizado (debug)", n);
}


// --------------------------------
// Utils
// --------------------------------
const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

function safeText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? "—");
}

function normalizeEstado(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Ajusta estos match si tus estados vienen con variantes.
 * La idea es mapear a 3 buckets: aprobados / calificacion / rechazados
 */
function bucketEstado(estado) {
  const e = normalizeEstado(estado);

  // Aprobados
  if (
    e.includes("aprob") ||
    e.includes("resolucion de calificacion ambiental favorable") ||
    e.includes("rca favorable") ||
    e === "aprobado"
  ) return "aprobados";

  // En calificación / tramitación
  if (
    e.includes("calific") ||
    e.includes("evaluacion") ||
    e.includes("en tramit") ||
    e.includes("admis") ||
    e.includes("en revision") ||
    e.includes("en evaluacion")
  ) return "calificacion";

  // Rechazados / desistidos / no admitidos (ajusta según tu criterio)
  if (
    e.includes("rechaz") ||
    e.includes("desist") ||
    e.includes("no admis") ||
    e.includes("termin") ||
    e.includes("caduc")
  ) return "rechazados";

  // Si no calza, no lo contamos en el resumen móvil (o puedes meterlo en calificación)
  return "otros";
}

function updateMobileSummaryFromVisibles(visibles) {
  // contar por palabras clave simples (SEA-friendly)
  let aprobados = 0, calificacion = 0, rechazados = 0;

  for (const p of visibles) {
    const e = normalizeEstado(p.estado);

    if (e.includes("rechaz") || e.includes("desfavorable") || e.includes("desist") || e.includes("inadmis") || e.includes("no admit")) {
      rechazados++;
    } else if (e.includes("aprob") || e.includes("favorable") || e.includes("rca favorable")) {
      aprobados++;
    } else {
      // default: en trámite / calificación
      calificacion++;
    }
  }

  // escribir valores usando data-key (robusto)
  const root = document.getElementById("mobileSummary");
  if (!root) return;

  const setVal = (key, val) => {
    const el = root.querySelector(`.ms-value[data-key="${key}"]`);
    if (el) el.textContent = String(val);
  };

  setVal("aprobados", aprobados);
  setVal("calificacion", calificacion);
  setVal("rechazados", rechazados);
}


// --------------------------------
// MAP INIT
// --------------------------------
function initMap() {
  map = L.map("map", {
    center: [-33.45, -70.65],
    zoom: 10,
    minZoom: 4,
    zoomControl: true,
    dragging: !isMobile(),
    touchZoom: isMobile(),     // ✅ 2 dedos
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
  });

  // Guardar referencia global
  window.__leafletMap = map;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    opacity: 1,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: 0.2 }
  ).addTo(map);

  L.control.scale().addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // 🔒 Bloquea scroll de página sobre el mapa
  if (isMobile()) {
    map.getContainer().style.touchAction = "none";
  }

  map.on("moveend", actualizarResumenYCapas);
  map.on("click", onMapClick);

  setTimeout(() => map.invalidateSize(), 150);
}

// --------------------------------
// DATA
// --------------------------------
async function loadExcelData() {
  const resp = await fetch(DATA_XLSX_URL);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const rows = json.slice(1);

  return rows
    .map((r) => ({
      nombre: r[0] || "",
      region: r[3] || "",
      estado: r[11] || "",
      sector: r[13] || "",
      lat: Number(r[14]),
      lon: Number(r[15]),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

// --------------------------------
// MAP RENDER
// --------------------------------
function actualizarResumenYCapas() {
  if (!map || !proyectos.length) return;

  const bounds = map.getBounds();
  const visibles = proyectos.filter((p) => bounds.contains([p.lat, p.lon]));

  markersLayer.clearLayers();

  visibles.forEach((p) => {
    L.circleMarker([p.lat, p.lon], {
      radius: 6,
      fillColor: "#10b981",
      color: "#fff",
      weight: 1,
      fillOpacity: 0.8,
    }).addTo(markersLayer);
  });

  safeText("bboxInfo", `Proyectos en pantalla: ${visibles.length}`);

  // Desktop: tabla resumen existente
  const resumen = summarizeByRegionAndState(visibles);
  renderSummaryTable(resumen, "summaryTableContainer");

  // Mobile: barra 3 estados (si existe)
  updateMobileSummaryFromVisibles(visibles);
}

// --------------------------------
// CLICK MAP → MAPAINFO
// --------------------------------
function onMapClick(e) {
  const { lat, lng } = e.latlng;

  const url = buildMapainfoUrl({
    baseHref: window.location.href,
    lat,
    lng,
    modo: "proximidad",
    radioKm: 10,
    n: filtros.getNProximos(),
    sectores: [],
  });

  window.open(url, "_blank");
}

// --------------------------------
// MOBILE: ocultar panel + backdrop + botón (si están en DOM)
// --------------------------------
function forceMobileNoPanel() {
  const panel = document.getElementById("configPanel");
  const backdrop = document.getElementById("panelBackdrop");
  const btn = document.getElementById("togglePanelBtn");

  if (panel) panel.style.display = "none";
  if (backdrop) backdrop.style.display = "none";
  if (btn) btn.style.display = "none";
}

// --------------------------------
// BOOT
// --------------------------------
function boot() {
  initMap();

  // ✅ Si es móvil: no inicializamos panel responsive
  if (isMobile()) {
    forceMobileNoPanel();
  } else {
    // ✅ Desktop: panel normal
    initPanelResponsive({
      panelId: "configPanel",
      backdropId: "panelBackdrop",
      headerBtnId: "togglePanelBtn",
      isMobileWidth: 768,
      onOpen: () => {
        document.body.style.overflow = "hidden";
        map.dragging.disable();
      },
      onClose: () => {
        document.body.style.overflow = "";
        // ✅ importante: re-habilitar drag en desktop
        map.dragging.enable();
      },
    });
  }

  filtros = initFiltersController({});

  loadExcelData().then((data) => {
    proyectos = data;
    actualizarResumenYCapas();
  });
}

document.addEventListener("DOMContentLoaded", boot);

