import { loadProyectos } from "../core/dataLoader.js";
import { escapeHtml, normalizeSimple } from "../core/utils.js";
import { log, warn, error } from "../core/logger.js";
import { buildMapainfoUrl } from "./router.js";

const DATA_URL = "capas/nacional.compact.v2.json";
const REGIONES_URL = "capas/regiones.json";
const FALLBACK_VIEW = { center: [-23.6509, -70.3975], zoom: 9 };
const USER_ZOOM = 12;

const state = {
  map: null,
  regiones: [],
  proyectos: [],
  markersLayer: null,
  markerIndex: new Map(),
};

function track(eventName, params = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, params);
}

function createStatusBucket(rawEstado) {
  const estado = normalizeSimple(rawEstado);

  if (
    estado.includes("rechaz") ||
    estado.includes("desfavorable") ||
    estado.includes("inadmis") ||
    estado.includes("no admit") ||
    estado.includes("desist") ||
    estado.includes("caduc")
  ) {
    return "rechazados";
  }

  if (
    estado.includes("aprob") ||
    estado.includes("favorable") ||
    estado.includes("rca favorable")
  ) {
    return "aprobados";
  }

  return "calificacion";
}

function saveBasemapPrefs({
  addOSM = true,
  osmOpacity = 1,
  addIMG = true,
  imgOpacity = 0.2,
} = {}) {
  try {
    localStorage.setItem(
      "geoeva_basemap",
      JSON.stringify({ addOSM, osmOpacity, addIMG, imgOpacity })
    );
  } catch (storageError) {
    warn("No se pudo guardar geoeva_basemap", storageError);
  }
}

function getProjectKey(project) {
  if (project?.id != null && project.id !== "") return String(project.id);
  return [Number(project.lat).toFixed(6), Number(project.lon).toFixed(6), String(project.nombre || "").trim()].join("|");
}

function buildPopup(project) {
  return [
    `<strong>${escapeHtml(project.nombre)}</strong>`,
    `Estado: ${escapeHtml(project.estado || "—")}`,
    `Sector: ${escapeHtml(project.sector || "—")}`,
    `Región: ${escapeHtml(project.region || "—")}`,
  ].join("<br />");
}

function createMarker(project) {
  const bucket = createStatusBucket(project.estado);
  const palette = {
    aprobados: "#10b981",
    calificacion: "#f59e0b",
    rechazados: "#ef4444",
  };

  return L.circleMarker([project.lat, project.lon], {
    radius: 6,
    fillColor: palette[bucket],
    color: "#ffffff",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.85,
  }).bindPopup(buildPopup(project));
}

function updateMarkers(visibleProjects) {
  const layer = state.markersLayer;
  if (!layer) return;

  const visibleKeys = new Set();
  visibleProjects.forEach((project) => {
    const key = getProjectKey(project);
    visibleKeys.add(key);

    if (!state.markerIndex.has(key)) {
      const marker = createMarker(project);
      state.markerIndex.set(key, marker);
      layer.addLayer(marker);
    }
  });

  for (const [key, marker] of state.markerIndex.entries()) {
    if (visibleKeys.has(key)) continue;
    layer.removeLayer(marker);
    state.markerIndex.delete(key);
  }
}

function updateMobileSummary(projectsInView) {
  const root = document.getElementById("mobileSummary");
  if (!root) return;

  const summary = {
    aprobados: 0,
    calificacion: 0,
    rechazados: 0,
  };

  projectsInView.forEach((project) => {
    summary[createStatusBucket(project.estado)] += 1;
  });

  Object.entries(summary).forEach(([key, value]) => {
    const node = root.querySelector(`.ms-value[data-key="${key}"]`);
    if (node) node.textContent = String(value);
  });
}

function refreshVisibleProjects() {
  if (!state.map || !state.proyectos.length) return;
  const bounds = state.map.getBounds();
  const visibleProjects = state.proyectos.filter((project) => bounds.contains([project.lat, project.lon]));
  updateMarkers(visibleProjects);
  updateMobileSummary(visibleProjects);
}

function createLocateControl() {
  return L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const button = L.DomUtil.create("button", "leaflet-bar");
      button.type = "button";
      button.title = "Mi ubicación";
      button.innerHTML = "📍";
      button.style.width = "34px";
      button.style.height = "34px";
      button.style.background = "#fff";
      button.style.border = "none";
      button.style.cursor = "pointer";

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.stop(event);
        centerOnUser();
      });

      return button;
    },
  });
}

function centerOnUser() {
  if (!state.map) return;

  if (!("geolocation" in navigator)) {
    warn("[geo] navigator.geolocation no disponible; usando fallback.");
    state.map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      state.map.setView([coords.latitude, coords.longitude], USER_ZOOM, { animate: true });
    },
    (geoError) => {
      warn("[geo] No se pudo obtener la ubicación; usando fallback.", geoError);
      state.map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    }
  );
}

function initMap() {
  const map = L.map("map", {
    center: FALLBACK_VIEW.center,
    zoom: FALLBACK_VIEW.zoom,
    minZoom: 4,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  L.control.scale().addTo(map);
  map.addControl(new (createLocateControl())());

  state.map = map;
  state.markersLayer = L.layerGroup().addTo(map);

  const refreshOnMoveEnd = debounce(refreshVisibleProjects, 180);
  map.on("moveend", refreshOnMoveEnd);
  map.on("click", handleMapClick);

  initMapCursorHint(map);

  saveBasemapPrefs({
    addOSM: true,
    osmOpacity: 1,
    addIMG: false,
    imgOpacity: 0,
  });

  centerOnUser();
  window.__leafletMap = map;
}

function debounce(callback, delayMs) {
  let timerId = null;
  return (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = window.setTimeout(() => {
      timerId = null;
      callback(...args);
    }, delayMs);
  };
}

function handleMapClick(event) {
  const url = buildMapainfoUrl({
    lat: event.latlng.lat,
    lng: event.latlng.lng,
    modo: "proximidad",
    radioKm: 10,
    n: 10,
  });

  track("geoeva_open_mapainfo", {
    event_category: "engagement",
    event_label: "index_map_click",
  });

  window.open(url, "_blank", "noopener");
}

async function loadRegions() {
  const select = document.getElementById("region-select");
  if (!select) return;

  try {
    const response = await fetch(REGIONES_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state.regiones = await response.json();
    select.innerHTML = '<option value="">Selecciona una región</option>';

    state.regiones.forEach((region) => {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = region.nombre;
      select.appendChild(option);
    });
  } catch (fetchError) {
    error("❌ Error cargando regiones.json", fetchError);
    select.innerHTML = '<option value="">❌ Error cargando regiones</option>';
    return;
  }

  select.addEventListener("change", (event) => {
    const region = state.regiones.find((item) => item.id === event.target.value);
    if (!region || !state.map) return;
    if (region.centro && region.zoom) {
      state.map.setView(region.centro, region.zoom);
    }
  });
}



function initMapCursorHint(map) {
  const hint = document.getElementById("map-hint-cursor");
  if (!hint) return;

  // Solo desktop
  const isDesktop = window.matchMedia("(pointer: fine)").matches;
  if (!isDesktop) return;

  let visible = false;
  let timeout;

  function showHint() {
    hint.classList.add("show");
    visible = true;

    timeout = setTimeout(() => {
      hideHint();
    }, 4000);
  }

  function hideHint() {
    hint.classList.remove("show");
    visible = false;
    clearTimeout(timeout);
  }

  map.getContainer().addEventListener("mouseenter", () => {
    if (!visible) showHint();
  });

  map.getContainer().addEventListener("mousemove", (e) => {
    hint.style.left = e.clientX + 12 + "px";
    hint.style.top = e.clientY + 12 + "px";
  });

  map.getContainer().addEventListener("mouseleave", hideHint);

  map.getContainer().addEventListener("mousedown", hideHint);
}

async function bootstrap() {
  track("open_geoeva", {
    event_category: "engagement",
    event_label: "index",
  });

  initMap();
  await loadRegions();

  try {
    state.proyectos = await loadProyectos(DATA_URL);
    log("✔ Proyectos cargados:", state.proyectos.length);
  } catch (loadError) {
    error("❌ Error cargando proyectos", loadError);
    return;
  }

  refreshVisibleProjects();
}

document.addEventListener("DOMContentLoaded", bootstrap);
