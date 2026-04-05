import { loadProyectos } from "../core/dataLoader.js";
import { escapeHtml, normalizeSimple } from "../core/utils.js";
import { log, warn, error } from "../core/logger.js";
import { trackEvent } from "../core/tracking.js";
import { buildMapainfoUrl } from "./router.js";


const DATA_URL = "capas/nacional.compact.v2.json";
const REGIONES_URL = "capas/regiones.json";
const FALLBACK_VIEW = { center: [-23.6509, -70.3975], zoom: 11 };
const HOME_VIEW = { center: [-23.6509, -70.3975], zoom: 10 };
const CHILE_INITIAL_BOUNDS = [
  [-56.0, -75.0], // SW
  [-17.5, -66.0], // NE
];
const USER_ZOOM = 12;
const SEARCH_FLY_ZOOM = 13;
let incomingViewportApplied = false;
let locationPromptShown = false;
let hasUrlViewportParams = false;

const PROJECT_MARKER_STYLE = {
  radius: 3,
  color: "#2563eb",
  weight: 1,
  opacity: 1,
  fillColor: "#2563eb",
  fillOpacity: 0.7,
  interactive: false,
  bubblingMouseEvents: false,
};

const state = {
  map: null,
  regiones: [],
  proyectos: [],
  markersLayer: null,
  markerIndex: new Map(),
  projectsLoaded: false,
  regionsLoaded: false,
  heavyInteractionTriggered: false,

  searchIndex: [],
  searchHighlight: null,
  searchUi: {
    wrap: null,
    input: null,
    results: null,
    activeIndex: -1,
    currentResults: [],
  },
};

function setLoadingProgress(percent, text) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const percentEl = document.getElementById("loading-percent");
  const textEl = document.getElementById("loading-text");

  if (percentEl) percentEl.textContent = `${safePercent}%`;
  if (textEl && text) textEl.textContent = text;
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.add("is-hidden");
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
  return [
    Number(project.lat).toFixed(6),
    Number(project.lon).toFixed(6),
    String(project.nombre || "").trim(),
  ].join("|");
}

function createMarker(project) {
  return L.circleMarker([project.lat, project.lon], PROJECT_MARKER_STYLE);
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

function ensureMobileSummaryNodes(root) {
  const requiredKeys = ["aprobados", "calificacion", "rechazados"];
  const hasAllNodes = requiredKeys.every((key) =>
    root.querySelector(`[data-key="${key}"]`)
  );

  if (hasAllNodes) return;

  root.innerHTML = `
    <span class="ms-inline ms-aprobados">
      Aprobados <strong data-key="aprobados">0</strong>
    </span>
    <span class="ms-sep">|</span>
    <span class="ms-inline ms-calificacion">
      En revisión <strong data-key="calificacion">0</strong>
    </span>
    <span class="ms-sep">|</span>
    <span class="ms-inline ms-rechazados">
      Rechazados <strong data-key="rechazados">0</strong>
    </span>
  `;
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
    const bucket = createStatusBucket(project.estado);
    if (summary[bucket] != null) summary[bucket] += 1;
  });

  ensureMobileSummaryNodes(root);

  Object.entries(summary).forEach(([key, value]) => {
    const node = root.querySelector(`[data-key="${key}"]`);
    if (node) node.textContent = String(value);
  });
}

function refreshVisibleProjects() {
  if (!state.map || !state.proyectos.length) return;

  const bounds = state.map.getBounds();
  const visibleProjects = state.proyectos.filter((project) =>
    bounds.contains([project.lat, project.lon])
  );

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

function hasUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return params.toString().length > 0;
}

function shouldAskForUserLocation() {
  if (locationPromptShown) return false;
  if (hasUrlViewportParams) return false;
  if (incomingViewportApplied) return false;
  return true;
}

function dismissUserLocationPrompt(container) {
  if (container) container.remove();
  locationPromptShown = true;
}

function showUserLocationPrompt() {
  if (!state.map || !shouldAskForUserLocation()) return;

  const prompt = L.DomUtil.create("div", "geoeva-location-prompt");
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-live", "polite");

  const question = L.DomUtil.create("p", "geoeva-location-prompt__text", prompt);
  question.textContent = "¿Deseas ir a tu ubicación?";

  const actions = L.DomUtil.create("div", "geoeva-location-prompt__actions", prompt);
  const yesButton = L.DomUtil.create(
    "button",
    "geoeva-location-prompt__button is-yes",
    actions
  );
  yesButton.type = "button";
  yesButton.textContent = "Sí";

  const noButton = L.DomUtil.create(
    "button",
    "geoeva-location-prompt__button is-no",
    actions
  );
  noButton.type = "button";
  noButton.textContent = "No";

  L.DomEvent.disableClickPropagation(prompt);

  L.DomEvent.on(yesButton, "click", (event) => {
    L.DomEvent.stop(event);
    dismissUserLocationPrompt(prompt);
    centerOnUser();
  });

  L.DomEvent.on(noButton, "click", (event) => {
    L.DomEvent.stop(event);
    dismissUserLocationPrompt(prompt);
  });

  const mapContainer = state.map.getContainer();
  mapContainer.appendChild(prompt);
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
      state.map.setView([coords.latitude, coords.longitude], USER_ZOOM, {
        animate: true,
      });
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

function syncMapSize() {
  if (!state.map) return;

  window.requestAnimationFrame(() => {
    state.map.invalidateSize({ animate: false, pan: false });
  });
}

function attachMapResizeSync() {
  const debouncedSync = debounce(syncMapSize, 120);
  window.addEventListener("resize", debouncedSync, { passive: true });
  window.addEventListener("orientationchange", debouncedSync, { passive: true });

  const desktopLayoutMedia = window.matchMedia("(max-width: 1024px)");
  if (typeof desktopLayoutMedia.addEventListener === "function") {
    desktopLayoutMedia.addEventListener("change", debouncedSync);
  } else if (typeof desktopLayoutMedia.addListener === "function") {
    desktopLayoutMedia.addListener(debouncedSync);
  }
}

function scheduleAfterLoad(callback, delayMs = 0, { skipIfIncomingViewport = false } = {}) {
  window.addEventListener(
    "load",
    () => {
      if (skipIfIncomingViewport && incomingViewportApplied) return;
      window.setTimeout(callback, delayMs);
    },
    { once: true }
  );
}

function scheduleWhenIdle(callback, timeout = 1500) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout });
    return;
  }

  window.setTimeout(callback, 0);
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

function parseNumberParam(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBBoxFromQuery(searchParams) {
  const rawBBox = searchParams.get("bbox");
  if (!rawBBox) return null;

  const parts = rawBBox.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [north, east, south, west] = parts;
  if (north <= south || east <= west) return null;

  return {
    north,
    east,
    south,
    west,
  };
}

function applyIncomingViewport(map) {
  if (!map) return false;

  const params = new URLSearchParams(window.location.search);
  const bbox = parseBBoxFromQuery(params);

  if (bbox) {
    map.fitBounds(
      [
        [bbox.south, bbox.west],
        [bbox.north, bbox.east],
      ],
      { animate: false }
    );
    return true;
  }

  const lat = parseNumberParam(params.get("lat"));
  const lon = parseNumberParam(params.get("lon"));
  const zoom = parseNumberParam(params.get("zoom"));

  if (lat == null || lon == null || zoom == null) return false;

  map.setView([lat, lon], zoom, { animate: false });
  return true;
}

function applyChileInitialViewport(map) {
  if (!map) return;
  map.setView(HOME_VIEW.center, HOME_VIEW.zoom, { animate: false });
}

function getCurrentViewportParams() {
  if (!state.map) return {};

  const center = state.map.getCenter();
  const bounds = state.map.getBounds();

  return {
    lat: Number(center.lat).toFixed(6),
    lon: Number(center.lng).toFixed(6),
    zoom: String(state.map.getZoom()),
    bbox: [
      Number(bounds.getNorth()).toFixed(6),
      Number(bounds.getEast()).toFixed(6),
      Number(bounds.getSouth()).toFixed(6),
      Number(bounds.getWest()).toFixed(6),
    ].join(","),
  };
}

function buildCrossSiteUrl(baseUrl) {
  const targetUrl = new URL(baseUrl, window.location.href);
  const params = targetUrl.searchParams;
  const viewport = getCurrentViewportParams();

  if (viewport.lat) params.set("lat", viewport.lat);
  if (viewport.lon) params.set("lon", viewport.lon);
  if (viewport.zoom) params.set("zoom", viewport.zoom);
  if (viewport.bbox) params.set("bbox", viewport.bbox);

  return targetUrl.toString();
}

function initCrossSitePortal() {
  const crossSiteLinks = document.querySelectorAll("[data-cross-site='side-banner']");
  crossSiteLinks.forEach((anchor) => {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.dataset.crossSiteBound === "true") return;

    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      const enrichedUrl = buildCrossSiteUrl(rawHref);
      const popup = window.open(enrichedUrl, "_blank", "noopener");
      if (!popup) {
        warn("[cross-site] No se pudo abrir nueva pestaña para card lateral.");
      }
    });

    anchor.dataset.crossSiteBound = "true";
  });
}

function initMap() {
  const map = L.map("map", {
    center: FALLBACK_VIEW.center,
    zoom: FALLBACK_VIEW.zoom,
    minZoom: 4,
    zoomControl: true,
  });

  const baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  });

  baseLayer.addTo(map);

  L.control.scale().addTo(map);
  map.addControl(new (createLocateControl())());

  state.map = map;
  state.markersLayer = L.layerGroup().addTo(map);

  const refreshOnMoveEnd = debounce(refreshVisibleProjects, 180);
  map.on("moveend", refreshOnMoveEnd);
  map.on("click", handleMapClick);
  map.on("movestart", clearSearchHighlight);

  saveBasemapPrefs({
    addOSM: true,
    osmOpacity: 1,
    addIMG: false,
    imgOpacity: 0,
  });

  let overlayHidden = false;
  const revealMapShell = () => {
    if (overlayHidden) return;
    overlayHidden = true;
    setLoadingProgress(100, "Mapa listo");
    hideLoadingOverlay();
  };

  baseLayer.once("load", revealMapShell);
  window.setTimeout(revealMapShell, 1200);

  hasUrlViewportParams = hasUrlParams();
  if (hasUrlViewportParams) {
    incomingViewportApplied = applyIncomingViewport(map);
    if (!incomingViewportApplied) applyChileInitialViewport(map);
  } else {
    incomingViewportApplied = false;
    applyChileInitialViewport(map);
  }

  scheduleAfterLoad(
    showUserLocationPrompt,
    0
  );

  scheduleWhenIdle(() => initMapCursorHint(map), 2000);

  window.__leafletMap = map;
  syncMapSize();
  attachMapResizeSync();
}

function triggerHeavyInteraction() {
  if (state.heavyInteractionTriggered) return;
  state.heavyInteractionTriggered = true;

  trackEvent("geoeva_first_heavy_trigger", {
    event_category: "engagement",
    event_label: "first_map_click",
  });
}

function handleMapClick(event) {
  triggerHeavyInteraction();

  const url = buildMapainfoUrl({
    lat: event.latlng.lat,
    lng: event.latlng.lng,
    modo: "proximidad",
    radioKm: 10,
    n: 10,
  });

  trackEvent("geoeva_open_mapainfo", {
    event_category: "engagement",
    event_label: "index_map_click",
    source: "index_map_click",
    modo: "proximidad",
    radio_km: 10,
    lat: Number(event.latlng.lat.toFixed(6)),
    lng: Number(event.latlng.lng.toFixed(6)),
    open_target: "new_tab",
  });

  window.open(url, "_blank", "noopener");
}

async function loadRegions() {
  if (state.regionsLoaded) return;

  const select = document.getElementById("region-select");
  if (!select) return;

  try {
    const response = await fetch(REGIONES_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state.regiones = await response.json();
    state.regionsLoaded = true;

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

  if (!select.dataset.bound) {
    select.addEventListener("change", (event) => {
      const region = state.regiones.find((item) => item.id === event.target.value);
      if (!region || !state.map) return;
      if (incomingViewportApplied) return;
      if (region.centro && region.zoom) {
        state.map.setView(region.centro, region.zoom);
      }
    });
    select.dataset.bound = "true";
  }
}

function normalizeSearchText(value) {
  return normalizeSimple(String(value || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatSearchResultLabel(item) {
  return [item.sector, item.region, item.titular].filter(Boolean).join(" · ");
}

function buildSearchIndex() {
  state.searchIndex = state.proyectos
    .filter(
      (project) =>
        Number.isFinite(Number(project.lat)) && Number.isFinite(Number(project.lon))
    )
    .map((project) => {
      const nombre = String(project.nombre || "").trim();
      const sector = String(project.sector || "").trim();
      const region = String(project.region || "").trim();
      const titular = String(project.titular || "").trim();
      const id = getProjectKey(project);
      const nameNormalized = normalizeSearchText(nombre);

      return {
        id,
        nombre,
        sector,
        region,
        titular,
        lat: Number(project.lat),
        lon: Number(project.lon),
        nameNormalized,
        searchText: normalizeSearchText([nombre, sector, titular, region].join(" ")),
      };
    });
}

function searchProjects(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const ranked = [];
  for (const item of state.searchIndex) {
    const haystack = item.searchText;
    let allTermsMatch = true;
    let score = 0;

    for (const term of terms) {
      const idx = haystack.indexOf(term);
      if (idx === -1) {
        allTermsMatch = false;
        break;
      }
      score += idx === 0 ? 0 : idx;
    }

    if (!allTermsMatch) continue;

    const nameStarts = item.nameNormalized.startsWith(terms[0]);
    ranked.push({
      item,
      score: score - (nameStarts ? 20 : 0),
    });
  }

  ranked.sort((a, b) => a.score - b.score);
  return ranked.slice(0, 10).map((entry) => entry.item);
}

function clearSearchResults() {
  const { wrap, results, input } = state.searchUi;
  if (!results) return;

  results.innerHTML = "";
  results.hidden = true;

  if (input) input.setAttribute("aria-expanded", "false");
  if (wrap) wrap.classList.remove("is-open");

  state.searchUi.activeIndex = -1;
  state.searchUi.currentResults = [];
}

function applyActiveSearchItem() {
  const { results, activeIndex } = state.searchUi;
  if (!results) return;

  const nodes = Array.from(results.querySelectorAll(".project-search__item"));
  nodes.forEach((node, index) => {
    const isActive = index === activeIndex;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) node.scrollIntoView({ block: "nearest" });
  });
}

function renderSearchResults(results) {
  const { wrap, input, results: listEl } = state.searchUi;
  if (!listEl) return;

  state.searchUi.currentResults = results;
  state.searchUi.activeIndex = results.length ? 0 : -1;
  listEl.innerHTML = "";

  if (!results.length) {
    listEl.hidden = true;
    if (input) input.setAttribute("aria-expanded", "false");
    if (wrap) wrap.classList.remove("is-open");
    return;
  }

  const fragment = document.createDocumentFragment();

  results.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-search__item";
    button.setAttribute("role", "option");
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="project-search__name">${escapeHtml(item.nombre || "Proyecto sin nombre")}</span>
      <span class="project-search__meta">${escapeHtml(formatSearchResultLabel(item) || "Sin metadata")}</span>
    `;
    button.addEventListener("click", () => {
      selectSearchResult(item);
    });
    fragment.appendChild(button);
  });

  listEl.appendChild(fragment);
  listEl.hidden = false;

  if (input) input.setAttribute("aria-expanded", "true");
  if (wrap) wrap.classList.add("is-open");

  applyActiveSearchItem();
}

function clearSearchHighlight() {
  if (!state.searchHighlight || !state.map) return;
  state.map.removeLayer(state.searchHighlight);
  state.searchHighlight = null;
}

function highlightSearchResult(item) {
  if (!state.map) return;

  clearSearchHighlight();

  const halo = L.circleMarker([item.lat, item.lon], {
    radius: 18,
    color: "#2563eb",
    weight: 3,
    fillColor: "#60a5fa",
    fillOpacity: 0.15,
    opacity: 0.95,
    interactive: false,
    bubblingMouseEvents: false,
  }).addTo(state.map);

  state.searchHighlight = halo;

  window.setTimeout(() => {
    if (state.searchHighlight === halo) {
      clearSearchHighlight();
    }
  }, 2200);
}

function selectSearchResult(item) {
  if (!state.map || !item) return;

  state.map.flyTo([item.lat, item.lon], SEARCH_FLY_ZOOM, { duration: 0.9 });

  highlightSearchResult(item);

  if (state.searchUi.input) {
    const query = state.searchUi.input.value.trim();

    trackEvent("geoeva_search_select", {
      event_category: "engagement",
      event_label: "project_search_select",
      query,
      project_name: item.nombre || "",
    });

    state.searchUi.input.value = item.nombre || "";
    state.searchUi.input.blur();
  }

  clearSearchResults();
}

function initProjectSearch() {
  const wrap = document.getElementById("project-search-wrap");
  const input = document.getElementById("project-search");
  const results = document.getElementById("project-search-results");

  if (!wrap || !input || !results) {
    warn("Buscador de proyectos no inicializado: faltan nodos HTML.");
    return;
  }

  state.searchUi.wrap = wrap;
  state.searchUi.input = input;
  state.searchUi.results = results;

  const onInput = debounce(() => {
    const items = searchProjects(input.value);
    renderSearchResults(items);
  }, 90);

  input.addEventListener("input", onInput);

  input.addEventListener("focus", () => {
    if (input.value.trim()) {
      renderSearchResults(searchProjects(input.value));
    }
  });

  input.addEventListener("keydown", (event) => {
    const total = state.searchUi.currentResults.length;

    if (event.key === "Escape") {
      clearSearchResults();
      return;
    }

    if (!total) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.searchUi.activeIndex =
        (state.searchUi.activeIndex + 1 + total) % total;
      applyActiveSearchItem();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.searchUi.activeIndex =
        (state.searchUi.activeIndex - 1 + total) % total;
      applyActiveSearchItem();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = state.searchUi.currentResults[state.searchUi.activeIndex];
      if (selected) selectSearchResult(selected);
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) {
      clearSearchResults();
    }
  });
}

async function loadProjectsLight() {
  if (state.projectsLoaded) return;

  try {
    state.proyectos = await loadProyectos(DATA_URL);
    state.projectsLoaded = true;
    buildSearchIndex();
    log("✔ Proyectos cargados:", state.proyectos.length);
    refreshVisibleProjects();

    if (state.searchUi.input && state.searchUi.input.value.trim()) {
      renderSearchResults(searchProjects(state.searchUi.input.value));
    }
  } catch (loadError) {
    error("❌ Error cargando proyectos", loadError);
  }
}

function initMapCursorHint(map) {
  const hint = document.getElementById("map-hint-cursor");
  if (!hint) return;

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
    hint.style.left = `${e.clientX + 12}px`;
    hint.style.top = `${e.clientY + 12}px`;
  });

  map.getContainer().addEventListener("mouseleave", hideHint);
  map.getContainer().addEventListener("mousedown", hideHint);
}

async function runDeferredDataWarmup() {
  setLoadingProgress(30, "Cargando regiones...");
  await loadRegions();

  scheduleWhenIdle(async () => {
    setLoadingProgress(65, "Cargando proyectos...");
    await loadProjectsLight();
    setLoadingProgress(100, "Proyectos listos");
  }, 2500);
}

function bootstrapPhase0And1() {
  try {
    setLoadingProgress(10, "Preparando visor...");

    trackEvent("geoeva_open_geoeva", {
      event_category: "engagement",
      event_label: "index",
    });

    initCrossSitePortal();
    initProjectSearch();

    setLoadingProgress(25, "Inicializando mapa...");
    initMap();

    scheduleAfterLoad(() => {
      window.setTimeout(runDeferredDataWarmup, 80);
    });
  } catch (err) {
    error("❌ Error en bootstrapPhase0And1()", err);
    setLoadingProgress(100, "Error al cargar");
    window.setTimeout(() => hideLoadingOverlay(), 700);
  }
}

document.addEventListener("DOMContentLoaded", bootstrapPhase0And1);
