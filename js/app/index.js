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
const VIEWPORT_STORAGE_KEY = "ms:lastViewport:geoeva";
const VIEWPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WELCOME_DISMISSED_KEY = "hideWelcomeGeoEVA";
let incomingViewportApplied = false;
let locationPromptShown = false;
let hasUrlViewportParams = false;
let userViewportInteractionArmed = false;

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

// 👉 Desktop summary (nuevo)
  const desktopSummary = document.getElementById("desktopSummary");

  if (desktopSummary) {
    desktopSummary.innerHTML = `
      <span class="ds-aprobados">Aprobados <strong>${summary.aprobados}</strong></span>
      <span class="ds-sep">|</span>
      <span class="ds-calificacion">En revisión <strong>${summary.calificacion}</strong></span>
      <span class="ds-sep">|</span>
      <span class="ds-rechazados">Rechazados <strong>${summary.rechazados}</strong></span>
    `;
  }

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

function getVisibleProjectsCount() {
  if (!state.map || !state.proyectos.length) return 0;
  const bounds = state.map.getBounds();
  return state.proyectos.reduce(
    (count, project) => (bounds.contains([project.lat, project.lon]) ? count + 1 : count),
    0
  );
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
      persistCurrentViewport(state.map);
    },
    (geoError) => {
      warn("[geo] No se pudo obtener la ubicación; usando fallback.", geoError);
      state.map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
      persistCurrentViewport(state.map);
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

function isValidBBox(bbox) {
  if (!bbox || typeof bbox !== "object") return false;

  const { north, east, south, west } = bbox;
  const values = [north, east, south, west];
  if (values.some((value) => !Number.isFinite(Number(value)))) return false;

  const parsedNorth = Number(north);
  const parsedEast = Number(east);
  const parsedSouth = Number(south);
  const parsedWest = Number(west);

  if (parsedNorth <= parsedSouth || parsedEast <= parsedWest) return false;
  if (parsedNorth > 90 || parsedSouth < -90) return false;
  if (parsedEast > 180 || parsedWest < -180) return false;

  return true;
}

function persistCurrentViewport(map) {
  if (!map) return;

  const bounds = map.getBounds();
  if (!bounds) return;

  const bbox = {
    north: Number(bounds.getNorth()),
    east: Number(bounds.getEast()),
    south: Number(bounds.getSouth()),
    west: Number(bounds.getWest()),
  };

  if (!isValidBBox(bbox)) return;

  try {
    localStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({
        bbox,
        timestamp: Date.now(),
      })
    );
  } catch (storageError) {
    warn("[viewport] No se pudo persistir viewport", storageError);
  }
}

function readStoredViewport() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch (_error) {
    localStorage.removeItem(VIEWPORT_STORAGE_KEY);
    return null;
  }

  const bbox = parsed?.bbox;
  const timestamp = Number(parsed?.timestamp);
  const expired = !Number.isFinite(timestamp) || Date.now() - timestamp > VIEWPORT_TTL_MS;

  if (!isValidBBox(bbox) || expired) {
    localStorage.removeItem(VIEWPORT_STORAGE_KEY);
    return null;
  }

  return {
    bbox: {
      north: Number(bbox.north),
      east: Number(bbox.east),
      south: Number(bbox.south),
      west: Number(bbox.west),
    },
    timestamp,
  };
}

function applyStoredViewport(map) {
  if (!map) return false;

  const stored = readStoredViewport();
  if (!stored) return false;

  map.fitBounds(
    [
      [stored.bbox.south, stored.bbox.west],
      [stored.bbox.north, stored.bbox.east],
    ],
    { animate: false }
  );
  return true;
}

function isNullIsland(center) {
  if (!Array.isArray(center) || center.length !== 2) return false;

  const [lat, lon] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  return Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001;
}

async function resolveUserInitialViewport() {
  const fallback = { center: HOME_VIEW.center, zoom: HOME_VIEW.zoom };

  if (!("geolocation" in navigator)) return fallback;

  try {
    const permissions = navigator.permissions;
    if (permissions?.query) {
      const permissionStatus = await permissions.query({ name: "geolocation" });
      if (permissionStatus.state === "granted") {
        const viewport = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              resolve({
                center: [coords.latitude, coords.longitude],
                zoom: USER_ZOOM,
              });
            },
            reject,
            {
              enableHighAccuracy: true,
              timeout: 6000,
              maximumAge: 300000,
            }
          );
        });
        if (!isNullIsland(viewport?.center)) {
          return viewport;
        }

        warn("[geo] Coordenadas GPS inválidas (0,0); usando fallback.");
      }
    }
  } catch (gpsError) {
    warn("[geo] GPS sin fricción no disponible.", gpsError);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch("https://ipapi.co/json/", {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const lat = Number(payload?.latitude);
    const lon = Number(payload?.longitude);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const center = [lat, lon];
      if (!isNullIsland(center)) {
        return {
          center,
          zoom: USER_ZOOM,
        };
      }

      warn("[geo] Coordenadas IP inválidas (0,0); usando fallback.", payload);
    }
  } catch (ipError) {
    warn("[geo] Fallback IP no disponible.", ipError);
  } finally {
    clearTimeout(timeoutId);
  }

  return fallback;
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
    persistCurrentViewport(map);
    return true;
  }

  const lat = parseNumberParam(params.get("lat"));
  const lon = parseNumberParam(params.get("lon"));
  const zoom = parseNumberParam(params.get("zoom"));

  if (lat == null || lon == null || zoom == null) return false;

  map.setView([lat, lon], zoom, { animate: false });
  persistCurrentViewport(map);
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

function showSummary() {
  const desktopSummary = document.getElementById("desktopSummary");
  const mobileSummary = document.getElementById("mobileSummary");
  desktopSummary?.classList.add("is-visible");
  mobileSummary?.classList.add("is-visible");
}

function initWelcomeModal() {
  const modal = document.getElementById("welcomeModal");
  const startButton =
    document.getElementById("btn-ver-proyectos") || document.getElementById("startBtn");
  const dismissCheckbox = document.getElementById("dontShowAgain");

  if (typeof window.awaitingMapClick !== "boolean") {
    window.awaitingMapClick = false;
  }

  if (!modal) {
    showSummary();
    return;
  }

  const dismissed = localStorage.getItem(WELCOME_DISMISSED_KEY) === "1";
  if (dismissed) {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    showSummary();
    return;
  }

  modal.hidden = false;
  document.body.classList.add("modal-open");

  const closeModal = ({ armMapClick = false } = {}) => {
    if (dismissCheckbox?.checked) {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    }

    if (armMapClick) {
      window.awaitingMapClick = true;
      trackEvent({ event: "cta_ver_proyectos_modal" });
    }

    modal.hidden = true;
    document.body.classList.remove("modal-open");
    showSummary();
    detachListeners();
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      closeModal();
    }
  };

  const onOverlayClick = (event) => {
    if (event.target === modal) {
      closeModal();
    }
  };

  const onStartClick = () => {
    closeModal({ armMapClick: true });
  };

  const detachListeners = () => {
    startButton?.removeEventListener("click", onStartClick);
    modal.removeEventListener("click", onOverlayClick);
    document.removeEventListener("keydown", onDocumentKeydown);
  };

  startButton?.addEventListener("click", onStartClick);
  modal.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onDocumentKeydown);
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
  const crossSiteLinks = document.querySelectorAll(
    "[data-cross-site='side-banner'], #ecosystem-bar a[href]"
  );

  const isMobileNav = window.matchMedia("(max-width: 767px)").matches;

  crossSiteLinks.forEach((anchor) => {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.dataset.crossSiteBound === "true") return;

    anchor.addEventListener("click", (event) => {
      event.preventDefault();

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      const enrichedUrl = buildCrossSiteUrl(rawHref);
      const destinationHost = new URL(enrichedUrl, window.location.href).hostname.toLowerCase();
      const to = destinationHost.includes("geonemo") ? "geonemo" : "geoipt";

      // En mobile: misma pestaña
      if (isMobileNav || anchor.closest("#ecosystem-bar")) {
        trackEvent({
          event: "geo_cross_navigation",
          from: "geoeva",
          to,
          method: "same_tab",
        });
        window.location.href = enrichedUrl;
        return;
      }

      // En desktop: nueva pestaña para cards laterales
      trackEvent({
        event: "geo_cross_navigation",
        from: "geoeva",
        to,
        method: "new_tab",
      });
      const popup = window.open(enrichedUrl, "_blank", "noopener");
      if (!popup) {
        window.location.href = enrichedUrl;
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
  const mapContainer = map.getContainer();
  userViewportInteractionArmed = false;

  mapContainer.addEventListener(
    "pointerdown",
    () => {
      userViewportInteractionArmed = true;
    },
    { passive: true }
  );
  mapContainer.addEventListener(
    "wheel",
    () => {
      userViewportInteractionArmed = true;
    },
    { passive: true }
  );
  mapContainer.addEventListener(
    "touchstart",
    () => {
      userViewportInteractionArmed = true;
    },
    { passive: true }
  );

  const refreshOnMoveEnd = debounce(refreshVisibleProjects, 180);
  const debouncedPersistViewport = debounce(() => {
    if (!userViewportInteractionArmed) return;
    persistCurrentViewport(map);
  }, 500);
  map.on("moveend", refreshOnMoveEnd);
  map.on("moveend", debouncedPersistViewport);
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
    initWelcomeModal();
  };

  baseLayer.once("load", () => {
    revealMapShell();
  });
  window.setTimeout(revealMapShell, 1200);

  hasUrlViewportParams = hasUrlParams();
  if (hasUrlViewportParams) {
    incomingViewportApplied = applyIncomingViewport(map);
    if (!incomingViewportApplied) {
      if (!applyStoredViewport(map)) {
        resolveUserInitialViewport()
          .then((viewport) => {
            map.setView(viewport.center, viewport.zoom, { animate: false });
          })
          .catch(() => {
            applyChileInitialViewport(map);
          });
      }
    }
  } else {
    incomingViewportApplied = false;
    if (!applyStoredViewport(map)) {
      resolveUserInitialViewport()
        .then((viewport) => {
          map.setView(viewport.center, viewport.zoom, { animate: false });
        })
        .catch(() => {
          applyChileInitialViewport(map);
        });
    }
  }



  scheduleWhenIdle(() => initMapCursorHint(map), 2000);

  window.__leafletMap = map;
  syncMapSize();
  attachMapResizeSync();
}

function triggerHeavyInteraction() {
  if (state.heavyInteractionTriggered) return;
  state.heavyInteractionTriggered = true;

  trackEvent({
    event: "geoeva_first_heavy_trigger",
    event_category: "engagement",
    event_label: "first_map_click",
  });
}

function handleMapClick(event) {
  if (window.awaitingMapClick === true) {
    window.awaitingMapClick = false;
  }

  triggerHeavyInteraction();

  const url = buildMapainfoUrl({
    lat: event.latlng.lat,
    lng: event.latlng.lng,
    modo: "proximidad",
    radioKm: 10,
    n: 10,
  });

  trackEvent({
    event: "geo_click_map",
    result_type: "mapainfo",
    method: "map_click",
    lat: Number(event.latlng.lat.toFixed(6)),
    lng: Number(event.latlng.lng.toFixed(6)),
    projects_total: state.proyectos.length || 0,
    projects_visible: getVisibleProjectsCount(),
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
      option.value = String(region.id ?? "");
      option.textContent = region.nombre || "Sin nombre";
      select.appendChild(option);
    });
  } catch (fetchError) {
    error("❌ Error cargando regiones.json", fetchError);
    select.innerHTML = '<option value="">❌ Error cargando regiones</option>';
    return;
  }

  if (!select.dataset.bound) {
    select.addEventListener("change", (event) => {
      const selectedId = String(event.target.value || "");

      const region = state.regiones.find(
        (item) => String(item.id) === selectedId
      );

      if (!region || !state.map) {
        console.warn("[GeoEVA] Región no encontrada:", {
          selectedId,
          regiones: state.regiones,
        });
        return;
      }

      incomingViewportApplied = false;
      hasUrlViewportParams = false;

      if (Array.isArray(region.bbox) && region.bbox.length === 4) {
        state.map.fitBounds(
          [
            [Number(region.bbox[2]), Number(region.bbox[3])],
            [Number(region.bbox[0]), Number(region.bbox[1])],
          ],
          { animate: true }
        );
        return;
      }

      if (
        Array.isArray(region.centro) &&
        region.centro.length === 2 &&
        region.zoom != null
      ) {
        state.map.setView(
          [Number(region.centro[0]), Number(region.centro[1])],
          Number(region.zoom),
          { animate: true }
        );
        return;
      }

      console.warn("[GeoEVA] Región sin bbox ni centro/zoom válidos:", region);
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

    trackEvent({
      event: "geoeva_search_select",
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
  let dismissed = localStorage.getItem("geoevaHintDismissed") === "1";

  if (dismissed) return;

  function showHint() {
    hint.classList.add("show");
    visible = true;
  }

  function hideHint() {
    hint.classList.remove("show");
    visible = false;
    dismissed = true;
    localStorage.setItem("geoevaHintDismissed", "1");
  }

  map.getContainer().addEventListener("mouseenter", () => {
    if (!visible && !dismissed) showHint();
  });

  map.getContainer().addEventListener("mousemove", (e) => {
    hint.style.left = `${e.clientX + 12}px`;
    hint.style.top = `${e.clientY + 12}px`;
  });

  map.getContainer().addEventListener("mousedown", () => {
    if (!dismissed) hideHint();
  });
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

    trackEvent({
      event: "geoeva_open_geoeva",
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
