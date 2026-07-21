let map;
let osmLayer;
let satLayer;
let currentBaseLayer;
let currentBasemap = "osm";
let initialCrossAccessState = null;
let selectedPoint = null;
let selectedFeatureContext = null;
const SITE_ID = "geoeva";
const SITE_CONFIG = { initialRegion: "Región de Antofagasta" };
const CROSS_ACCESS_PARAM_NAME = "from";
const CROSS_ACCESS_PARAM_VALUE = "crossaccess";

let viewportRestoreApplied = false;
let initialViewportCompleted = false;
let geoQueryRestoreState = null;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBasemap(value) {
  return String(value || "").toLowerCase() === "sat" ? "sat" : "osm";
}

function validLat(value) { return Number.isFinite(value) && value >= -90 && value <= 90; }
function validLon(value) { return Number.isFinite(value) && value >= -180 && value <= 180; }
function validZoom(value) { return Number.isFinite(value) && value >= 0 && value <= 22; }

function getGeoQueryOriginStorageKey(site = SITE_ID) {
  return `geox:${site}:geoquery-origin`;
}

function normalizeGeoQueryOriginState(raw, site = SITE_ID) {
  if (!raw || raw.site !== site) return null;
  const centerLat = toFiniteNumber(raw.map?.centerLat);
  const centerLon = toFiniteNumber(raw.map?.centerLon);
  const zoom = toFiniteNumber(raw.map?.zoom);
  const queryLat = toFiniteNumber(raw.queryPoint?.lat);
  const queryLon = toFiniteNumber(raw.queryPoint?.lon);
  const west = toFiniteNumber(raw.map?.bounds?.west);
  const south = toFiniteNumber(raw.map?.bounds?.south);
  const east = toFiniteNumber(raw.map?.bounds?.east);
  const north = toFiniteNumber(raw.map?.bounds?.north);
  const savedAt = toFiniteNumber(raw.savedAt) || Date.now();
  const maxAgeMs = 12 * 60 * 60 * 1000;
  if (!validLat(centerLat) || !validLon(centerLon) || !validZoom(zoom)) return null;
  if (!validLat(queryLat) || !validLon(queryLon)) return null;
  if (!validLon(west) || !validLon(east) || !validLat(south) || !validLat(north) || !(west < east) || !(south < north)) return null;
  if (Date.now() - savedAt > maxAgeMs) return null;
  return {
    version: 1,
    site,
    source: "geoquery",
    savedAt,
    queryPoint: { lat: queryLat, lon: queryLon },
    map: { centerLat, centerLon, zoom, basemap: normalizeBasemap(raw.map?.basemap), bounds: { west, south, east, north } },
    navigation: { from: raw.navigation?.from || "index", crossAccess: raw.navigation?.crossAccess === true || raw.navigation?.from === "crossaccess" }
  };
}

function readOriginStateFromUrl(site = SITE_ID) {
  const params = new URLSearchParams(window.location.search);
  const finiteParam = (name) => toFiniteNumber(params.get(name));
  const centerLat = finiteParam("mapCenterLat") ?? finiteParam("viewLat");
  const centerLon = finiteParam("mapCenterLon") ?? finiteParam("viewLon");
  const zoom = finiteParam("mapZoom") ?? finiteParam("zoom");
  const queryLat = finiteParam("queryLat") ?? finiteParam("lat");
  const queryLon = finiteParam("queryLon") ?? finiteParam("lon");
  const west = finiteParam("viewWest");
  const south = finiteParam("viewSouth");
  const east = finiteParam("viewEast");
  const north = finiteParam("viewNorth");
  return normalizeGeoQueryOriginState({ version: 1, site, source: "geoquery", savedAt: Date.now(), queryPoint: { lat: queryLat, lon: queryLon }, map: { centerLat, centerLon, zoom, basemap: params.get("basemap"), bounds: { west, south, east, north } }, navigation: { from: params.get("from") || "index", crossAccess: params.get("from") === "crossaccess" || params.get("source") === "crossaccess" } }, site);
}

function readOriginStateFromHistory(site = SITE_ID) {
  return normalizeGeoQueryOriginState(history.state?.geoQueryOrigin, site);
}

function readOriginStateFromSessionStorage(site = SITE_ID) {
  try { return normalizeGeoQueryOriginState(JSON.parse(sessionStorage.getItem(getGeoQueryOriginStorageKey(site)) || "null"), site); }
  catch { return null; }
}

function resolveViewportRestoreState(site = SITE_ID) {
  return readOriginStateFromUrl(site) || readOriginStateFromHistory(site) || readOriginStateFromSessionStorage(site) || null;
}

function captureGeoQueryOriginState({ site = SITE_ID, map, queryLat, queryLon, basemap, from }) {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return normalizeGeoQueryOriginState({ version: 1, site, source: "geoquery", savedAt: Date.now(), queryPoint: { lat: Number(queryLat), lon: Number(queryLon) }, map: { centerLat: center.lat, centerLon: center.lng, zoom: map.getZoom(), basemap, bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } }, navigation: { from: from || "index", crossAccess: from === "crossaccess" } }, site);
}

function persistOriginStateBeforeGeoQuery(originState) {
  if (!originState) return;
  try { sessionStorage.setItem(getGeoQueryOriginStorageKey(originState.site), JSON.stringify(originState)); } catch {}
  const currentUrl = new URL(window.location.href);
  const p = currentUrl.searchParams;
  p.set("mapCenterLat", originState.map.centerLat); p.set("mapCenterLon", originState.map.centerLon); p.set("mapZoom", originState.map.zoom);
  p.set("basemap", originState.map.basemap); p.set("queryLat", originState.queryPoint.lat); p.set("queryLon", originState.queryPoint.lon);
  p.set("viewWest", originState.map.bounds.west); p.set("viewSouth", originState.map.bounds.south); p.set("viewEast", originState.map.bounds.east); p.set("viewNorth", originState.map.bounds.north);
  p.set("restoreViewport", "1"); p.set("from", originState.navigation.crossAccess ? "crossaccess" : "geoquery");
  history.replaceState({ ...(history.state || {}), geoQueryOrigin: originState }, "", currentUrl);
}

function appendOriginStateToGeoQueryUrl(url, originState) {
  const target = new URL(url, window.location.href); const p = target.searchParams;
  p.set("viewLat", originState.map.centerLat); p.set("viewLon", originState.map.centerLon); p.set("mapCenterLat", originState.map.centerLat); p.set("mapCenterLon", originState.map.centerLon);
  p.set("zoom", originState.map.zoom); p.set("mapZoom", originState.map.zoom); p.set("basemap", originState.map.basemap); p.set("queryLat", originState.queryPoint.lat); p.set("queryLon", originState.queryPoint.lon);
  p.set("viewWest", originState.map.bounds.west); p.set("viewSouth", originState.map.bounds.south); p.set("viewEast", originState.map.bounds.east); p.set("viewNorth", originState.map.bounds.north);
  return target.pathname.split('/').pop() === 'geoquery.html' ? `./geoquery/geoquery.html?${p.toString()}` : target.toString();
}

function restoreMapViewport(mapInstance, restoreState) {
  const state = normalizeGeoQueryOriginState(restoreState, SITE_ID); if (!mapInstance || !state) return false;
  if (typeof switchBaseMap === "function") switchBaseMap(state.map.basemap);
  mapInstance.setView([state.map.centerLat, state.map.centerLon], state.map.zoom, { animate: false });
  if (typeof setSelectedPoint === "function") setSelectedPoint(state.queryPoint.lat, state.queryPoint.lon, "geoquery_restore");
  else { selectedPoint = { lat: state.queryPoint.lat, lon: state.queryPoint.lon, source: "geoquery_restore", site: SITE_ID, timestamp: new Date().toISOString() }; window.selectedPoint = selectedPoint; }
  viewportRestoreApplied = true; geoQueryRestoreState = state; return true;
}

function installGeoQueryViewportRestoreHandlers() {
  window.addEventListener("pageshow", (event) => { if (!event.persisted) return; const state = resolveViewportRestoreState(SITE_ID); if (state && map) { restoreMapViewport(map, state); setTimeout(() => map.invalidateSize(false), 0); } });
  window.addEventListener("popstate", (event) => { const state = normalizeGeoQueryOriginState(event.state?.geoQueryOrigin, SITE_ID) || resolveViewportRestoreState(SITE_ID); if (state && map) restoreMapViewport(map, state); });
}

const REGIONES_PATH = "capas_selector/regiones.json";
let regionesSelector = [];

const GEOEVA_SEARCH_PATH = "./capas_tosearch/geoeva_tosearch_proyectos.geojson";
const GEOEVA_SEARCH_MIN_CHARS = 3;
const GEOEVA_SEARCH_MAX_RESULTS = 15;
const GEOEVA_SEARCH_DEBOUNCE_MS = 200;
let geoEvaSearchIndex = [];
let geoEvaSearchLoaded = false;
let geoEvaSearchMarker = null;
let geoEvaSearchTimer = null;

let summaryConfig = null;
let summaryFeaturesByLayer = {};

const panelLayersConfig = [
  {
    id: "eva_proyectos",
    label: "Proyectos SEA",
    file: "capas_panel/eva_panel.geojson",
    type: "point",
    labelField: "sector",
    visible: false
  }
];
const panelLayers = {};
window.panelLayers = panelLayers;
let evaPanelRawFeatures = [];
let evaPanelLoaded = false;
let evaPanelLabelsVisible = false;
let evaPanelGeometryLayerGroup = L.layerGroup();
let evaPanelLabelsLayerGroup = L.layerGroup();
let evaPanelUpdateTimer = null;
async function loadLabelCapacityConfig() {
  if (window.GeoXLabelGrid && typeof GeoXLabelGrid.loadCapacityConfig === "function") {
    await GeoXLabelGrid.loadCapacityConfig("capas_panel/label_capacity_config.json");
  }
}

async function initGeoEVASummary(mapInstance) {
  summaryConfig = await loadSummaryConfig();

  if (!summaryConfig || summaryConfig.activo !== true) {
    console.warn("GeoEVA summary no activo o no disponible");
    return;
  }

  await loadSummaryLayers(summaryConfig);
  updateGeoEVASummary(mapInstance);

  setTimeout(() => {
    updateGeoEVASummary(mapInstance);
  }, 500);

  mapInstance.on("moveend zoomend", () => {
    updateGeoEVASummary(mapInstance);
  });
}

async function loadSummaryConfig() {
  try {
    const configPaths = [
      "./parametros/summary_config.json",
      "./capas_summary/summary_config.json"
    ];

    for (const configPath of configPaths) {
      const configUrl = new URL(configPath, window.location.href).toString();
      const response = await fetch(configUrl, {
        cache: "no-store"
      });

      if (!response.ok) continue;

      const config = await response.json();
      console.log("GeoEVA summary config:", config);
      return config;
    }

    throw new Error("No se pudo cargar summary_config.json");
  } catch (error) {
    console.warn("GeoEVA: error cargando summary_config.json", error);
    return null;
  }
}

async function loadSummaryLayers(config) {
  summaryFeaturesByLayer = {};

  for (const capa of config.capas || []) {
    try {
      const layerUrl = new URL(capa.archivo, window.location.href).toString();
      const response = await fetch(layerUrl, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`No se pudo cargar ${capa.archivo}`);
      }

      const geojson = await response.json();
      const features = Array.isArray(geojson.features)
        ? geojson.features
        : [];

      summaryFeaturesByLayer[capa.id] = features;
      console.log("GeoEVA summary layer loaded:", capa.id, capa.archivo, features.length);
    } catch (error) {
      console.warn(`GeoEVA: error cargando capa summary ${capa.id}`, error);
      summaryFeaturesByLayer[capa.id] = [];
    }
  }
}

function getFeatureLatLon(feature) {
  if (
    feature &&
    feature.geometry &&
    feature.geometry.type === "Point" &&
    Array.isArray(feature.geometry.coordinates)
  ) {
    const lon = Number(feature.geometry.coordinates[0]);
    const lat = Number(feature.geometry.coordinates[1]);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }

  const props = feature.properties || {};
  const lat = Number(props.lat);
  const lon = Number(props.lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }

  return null;
}

function getVisibleSummaryFeatures(mapInstance, layerIds) {
  if (!mapInstance || typeof mapInstance.getBounds !== "function") return [];

  const bounds = mapInstance.getBounds();
  const visible = [];
  const ids = Array.isArray(layerIds) ? layerIds : [];

  ids.forEach((layerId) => {
    const features = summaryFeaturesByLayer[layerId] || [];

    features.forEach((feature) => {
      const point = getFeatureLatLon(feature);
      if (!point) return;

      if (bounds.contains(L.latLng(point.lat, point.lon))) {
        visible.push(feature);
      }
    });
  });

  console.log("GeoEVA summary visible features:", visible.length);

  return visible;
}

function applySummaryFilters(features, filtros = []) {
  if (!Array.isArray(filtros) || filtros.length === 0) {
    return features;
  }

  return features.filter((feature) => {
    const props = feature.properties || {};

    return filtros.every((filter) => {
      const value = props[filter.campo];

      if (filter.operador === "eq") {
        return value === filter.valor;
      }

      if (filter.operador === "in") {
        return Array.isArray(filter.valores) && filter.valores.includes(value);
      }

      return true;
    });
  });
}

function calculateSummaryIndicator(indicador, features) {
  const filteredFeatures = applySummaryFilters(features, indicador.filtros);

  if (indicador.operacion === "count") {
    return filteredFeatures.length;
  }

  if (indicador.operacion === "sum") {
    const total = filteredFeatures.reduce((acc, feature) => {
      const props = feature.properties || {};
      const value = Number(props[indicador.campo]);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0);

    return formatSummaryNumber(total, indicador);
  }

  if (indicador.operacion === "dominant_category_sum") {
    const totals = {};

    filteredFeatures.forEach((feature) => {
      const props = feature.properties || {};
      const category = props[indicador.campo_categoria];
      const value = Number(props[indicador.campo_valor]);

      if (!category || !Number.isFinite(value)) return;

      totals[category] = (totals[category] || 0) + value;
    });

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      return indicador.fallback || "Sin datos";
    }

    return sorted[0][0];
  }

  return "—";
}

function formatSummaryNumber(value, indicador = {}) {
  const decimals = Number.isInteger(indicador.decimales)
    ? indicador.decimales
    : 0;

  const formatted = Number(value).toLocaleString("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  const prefijo = indicador.prefijo ? `${indicador.prefijo} ` : "";
  const sufijo = indicador.sufijo ? ` ${indicador.sufijo}` : "";

  return `${prefijo}${formatted}${sufijo}`;
}

function updateGeoEVASummary(mapInstance) {
  if (!summaryConfig || !Array.isArray(summaryConfig.indicadores)) return;

  summaryConfig.indicadores.forEach((indicador) => {
    const layerIds = indicador.capas || [];
    const visibleFeatures = getVisibleSummaryFeatures(mapInstance, layerIds);
    const value = calculateSummaryIndicator(indicador, visibleFeatures);

    updateSummaryKpiDom(indicador.id, value, indicador.label);
  });
}

function updateSummaryKpiDom(indicatorId, value, label) {
  const card = document.querySelector(`[data-summary-id="${indicatorId}"]`);

  if (!card) {
    console.warn("GeoEVA KPI no encontrado:", indicatorId);
    return;
  }

  const valueEl = card.querySelector(".summary-value, .kpi-value");
  const labelEl = card.querySelector(".summary-label, .kpi-label");

  if (valueEl) valueEl.textContent = value;
  if (labelEl && label) labelEl.textContent = label;
}

function isCrossAccessNavigationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get(CROSS_ACCESS_PARAM_NAME) === CROSS_ACCESS_PARAM_VALUE ||
    params.get("source") === CROSS_ACCESS_PARAM_VALUE ||
    params.get("crossAccess") === "1"
  );
}

function getInitialCrossAccessStateFromUrl() {
  if (initialCrossAccessState) return initialCrossAccessState;

  const params = new URLSearchParams(window.location.search);

  const from = params.get("from");
  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  const viewLat = parseFloat(params.get("viewLat"));
  const viewLon = parseFloat(params.get("viewLon"));
  const zoom = parseFloat(params.get("zoom"));
  const requestedBasemap = (params.get("basemap") || "osm").toLowerCase();
  const basemap = requestedBasemap === "sat" ? "sat" : "osm";
  const isGeoQueryReturn = from === "geoquery";
  const hasReturnViewport = Number.isFinite(viewLat) && Number.isFinite(viewLon) && Number.isFinite(zoom);
  const hasPointViewport = Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(zoom);

  console.log("[GeoX navigation receive]", {
    from,
    lat,
    lon,
    viewLat,
    viewLon,
    zoom,
    basemap
  });

  initialCrossAccessState = {
    viewport: isGeoQueryReturn && hasReturnViewport
      ? { lat: viewLat, lon: viewLon, zoom }
      : hasPointViewport
        ? { lat, lon, zoom }
        : null,
    basemap
  };

  return initialCrossAccessState;
}

function getInitialViewportFromUrl() {
  return getInitialCrossAccessStateFromUrl().viewport;
}

function getInitialBasemapFromUrl() {
  return getInitialCrossAccessStateFromUrl().basemap;
}


let userLocationMarker = null;

function openGeoQueryFromLatLng(lat, lon) {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const center = map.getCenter();
  const zoom = map.getZoom();
  const basemap = currentBasemap || "osm";
  const url =
    `./geoquery/geoquery.html?site=${SITE_ID}` +
    `&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&viewLat=${encodeURIComponent(center.lat)}` +
    `&viewLon=${encodeURIComponent(center.lng)}` +
    `&zoom=${encodeURIComponent(zoom)}` +
    `&basemap=${encodeURIComponent(basemap)}` +
    `&from=index`;

  const originState = captureGeoQueryOriginState({ site: SITE_ID, map, queryLat: lat, queryLon: lon, basemap, from: isCrossAccessNavigationFromUrl() ? "crossaccess" : "index" });
  persistOriginStateBeforeGeoQuery(originState);
  window.location.href = appendOriginStateToGeoQueryUrl(url, originState);
}

function captureSelectedPoint(event, featureContext = null) {
  const latlng = event?.latlng || event;
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return null;

  if (featureContext && window.L?.DomEvent && event?.originalEvent) {
    L.DomEvent.stopPropagation(event);
  }

  const originalEvent = event?.originalEvent;
  if (featureContext && originalEvent) originalEvent.__geoxFeatureContext = featureContext;

  selectedPoint = {
    lat: latlng.lat,
    lon: latlng.lng,
    source: featureContext ? "layer_click" : "map_click",
    site: SITE_ID,
    timestamp: new Date().toISOString()
  };
  selectedFeatureContext = featureContext || originalEvent?.__geoxFeatureContext || null;
  window.selectedPoint = selectedPoint;
  window.selectedFeatureContext = selectedFeatureContext;

  if (event?.latlng) {
    openGeoQueryFromLatLng(latlng.lat, latlng.lng);
  }

  return selectedPoint;
}

function initGeoQueryClickPropagationGuards() {
  if (!window.L?.DomEvent) return;

  [
    "#control-bar",
    "#territorial-panel",
    "#search-box-wrapper",
    "#mobile-map-controls",
    "#main-footer",
    ".leaflet-control"
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      L.DomEvent.disableClickPropagation(element);
    });
  });
}

function getLocationByGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation no disponible"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  });
}

async function getLocationByIp() {
  try {
    const response = await fetch("https://ipapi.co/json/", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("No se pudo obtener ubicación por IP");
    }

    const data = await response.json();

    const lat = parseFloat(data.latitude);
    const lon = parseFloat(data.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("IP sin coordenadas válidas");
    }

    return { lat, lon };
  } catch (error) {
    console.warn("GeoX: ubicación por IP no disponible", error);
    return null;
  }
}

function applyUserLocation(mapInstance, location, zoomLevel = 14) {
  if (!mapInstance || !location) return;

  const lat = parseFloat(location.lat);
  const lon = parseFloat(location.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  mapInstance.setView([lat, lon], zoomLevel);

  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lon]);
  } else {
    userLocationMarker = L.marker([lat, lon]).addTo(mapInstance);
  }

  captureSelectedPoint({ lat, lng: lon });
}

async function initGeoXInitialLocation(mapInstance) {
  const incomingViewport = getInitialViewportFromUrl();

  if (incomingViewport) {
    mapInstance.setView(
      [incomingViewport.lat, incomingViewport.lon],
      incomingViewport.zoom
    );
    return;
  }

  try {
    const gpsLocation = await getLocationByGps();

    if (gpsLocation) {
      applyUserLocation(mapInstance, gpsLocation, window.GeoXLocationZoom || 11);
      return;
    }
  } catch (error) {
    console.warn("GeoX: GPS no disponible o no autorizado", error);
  }

  const ipLocation = await getLocationByIp();

  if (ipLocation) {
    applyUserLocation(mapInstance, ipLocation, window.GeoXLocationZoom || 11);
    return;
  }

  console.warn("GeoX: se mantiene ubicación default del sitio");
}

function initGeoXMyLocationButton(mapInstance) {
  const button =
    document.getElementById("my-location-btn") ||
    document.getElementById("locate-btn") ||
    document.getElementById("btn-my-location") ||
    document.querySelector(".my-location-btn") ||
    document.querySelector(".locate-btn") ||
    document.querySelector("[data-action='my-location']");

  if (!button) {
    console.warn("GeoX: botón Mi ubicación no encontrado");
    return;
  }

  button.addEventListener("click", async () => {
    try {
      const gpsLocation = await getLocationByGps();

      if (gpsLocation) {
        applyUserLocation(mapInstance, gpsLocation, window.GeoXLocationZoom || 11);
        return;
      }
    } catch (error) {
      console.warn("GeoX: GPS no disponible desde botón", error);
    }

    const ipLocation = await getLocationByIp();

    if (ipLocation) {
      applyUserLocation(mapInstance, ipLocation, window.GeoXLocationZoom || 11);
      return;
    }

    console.warn("GeoX: no se pudo determinar ubicación");
  });
}

function normalizeGeoEVASearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function getGeoEVASearchName(props) {
  return props.nombre_proyecto || props.nombre || props.titular || "Proyecto sin nombre";
}

function getGeoEVASearchLatLon(feature) {
  const props = feature.properties || {};
  const lat = Number(props.lat);
  const lon = Number(props.lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }

  if (
    feature.geometry &&
    feature.geometry.type === "Point" &&
    Array.isArray(feature.geometry.coordinates)
  ) {
    const geometryLon = Number(feature.geometry.coordinates[0]);
    const geometryLat = Number(feature.geometry.coordinates[1]);

    if (Number.isFinite(geometryLat) && Number.isFinite(geometryLon)) {
      return { lat: geometryLat, lon: geometryLon };
    }
  }

  return null;
}

function buildGeoEVASearchIndex(features) {
  const index = [];

  features.forEach((feature, featureIndex) => {
    const props = feature.properties || {};
    const coords = getGeoEVASearchLatLon(feature);

    if (!coords) {
      console.warn("[GeoEVA Search] registro omitido por coordenadas inválidas", featureIndex, props);
      return;
    }

    const nombre_proyecto = getGeoEVASearchName(props);
    const titular = props.titular || "";
    const region = props.region || "";
    const comuna = props.comuna || "";
    const sector = props.sector || "";
    const estado = props.estado || "";
    const searchText = normalizeGeoEVASearchText([
      nombre_proyecto,
      titular,
      comuna,
      region,
      sector,
      estado
    ].join(" "));

    index.push({
      index: featureIndex,
      nombre_proyecto,
      titular,
      region,
      comuna,
      sector,
      estado,
      lat: coords.lat,
      lon: coords.lon,
      geometry: feature.geometry,
      searchText
    });
  });

  return index;
}

async function loadGeoEVASearchIndex() {
  if (geoEvaSearchLoaded) return geoEvaSearchIndex;

  console.log("[GeoEVA Index] usando capas_tosearch/geoeva_tosearch_proyectos.geojson");
  const response = await fetch(GEOEVA_SEARCH_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar ${GEOEVA_SEARCH_PATH}`);

  const geojson = await response.json();
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  console.log("[GeoEVA Search] features cargadas:", features.length);

  geoEvaSearchIndex = buildGeoEVASearchIndex(features);
  geoEvaSearchLoaded = true;
  console.log("[GeoEVA Search] índice nacional listo:", geoEvaSearchIndex.length, "registros válidos");

  return geoEvaSearchIndex;
}

function formatGeoEVASearchResult(item) {
  return item.titular ? `${item.nombre_proyecto} · ${item.titular}` : item.nombre_proyecto;
}

function clearGeoEVASearchResults() {
  const results = document.getElementById("search-results");
  if (!results) return;
  results.innerHTML = "";
  results.classList.remove("is-open");
}

function searchGeoEVAProjects(query) {
  const normalizedQuery = normalizeGeoEVASearchText(query);
  if (normalizedQuery.length < GEOEVA_SEARCH_MIN_CHARS) return [];

  const results = [];
  for (const item of geoEvaSearchIndex) {
    if (!item.searchText.includes(normalizedQuery)) continue;
    results.push(item);
    if (results.length >= GEOEVA_SEARCH_MAX_RESULTS) break;
  }

  console.log(`[GeoEVA Search] búsqueda: ${normalizedQuery} | resultados: ${results.length}`);
  return results;
}

function renderGeoEVASearchResults(results) {
  const container = document.getElementById("search-results");
  if (!container) return;

  container.innerHTML = "";
  container.classList.toggle("is-open", results.length > 0);

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result-item";
    button.textContent = formatGeoEVASearchResult(result);
    button.title = button.textContent;
    button.addEventListener("click", () => selectGeoEVASearchResult(result));
    container.appendChild(button);
  });
}

function selectGeoEVASearchResult(result) {
  if (!map || !result) return;

  const lat = Number(result.lat);
  const lon = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  map.setView([lat, lon], 15);

  if (geoEvaSearchMarker) {
    geoEvaSearchMarker.setLatLng([lat, lon]);
  } else {
    geoEvaSearchMarker = L.marker([lat, lon]).addTo(map);
  }

  const input = document.getElementById("search-box");
  if (input) input.value = formatGeoEVASearchResult(result);
  clearGeoEVASearchResults();

  console.log(`[GeoEVA Search] zoom a proyecto: ${result.nombre_proyecto} | ${result.titular || ""}`);
}

function initGeoEVANationalSearch() {
  const input = document.getElementById("search-box");
  if (!input) return;

  loadGeoEVASearchIndex().catch((error) => {
    console.warn("[GeoEVA Search] error cargando índice nacional", error);
  });

  input.addEventListener("input", () => {
    if (geoEvaSearchTimer) clearTimeout(geoEvaSearchTimer);
    geoEvaSearchTimer = setTimeout(async () => {
      const query = input.value;
      if (normalizeGeoEVASearchText(query).length < GEOEVA_SEARCH_MIN_CHARS) {
        clearGeoEVASearchResults();
        return;
      }

      try {
        await loadGeoEVASearchIndex();
        renderGeoEVASearchResults(searchGeoEVAProjects(query));
      } catch (error) {
        console.warn("[GeoEVA Search] búsqueda no disponible", error);
        clearGeoEVASearchResults();
      }
    }, GEOEVA_SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearGeoEVASearchResults();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#search-box-wrapper")) clearGeoEVASearchResults();
  });
}

function getGeoXMapInstance() {
  if (window.geoxMap && typeof window.geoxMap.getCenter === "function") {
    return window.geoxMap;
  }

  if (window.map && typeof window.map.getCenter === "function") {
    return window.map;
  }

  return null;
}

function getCurrentMapState() {
  const mapInstance = getGeoXMapInstance();

  if (!mapInstance) {
    console.warn("GeoX: no se encontró instancia Leaflet para capturar estado del mapa.");
    return null;
  }

  const center = mapInstance.getCenter();

  return {
    lat: center.lat,
    lon: center.lng,
    zoom: mapInstance.getZoom(),
    basemap: currentBasemap || "osm"
  };
}

function buildCrossAccessUrl(sitePath) {
  const state = getCurrentMapState();
  const url = new URL(sitePath, window.location.href);
  url.searchParams.set(CROSS_ACCESS_PARAM_NAME, CROSS_ACCESS_PARAM_VALUE);

  if (!state) return url.toString();

  console.log("[GeoX cross_access send]", state);

  url.searchParams.set("lat", state.lat.toFixed(6));
  url.searchParams.set("lon", state.lon.toFixed(6));
  url.searchParams.set("zoom", String(state.zoom));
  url.searchParams.set("basemap", state.basemap);

  return url.toString();
}

function getCurrentViewportParams() {
  const state = getCurrentMapState();

  if (!state) return "";

  const params = new URLSearchParams();
  params.set("lat", state.lat.toFixed(6));
  params.set("lon", state.lon.toFixed(6));
  params.set("zoom", String(state.zoom));
  params.set("basemap", state.basemap);
  params.set(CROSS_ACCESS_PARAM_NAME, CROSS_ACCESS_PARAM_VALUE);

  return params.toString();
}

function isGeoXPortalLink(link) {
  if (!link) return false;

  const href = link.getAttribute("href") || "";
  const target = link.getAttribute("data-geox-target") || "";

  const value = `${href} ${target}`.toLowerCase();

  return (
    value.includes("geoipt") ||
    value.includes("geoeva") ||
    value.includes("geonemo") ||
    value.includes("geonoxa")
  );
}

function initGeoXCrossPortalNavigation() {
  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");

    if (!isGeoXPortalLink(link)) return;

    const rawTarget =
      link.getAttribute("data-geox-target") ||
      link.getAttribute("href");

    if (!rawTarget) return;

    event.preventDefault();

    window.location.href = buildCrossAccessUrl(rawTarget);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await iniciarMapa();
  initGeoQueryClickPropagationGuards();
  applyBasemap("osm");
  await cargarRegionesSelector();
  conectarRegionSelector();
  await initializeGeoEVARegionalViewport();
  initialViewportCompleted = true;
  viewportRestoreApplied = GeoXViewport.readCrossAccessViewport(new URLSearchParams(window.location.search))?.isValid === true;
  conectarBaseMapToggle();
  initGeoXMyLocationButton(map);
  initGeoXCrossPortalNavigation();
  initGeoEVANationalSearch();
  await loadLabelCapacityConfig();
  initPanelLayers();
  window.addEventListener("resize", scheduleEvaPanelViewportUpdate);
});

async function iniciarMapa() {
  const siteConfig = { ...(await GeoXViewport.loadSiteViewportConfig(SITE_ID)), ...SITE_CONFIG };
  window.GeoXLocationZoom = Number(siteConfig.locationViewport?.fallbackZoom ?? siteConfig.locationViewport?.zoom ?? siteConfig.defaultViewport?.fallbackZoom ?? siteConfig.defaultViewport?.zoom ?? 11);

  geoQueryRestoreState = null;
  map = L.map("map", {
    zoomSnap: siteConfig?.zoomLimits?.snap ?? 0.25,
    zoomDelta: siteConfig?.zoomLimits?.snap ?? 0.25
  });
  window.geoxMap = map;

  osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  });

  satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles © Esri"
  });

  window.geoxSiteConfig = siteConfig;
  applyBasemap("osm");
  initGeoEVASummary(map);

  L.control.scale({
    imperial: false
  }).addTo(map);

  map.on("click", captureSelectedPoint);
  map.on("moveend zoomend", scheduleEvaPanelViewportUpdate);
  installGeoQueryViewportRestoreHandlers();
}

function getEvaProjectMarkerStyle() {
  const isSat = currentBasemap === "sat";

  if (isSat) {
    return {
      radius: 5,
      color: "#111827",
      weight: 1.5,
      opacity: 1,
      fillColor: "#ccff00",
      fillOpacity: 0.95
    };
  }

  return {
    radius: 5,
    color: "#ffffff",
    weight: 1,
    opacity: 0.95,
    fillColor: "#2563eb",
    fillOpacity: 0.8
  };
}


function getMobileLabelEyeIcon(isVisible) {
  if (isVisible) {
    return `<svg class="mobile-layer-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>`;
  }
  return `<svg class="mobile-layer-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2.5 12s3.5-6 9.5-6c2.1 0 3.9.72 5.36 1.7M21.5 12s-3.5 6-9.5 6c-2.1 0-3.9-.72-5.36-1.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 9.8A3 3 0 0 1 14.2 14.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
}

function syncEvaMobileLabelToggle() {
  const mobileToggle = document.getElementById("mobile-layer-toggle");
  if (!mobileToggle) return;

  mobileToggle.classList.toggle("is-active", evaPanelLabelsVisible);
  mobileToggle.classList.toggle("is-inactive", !evaPanelLabelsVisible);
  mobileToggle.setAttribute("aria-pressed", String(evaPanelLabelsVisible));

  const action = evaPanelLabelsVisible ? "Ocultar" : "Mostrar";
  const label = `${action} etiquetas GeoEVA`;
  mobileToggle.setAttribute("aria-label", label);
  mobileToggle.setAttribute("title", label);

  const icon = mobileToggle.querySelector(".mobile-layer-toggle-icon");
  if (icon) icon.innerHTML = getMobileLabelEyeIcon(evaPanelLabelsVisible);
}

function initEvaMobileLabelToggle() {
  const mobileToggle = document.getElementById("mobile-layer-toggle");
  if (!mobileToggle) return;

  mobileToggle.addEventListener("click", () => {
    toggleEvaProjectsLayer(!evaPanelLabelsVisible);
  });
  syncEvaMobileLabelToggle();
}

async function initPanelLayers() {
  renderPanelLayerControls();
  initEvaMobileLabelToggle();
  await loadPanelLayers();
}

function renderPanelLayerControls() {
  const panel = document.getElementById("territorial-panel");
  if (!panel) return;

  panel.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Etiquetas";
  panel.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "panel-layer-controls";
  controls.setAttribute("aria-label", "Control de etiquetas GeoEVA");
  panel.appendChild(controls);

  panelLayersConfig.forEach((config) => {
    const label = document.createElement("label");
    label.className = "panel-layer-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = config.visible === true;
    checkbox.disabled = true;
    checkbox.dataset.panelLayerId = config.id;

    const text = document.createElement("span");
    text.textContent = `Mostrar etiquetas ${config.label}`;

    checkbox.addEventListener("change", () => {
      togglePanelLayer(config.id, checkbox.checked);
    });

    label.append(checkbox, text);
    controls.appendChild(label);
  });
}

async function loadPanelLayers() {
  panelLayers.eva_proyectos = evaPanelGeometryLayerGroup;
  setPanelLayerControlEnabled("eva_proyectos", true);

  const evaConfig = panelLayersConfig.find((config) => config.id === "eva_proyectos");
  evaPanelLabelsVisible = evaConfig?.visible === true;
  const checkbox = document.querySelector('[data-panel-layer-id="eva_proyectos"]');
  if (checkbox) checkbox.checked = evaPanelLabelsVisible;
  await toggleEvaProjectsLayer(evaPanelLabelsVisible);
}

async function loadEvaPanelData() {
  if (evaPanelLoaded) return;

  const response = await fetch("capas_panel/eva_panel.geojson", { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo cargar capas_panel/eva_panel.geojson");

  const geojson = await response.json();

  evaPanelRawFeatures = Array.isArray(geojson.features) ? geojson.features : [];
  evaPanelLoaded = true;

  console.log("[GeoEVA capas_panel] datos cargados", {
    totalFeatures: evaPanelRawFeatures.length
  });
}

function getEvaFeatureLatLon(feature) {
  const props = feature.properties || {};

  if (
    feature.geometry &&
    feature.geometry.type === "Point" &&
    Array.isArray(feature.geometry.coordinates)
  ) {
    const [lon, lat] = feature.geometry.coordinates;
    return { lat: Number(lat), lon: Number(lon) };
  }

  const lat = Number(props.lat);
  const lon = Number(props.lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }

  return null;
}

function getEvaProjectsInViewport() {
  const bounds = map.getBounds();
  const visibleProjects = [];

  for (const feature of evaPanelRawFeatures) {
    const coords = getEvaFeatureLatLon(feature);
    if (!coords) continue;

    const latlng = L.latLng(coords.lat, coords.lon);

    if (!bounds.contains(latlng)) continue;

    const props = feature.properties || {};

    visibleProjects.push({
      lat: coords.lat,
      lon: coords.lon,
      sector: props.sector || "",
      estado: props.estado || "",
      inversion_mmusd: props.inversion_mmusd ?? null,
      fid: props.fid ?? null
    });
  }

  return visibleProjects;
}

function renderEvaProjectsInViewport() {
  const visibleProjects = getEvaProjectsInViewport();

  evaPanelGeometryLayerGroup.clearLayers();
  evaPanelLabelsLayerGroup.clearLayers();

  const labelsAllowed = evaPanelLabelsVisible;
  const labelCandidates = [];

  visibleProjects.forEach((project, index) => {
    if (!Number.isFinite(project.lat) || !Number.isFinite(project.lon)) return;

    const latlng = L.latLng(project.lat, project.lon);
    L.circleMarker(latlng, getEvaProjectMarkerStyle())
      .on("click", (event) => captureSelectedPoint(event, {
        site: SITE_ID,
        layer_id: "eva_proyectos",
        feature_id: project.fid ?? null,
        feature_name: project.sector || "",
        source_layer: "capas_panel/eva_panel.geojson"
      }))
      .addTo(evaPanelGeometryLayerGroup);

    if (!labelsAllowed) return;

    const labelText = GeoXLabelFormatter.formatLabelText("geoeva", "geoeva_proyectos", project.sector);
    if (!labelText) return;

    labelCandidates.push({
      latlng,
      text: labelText,
      id: project.fid ?? `${labelText}-${index}`,
      originalIndex: index
    });
  });

  if (labelsAllowed) {
    GeoXLabelGrid.selectLabels(map, labelCandidates).forEach((label) => {
      L.marker(label.latlng, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "eva-project-label",
          html: escapeHtml(label.text),
          iconSize: null
        })
      }).addTo(evaPanelLabelsLayerGroup);
    });
  }

  console.log("[GeoEVA capas_panel] viewport render", {
    totalFeatures: evaPanelRawFeatures.length,
    visiblesViewport: visibleProjects.length,
    zoom: map.getZoom(),
    labels: labelsAllowed
  });
}

function setPanelLayerControlEnabled(layerId, enabled) {
  const checkbox = document.querySelector(`[data-panel-layer-id="${layerId}"]`);
  if (checkbox) checkbox.disabled = !enabled;
}

async function toggleEvaProjectsLayer(checked) {
  evaPanelLabelsVisible = checked;

  try {
    await loadEvaPanelData();

    if (!map.hasLayer(evaPanelGeometryLayerGroup)) {
      evaPanelGeometryLayerGroup.addTo(map);
    }

    if (!map.hasLayer(evaPanelLabelsLayerGroup)) {
      evaPanelLabelsLayerGroup.addTo(map);
    }

    renderEvaProjectsInViewport();
  } catch (error) {
    evaPanelLabelsVisible = false;
    const checkbox = document.querySelector('[data-panel-layer-id="eva_proyectos"]');
    if (checkbox) checkbox.checked = false;
    syncEvaMobileLabelToggle();
    console.warn("[GeoEVA capas_panel] error cargando capa eva_proyectos", error);
  }

  syncEvaMobileLabelToggle();

  console.log("[GeoEVA capas_panel] toggle etiquetas", {
    labelsVisible: evaPanelLabelsVisible
  });
}

function togglePanelLayer(layerId, checked) {
  if (layerId === "eva_proyectos") {
    toggleEvaProjectsLayer(checked);
  }
}

function scheduleEvaPanelViewportUpdate() {
  if (evaPanelUpdateTimer) {
    clearTimeout(evaPanelUpdateTimer);
  }

  evaPanelUpdateTimer = setTimeout(() => {
    renderEvaProjectsInViewport();
  }, 120);
}


// GEOFACTORY SELECTOR REGIÓN
// CARGA regiones.json
async function cargarRegionesSelector() {
  const selector = document.getElementById("region-selector");
  if (!selector) return null;

  try {
    const response = await fetch(REGIONES_PATH);
    if (!response.ok) throw new Error(`No se pudo cargar ${REGIONES_PATH}`);

    const data = await response.json();
    regionesSelector = Array.isArray(data)
      ? data.filter((region) => region && region.activo === true)
      : [];

    if (!regionesSelector.length) {
      throw new Error(`${REGIONES_PATH} no contiene regiones activas`);
    }

    selector.innerHTML = "";
    regionesSelector.forEach((region) => {
      const option = document.createElement("option");
      option.value = String(region.codigo_ine || "");
      option.textContent = region.nombre || "Región sin nombre";
      selector.appendChild(option);
    });

    console.info(
      "[GeoEVA Init] Opciones regionales:",
      [...selector.options].map((option) => ({
        text: option.textContent,
        value: option.value
      }))
    );

    return selector;
  } catch (error) {
    regionesSelector = [];
    console.warn("GEOFACTORY SELECTOR REGIÓN: regiones.json no disponible. Se mantiene el selector actual como respaldo.", error);
    return selector;
  }
}

function normalizeRegionName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^region de /, "")
    .replace(/^region /, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findAntofagastaOption(selectElement) {
  return [...(selectElement?.options || [])].find((option) => {
    const normalizedText = normalizeRegionName(option.textContent);
    return normalizedText === "antofagasta";
  }) || null;
}

async function initializeAntofagastaRegion() {
  const regionSelector = document.getElementById("region-selector");
  const option = findAntofagastaOption(regionSelector);

  if (!option) {
    console.error("[GeoEVA Init] No se encontró Región de Antofagasta");
    return false;
  }

  regionSelector.value = option.value;

  console.info("[GeoEVA Init] Región aplicada:", {
    text: option.textContent,
    value: option.value,
    selectedValue: regionSelector.value
  });

  await moverViewportPorRegion(option.value, { source: "initialization" });
  return true;
}

async function initializeGeoEVARegionalViewport() {
  const crossViewport = GeoXViewport.readCrossAccessViewport(new URLSearchParams(window.location.search));

  if (crossViewport?.isValid) {
    applyBasemap(crossViewport.basemap);
    map.setView([crossViewport.centerLat, crossViewport.centerLon], crossViewport.zoom, { animate: false });
    map.__geoxInitialViewportApplied = true;
    map.__geoxInitialViewport = {
      source: "cross-access",
      center: { lat: crossViewport.centerLat, lon: crossViewport.centerLon },
      zoom: crossViewport.zoom,
      basemap: crossViewport.basemap
    };
    console.info("[GeoEVA Init] Source: cross-access");
    return true;
  }

  applyBasemap("osm");
  const selected = await initializeAntofagastaRegion();
  map.__geoxInitialViewportApplied = selected;
  map.__geoxInitialViewport = { source: "initial-region", region: "Región de Antofagasta", basemap: "osm" };
  return selected;
}

function conectarRegionSelector() {
  const regionSelector = document.getElementById("region-selector");
  if (!regionSelector) return;

  regionSelector.addEventListener("change", () => moverViewportPorRegion(regionSelector.value));
}

// MOVER VIEWPORT POR REGIÓN
function moverViewportPorRegion(codigoIne) {
  if (!map || !codigoIne || !regionesSelector.length) return;

  const region = regionesSelector.find((item) => String(item.codigo_ine) === String(codigoIne));
  if (!region) return;

  if (Array.isArray(region.bbox) && region.bbox.length === 2) {
    map.fitBounds(region.bbox);
    return;
  }

  if (Array.isArray(region.centro) && region.centro.length === 2) {
    const zoom = Number.isFinite(Number(region.zoom)) ? Number(region.zoom) : map.getZoom();
    map.setView(region.centro, zoom);
  }
}

function conectarBaseMapToggle() {
  const btnOsm = getBaseMapButton("osm");
  const btnSat = getBaseMapButton("sat");

  if (btnOsm) {
    btnOsm.addEventListener("click", () => switchBaseMap("osm"));
  }

  if (btnSat) {
    btnSat.addEventListener("click", () => switchBaseMap("sat"));
  }
}

function getBaseMapButton(type) {
  const explicitSelectors = type === "osm"
    ? ["#btn-osm", "#osmBtn", ".btn-osm", '[data-map="osm"]']
    : ["#btn-sat", "#satBtn", ".btn-sat", '[data-map="sat"]'];

  for (const selector of explicitSelectors) {
    const button = document.querySelector(selector);
    if (button) return button;
  }

  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent.trim().toLowerCase() === type
  );
}

function applyBasemap(name = "osm") {
  if (!map || !osmLayer || !satLayer) return;

  const normalized = name === "sat" ? "sat" : "osm";
  const layer = normalized === "sat" ? satLayer : osmLayer;
  const previousLayer = normalized === "sat" ? osmLayer : satLayer;

  if (map.hasLayer(previousLayer)) {
    map.removeLayer(previousLayer);
  }

  if (layer && !map.hasLayer(layer)) {
    layer.addTo(map);
  }

  currentBaseLayer = layer;
  currentBasemap = normalized;
  setBaseMapToggleActive(currentBasemap);
}

function switchBaseMap(type) {
  if (!map || !osmLayer || !satLayer) return;

  const nextLayer = type === "sat" ? satLayer : osmLayer;
  const previousLayer = type === "sat" ? osmLayer : satLayer;

  if (map.hasLayer(previousLayer)) {
    map.removeLayer(previousLayer);
  }

  if (!map.hasLayer(nextLayer)) {
    nextLayer.addTo(map);
  }

  currentBaseLayer = nextLayer;
  currentBasemap = type === "sat" ? "sat" : "osm";
  setBaseMapToggleActive(currentBasemap);

  renderEvaProjectsInViewport();
}

function setBaseMapToggleActive(type) {
  const btnOsm = getBaseMapButton("osm");
  const btnSat = getBaseMapButton("sat");

  if (btnOsm) {
    btnOsm.classList.toggle("active", type === "osm");
    btnOsm.setAttribute("aria-pressed", String(type === "osm"));
  }

  if (btnSat) {
    btnSat.classList.toggle("active", type === "sat");
    btnSat.setAttribute("aria-pressed", String(type === "sat"));
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

(function initGeoFactoryIntroModal() {
  const MODAL_CONFIG_PATH = "./parametros/log-modal.json";
  const MODAL_CONFIG_FALLBACK_PATH = "./assets/log-modal.json";

  async function loadModalConfig() {
    const response = await fetch(MODAL_CONFIG_PATH);
    if (response.ok) return response.json();

    const fallbackResponse = await fetch(MODAL_CONFIG_FALLBACK_PATH);
    if (!fallbackResponse.ok) throw new Error(`No se pudo cargar ${MODAL_CONFIG_PATH}`);
    return fallbackResponse.json();
  }

  function ensureModalStyles() {
    if (document.getElementById("geofactory-intro-modal-styles")) return;

    const style = document.createElement("style");
    style.id = "geofactory-intro-modal-styles";
    style.textContent = `
      .geofactory-intro-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(3,7,18,.68)}
      .geofactory-intro-modal{width:min(92vw,560px);max-height:90vh;overflow-y:auto;border-radius:18px;background:#fff;color:#071225;padding:24px;box-shadow:0 28px 80px rgba(0,0,0,.38);text-align:center;font-family:inherit}
      .geofactory-intro-image{display:block;width:100%;max-width:480px;height:auto;margin:0 auto 20px;border-radius:12px}
      .geofactory-intro-actions{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
      .geofactory-intro-button{border:0;border-radius:12px;padding:14px 26px;background:#071225;color:#fff;font-weight:800;font-size:.95rem;cursor:pointer;box-shadow:0 12px 28px rgba(7,18,37,.22)}
      .geofactory-intro-button:hover{transform:translateY(-1px)}
      .geofactory-intro-button:focus-visible,.geofactory-intro-check input:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:3px}
      .geofactory-intro-check{display:inline-flex;align-items:center;gap:8px;color:#4b5563;font-size:.95rem;cursor:pointer}
      .geofactory-intro-check input{width:16px;height:16px}
      @media(max-width:640px){.geofactory-intro-overlay{padding:12px}.geofactory-intro-modal{width:min(94vw,420px);padding:20px;border-radius:16px}.geofactory-intro-actions{flex-direction:column;gap:12px}.geofactory-intro-button{width:100%}.geofactory-intro-image{max-width:100%;margin-bottom:18px}}
    `;
    document.head.appendChild(style);
  }

  function localStorageHas(storageKey) {
    return Boolean(storageKey && window.localStorage.getItem(storageKey));
  }

  function buildModal(modalIntro) {
    const imageConfig = modalIntro.imagen || {};
    const imageSrc = `${imageConfig.ruta || ""}${imageConfig.archivo || ""}`;
    if (!imageSrc) return null;

    const existingHardcodedOverlay = document.getElementById("geoipt-intro-overlay");
    if (existingHardcodedOverlay) existingHardcodedOverlay.remove();

    const overlay = document.createElement("div");
    overlay.className = "geofactory-intro-overlay";

    const modal = document.createElement("div");
    modal.className = "geofactory-intro-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Modal introductorio");

    const image = document.createElement("img");
    image.className = "geofactory-intro-image";
    image.src = imageSrc;
    image.alt = imageConfig.alt || "Instrucciones de uso";

    const actions = document.createElement("div");
    actions.className = "geofactory-intro-actions";

    const button = document.createElement("button");
    button.className = "geofactory-intro-button";
    button.type = "button";
    button.textContent = modalIntro.botonTexto || "Comenzar";

    const label = document.createElement("label");
    label.className = "geofactory-intro-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";

    label.append(checkbox, document.createTextNode("No volver a mostrar"));
    actions.append(button, label);
    modal.append(image, actions);
    overlay.appendChild(modal);

    button.addEventListener("click", () => {
      if (checkbox.checked && modalIntro.storageKey) {
        window.localStorage.setItem(modalIntro.storageKey, "true");
      }
      overlay.remove();
    });

    return overlay;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (isCrossAccessNavigationFromUrl()) {
        const existingHardcodedOverlay = document.getElementById("geoipt-intro-overlay");
        if (existingHardcodedOverlay) existingHardcodedOverlay.remove();
        return;
      }

      const config = await loadModalConfig();
      const modalIntro = config && config.modalIntro;
      if (!modalIntro || modalIntro.activo !== true || localStorageHas(modalIntro.storageKey)) return;

      ensureModalStyles();
      const modal = buildModal(modalIntro);
      if (modal) document.body.appendChild(modal);
    } catch (error) {
      console.warn("GeoFactory modal inicial no disponible.", error);
    }
  });
})();
