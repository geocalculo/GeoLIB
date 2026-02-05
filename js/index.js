// js/app/index.js

import { initPanelResponsive } from "../ui/layoutController.js";
import { initFiltersController } from "../ui/filtersController.js";
import { renderSummaryTable, summarizeByRegionAndState } from "../ui/summaryTable.js";
import { buildMapainfoUrl } from "./router.js";

const DATA_XLSX_URL = "capas/nacional.xlsx";
const REGIONES_JSON_URL = "capas/regiones.json"; // (reservado si lo usas más adelante)

let map;
let markersLayer;
let proyectos = [];
let filtros;

// --------------------------------
// Analytics (si está gtag)
// --------------------------------
document.addEventListener("DOMContentLoaded", () => {
  if (window.gtag) {
    gtag("event", "open_geoeva", {
      event_category: "engagement",
      event_label: "index",
    });
  }
});

document.getElementById("helpOnboardingBtn")?.addEventListener("click", () => {
  if (window.gtag) {
    gtag("event", "open_onboarding", {
      event_category: "engagement",
      event_label: "geoeva_help",
    });
  }
});

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
 * Buckets para 3 estados visibles en resumen móvil.
 */
function bucketEstado(estado) {
  const e = normalizeEstado(estado);

  // Aprobados
  if (
    e.includes("aprob") ||
    e.includes("resolucion de calificacion ambiental favorable") ||
    e.includes("rca favorable") ||
    e === "aprobado"
  )
    return "aprobados";

  // En calificación / tramitación
  if (
    e.includes("calific") ||
    e.includes("evaluacion") ||
    e.includes("en tramit") ||
    e.includes("admis") ||
    e.includes("en revision") ||
    e.includes("en evaluacion")
  )
    return "calificacion";

  // Rechazados / desistidos / no admitidos
  if (
    e.includes("rechaz") ||
    e.includes("desist") ||
    e.includes("no admis") ||
    e.includes("termin") ||
    e.includes("caduc")
  )
    return "rechazados";

  return "otros";
}

function updateMobileSummaryFromVisibles(visibles) {
  let aprobados = 0,
    calificacion = 0,
    rechazados = 0;

  for (const p of visibles) {
    const b = bucketEstado(p.estado);
    if (b === "aprobados") aprobados++;
    else if (b === "rechazados") rechazados++;
    else if (b === "calificacion") calificacion++;
    else calificacion++; // default: lo metemos a "en calificación" para no perder conteo
  }

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
// GEOLOCATION (zoom inicial por ubicación del usuario)
// --------------------------------
const FALLBACK_VIEW = { center: [-23.6509, -70.3975], zoom: 9 }; // Antofagasta
const USER_ZOOM = 12; // 11–14 suele andar bien
let didAutoCenter = false;
let __userLocateLayer = null;

function setBboxInfo(msg) {
  const el = document.getElementById("bboxInfo");
  if (el) el.textContent = msg;
}

function clearUserLocateLayer() {
  if (!map || !__userLocateLayer) return;
  try {
    __userLocateLayer.remove();
  } catch (_) {}
  __userLocateLayer = null;
}

function drawUserLocate(lat, lon, accuracy) {
  clearUserLocateLayer();

  __userLocateLayer = L.layerGroup().addTo(map);

  L.circleMarker([lat, lon], {
    radius: 7,
    weight: 2,
    fillOpacity: 0.7,
  }).addTo(__userLocateLayer);

  L.circle([lat, lon], {
    radius: Math.min(Math.max(accuracy ?? 50, 25), 800),
    weight: 1,
    fillOpacity: 0.08,
  }).addTo(__userLocateLayer);
}

function tryCenterOnUser(map) {
  const log = (...a) => console.log("[geo]", ...a);
  const warn = (...a) => console.warn("[geo]", ...a);

  log("origin:", window.location.origin);
  log("secureContext:", window.isSecureContext);
  log("hasGeolocation:", "geolocation" in navigator);

  if (!("geolocation" in navigator)) {
    warn("navegador sin geolocation → fallback");
    setBboxInfo("📍 GPS no disponible (fallback Antofagasta).");
    map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    return;
  }

  // Diagnóstico de permisos (si existe)
  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((p) => log("permission:", p.state))
      .catch(() => {});
  }

  setBboxInfo("📍 Buscando tu ubicación… (permite el GPS)");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      didAutoCenter = true;

      log("OK:", latitude, longitude, "±", Math.round(accuracy || 0), "m");

      map.setView([latitude, longitude], USER_ZOOM, { animate: true });
      drawUserLocate(latitude, longitude, accuracy);

      setBboxInfo(`📍 Tu ubicación (±${Math.round(accuracy || 0)} m)`);
    },
    (err) => {
      // err.code: 1=denied, 2=unavailable, 3=timeout
      warn("ERROR:", err?.code, err?.message);

      const code = err?.code ?? "?";
      setBboxInfo(`📍 GPS no disponible (code ${code}) → fallback Antofagasta`);
      map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    }
  );
}

// Botón Leaflet “📍 Mi ubicación”
function addLocateButton(map) {
  const LocateControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      const btn = L.DomUtil.create("button", "leaflet-bar");
      btn.type = "button";
      btn.title = "Mi ubicación";
      btn.innerHTML = "📍";
      btn.style.width = "34px";
      btn.style.height = "34px";
      btn.style.cursor = "pointer";
      btn.style.background = "#fff";
      btn.style.border = "none";

      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", (ev) => {
        L.DomEvent.stop(ev);
        tryCenterOnUser(map);
      });

      return btn;
    },
  });

  map.addControl(new LocateControl());
}

// --------------------------------
// MAP INIT
// --------------------------------
function initMap() {
  map = L.map("map", {
    center: FALLBACK_VIEW.center,
    zoom: FALLBACK_VIEW.zoom,
    minZoom: 4,
    zoomControl: true,
    dragging: !isMobile(),
    touchZoom: isMobile(), // ✅ 2 dedos
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
  });

  // Guardar referencia global
  window.__leafletMap = map;

  // Base OSM (principal)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    opacity: 1,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Satelital tenue
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

  // ✅ Botón GPS + intento inicial
  addLocateButton(map);
  tryCenterOnUser(map);
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

  // Si el bboxInfo está mostrando mensajes GPS, no lo pises agresivamente:
  // Solo actualiza si no está en modo "📍 ..."
  const bboxEl = document.getElementById("bboxInfo");
  const cur = bboxEl?.textContent || "";
  if (!cur.startsWith("📍")) {
    safeText("bboxInfo", `Proyectos en pantalla: ${visibles.length}`);
  }

  const resumen = summarizeByRegionAndState(visibles);
  renderSummaryTable(resumen, "summaryTableContainer");

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
// MOBILE: ocultar panel + backdrop + botón
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

  if (isMobile()) {
    forceMobileNoPanel();
  } else {
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
