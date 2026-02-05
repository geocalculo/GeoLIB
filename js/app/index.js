// js/app/index.js
// GeoEVA (Explorador full-height) - Bootstrap según nuevo diseño
// - Mapa + BBOX (moveend)
// - Resumen Región/Estado + Resumen Sector
// - Click en mapa abre mapainfo.html
// - Guarda basemap prefs en localStorage (geoeva_basemap)
//
// Requiere (en index.html):
// 1) Leaflet (global L)
// 2) XLSX (global XLSX)
// 3) <script type="module" src="js/app/index.js"></script>

import { loadProyectosXlsx } from "../core/dataLoader.js";
import { escapeHtml } from "../core/utils.js";

// 🎈 Balloon UX: pista inicial (1 segundo)
function showMapBalloon() {
  const balloon = document.getElementById("map-balloon");
  if (!balloon) return;

  // (opcional) por si el CSS aún no animó, lo hace visible
  balloon.style.opacity = "1";

  // remover del DOM luego de la animación
  setTimeout(() => {
    balloon.remove();
  }, 3200);
}


const DATA_XLSX_URL = "capas/nacional.xlsx";
const REGIONES_JSON_URL = "capas/regiones.json";

// ---------------------------
// Estado mínimo (por ahora)
// ---------------------------
const state = {
  proyectos: [],
  map: null,
  markersLayer: null,
  regiones: [],
};

// ---------------------------
// Basemap prefs (herencia a mapainfo.html)
// ---------------------------
function saveBasemapPrefs({
  addOSM = true,
  osmOpacity = 1.0,
  addIMG = true,
  imgOpacity = 0.2,
} = {}) {
  try {
    localStorage.setItem(
      "geoeva_basemap",
      JSON.stringify({ addOSM, osmOpacity, addIMG, imgOpacity })
    );
  } catch (e) {
    console.warn("No se pudo guardar geoeva_basemap:", e);
  }
}

// ---------------------------
// Lectura controles
// ---------------------------
function getModoSeleccion() {
  const rb = document.querySelector('input[name="modoSeleccion"]:checked');
  return rb ? rb.value : "proximidad";
}

function getRadioAnalisisKm() {
  const slider = document.getElementById("radioSlider");
  if (!slider) return 10;
  const val = parseInt(slider.value, 10);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

function getNProximos() {
  const slider = document.getElementById("nSlider");
  if (!slider) return 10;
  const val = parseInt(slider.value, 10);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

// ---------------------------
// Regiones
// ---------------------------
async function loadRegionesData() {
  const select = document.getElementById("region-select");
  try {
    const resp = await fetch(REGIONES_JSON_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("regiones.json no es JSON válido (Content-Type inesperado)");
    }
    state.regiones = await resp.json();
    populateRegionSelect();
  } catch (err) {
    console.error("❌ Error cargando regiones.json:", err);
    state.regiones = [];
    if (select) {
      select.innerHTML = '<option value="">❌ Error cargando regiones</option>';
    }
  }
}

function populateRegionSelect() {
  const select = document.getElementById("region-select");
  if (!select) return;

  select.innerHTML = '<option value="">Selecciona una región</option>';
  state.regiones.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.nombre;
    select.appendChild(opt);
  });

  select.addEventListener("change", onRegionChange);
}

function onRegionChange(e) {
  const regionId = e.target.value;
  if (!regionId || !state.map) return;

  const region = state.regiones.find((r) => r.id === regionId);
  if (!region) return;

  if (region.centro && region.zoom) {
    state.map.setView(region.centro, region.zoom);
  }

  setTimeout(() => refreshByBbox(), 250);
}

// --------------------------------
// GEOLOCATION (inicio por ubicación usuario)
// --------------------------------
const FALLBACK_VIEW = { center: [-23.6509, -70.3975], zoom: 9 }; // Antofagasta
const USER_ZOOM = 12;
let __geoLayer = null;

function setBboxInfo(msg, mode = "") {
  const el = document.getElementById("bboxInfo");
  if (!el) return;
  el.textContent = msg;
  el.dataset.mode = mode; // "geo" cuando el mensaje es GPS
}

function canOverwriteBboxInfo() {
  const el = document.getElementById("bboxInfo");
  return !el || el.dataset.mode !== "geo";
}

function clearGeoLayer() {
  if (!state.map || !__geoLayer) return;
  try { __geoLayer.remove(); } catch (_) {}
  __geoLayer = null;
}

function drawGeo(lat, lon, acc) {
  clearGeoLayer();
  __geoLayer = L.layerGroup().addTo(state.map);

  L.circleMarker([lat, lon], { radius: 7, weight: 2, fillOpacity: 0.7 }).addTo(__geoLayer);
  L.circle([lat, lon], {
    radius: Math.min(Math.max(acc ?? 50, 25), 800),
    weight: 1,
    fillOpacity: 0.08,
  }).addTo(__geoLayer);
}

function tryCenterOnUser() {
  const map = state.map;
  if (!map) return;

  console.log("[geo] origin:", window.location.origin, "secure:", window.isSecureContext);
  if (!("geolocation" in navigator)) {
    console.warn("[geo] sin geolocation → fallback");
    map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    return;
  }

  setBboxInfo("📍 Buscando tu ubicación… (permite el GPS)", "geo");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      console.log("[geo] OK", latitude, longitude, "±", Math.round(accuracy || 0), "m");

      map.setView([latitude, longitude], USER_ZOOM, { animate: true });
      drawGeo(latitude, longitude, accuracy);

      setBboxInfo(`📍 Tu ubicación (±${Math.round(accuracy || 0)} m)`, "geo");
    },
    (err) => {
      console.warn("[geo] ERROR", err?.code, err?.message, "→ fallback");
      map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
      setBboxInfo(`📍 GPS no disponible (code ${err?.code ?? "?"}) → fallback`, "geo");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

// Botón Leaflet "📍" para reintentar cuando el usuario quiera
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
        tryCenterOnUser();
      });
      return btn;
    },
  });

  map.addControl(new LocateControl());
}


// ---------------------------
// Mapa
// ---------------------------
function initMap() {
  const map = L.map("map", {
    center: FALLBACK_VIEW.center,
    zoom: FALLBACK_VIEW.zoom,

    minZoom: 4,
    zoomControl: true,
  });

  window.__leafletMap = map;


// --- Onboarding: avisar que el mapa ya está listo ---
window.map = map; // fallback útil (opcional)
window.dispatchEvent(new CustomEvent("geoeva:map-ready", { detail: { map } }));

setTimeout(showMapBalloon, 100);


  const capaOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1.0,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const capaSatelite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.2, maxZoom: 19 }
  ).addTo(map);

  // Guardar receta actual (para heredar en mapainfo.html)
  saveBasemapPrefs({
    addOSM: true,
    osmOpacity: 1.0,
    addIMG: true,
    imgOpacity: 0.2,
  });

  L.control.scale().addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  map.on("moveend", refreshByBbox);
  map.on("click", onMapClick);

  // invalidate para layout full-height
  setTimeout(() => map.invalidateSize(), 100);

  state.map = map;
  state.markersLayer = markersLayer;

    // ✅ Botón + intento inicial de geolocalización
  addLocateButton(map);
  tryCenterOnUser();

}

// ---------------------------
// Marcadores (BBOX visible)
// ---------------------------
function drawMarkers(proyectosVisibles) {
  const layer = state.markersLayer;
  if (!layer) return;

  layer.clearLayers();

  const colores = {
    Aprob: "#10b981",
    Calif: "#f59e0b",
    Rech: "#ef4444",
    Otros: "#6b7280",
  };

  proyectosVisibles.forEach((p) => {
    const estadoLower = String(p.estado || "").toLowerCase();
    const estadoKey =
      estadoLower.includes("aprob")
        ? "Aprob"
        : estadoLower.includes("calif") || estadoLower.includes("eval")
        ? "Calif"
        : estadoLower.includes("rech")
        ? "Rech"
        : "Otros";

    const color = colores[estadoKey] || "#6b7280";

    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      fillColor: color,
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8,
    });

    marker.bindPopup(`
      <strong>${escapeHtml(p.nombre)}</strong><br/>
      Estado: ${escapeHtml(p.estado)}<br/>
      Sector: ${escapeHtml(p.sector)}<br/>
      Región: ${escapeHtml(p.region)}
    `);

    layer.addLayer(marker);
  });
}

// ---------------------------
// Resúmenes (tablas)
// ---------------------------
function calcResumenRegionEstado(proyectosInView) {
  const resumen = {};
  proyectosInView.forEach((p) => {
    const region = p.region || "Sin región";
    if (!resumen[region]) resumen[region] = { Aprob: 0, Calif: 0, Rech: 0 };

    const estadoLower = String(p.estado || "").toLowerCase();
    const estadoKey =
      estadoLower.includes("aprob")
        ? "Aprob"
        : estadoLower.includes("calif") || estadoLower.includes("eval")
        ? "Calif"
        : "Rech";

    resumen[region][estadoKey]++;
  });
  return resumen;
}

function renderSummaryTable(resumen) {
  const container = document.getElementById("summaryTableContainer");
  if (!container) return;

  const regiones = Object.keys(resumen);
  if (!regiones.length) {
    container.innerHTML = "<p>No hay proyectos visibles para la vista actual.</p>";
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Región / Estado</th>
          <th>Aprob</th>
          <th>Calif</th>
          <th>Rech</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const region of regiones) {
    const r = resumen[region];
    html += `
      <tr>
        <td>${escapeHtml(region)}</td>
        <td>${r.Aprob}</td>
        <td>${r.Calif}</td>
        <td>${r.Rech}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  container.innerHTML = html;
}

function calcResumenSector(proyectosInView) {
  const counts = new Map();
  proyectosInView.forEach((p) => {
    const sector = String(p.sector || "").trim() || "Sin sector";
    counts.set(sector, (counts.get(sector) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count);
}

function renderSectorTable(rows) {
  const container = document.getElementById("sectorTableContainer");
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = "<p>No hay proyectos visibles para la vista actual.</p>";
    return;
  }

  const total = rows.reduce((acc, r) => acc + r.count, 0);

  let html = `
    <table>
      <thead>
        <tr>
          <th>Sector</th>
          <th style="text-align:right;">#</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of rows) {
    html += `
      <tr>
        <td>${escapeHtml(r.sector)}</td>
        <td style="text-align:right; font-weight:800;">${r.count}</td>
      </tr>
    `;
  }

  html += `
      </tbody>
      <tfoot>
        <tr>
          <td style="font-weight:900;">TOTAL</td>
          <td style="text-align:right; font-weight:900;">${total}</td>
        </tr>
      </tfoot>
    </table>
  `;

  container.innerHTML = html;
}

// ---------------------------
// Resumen móvil (cards Aprob / Calif / Rech)
// ---------------------------
function updateMobileSummary(proyectosInView) {
  const root = document.getElementById("mobileSummary");
  if (!root) return;

  let aprobados = 0;
  let calificacion = 0;
  let rechazados = 0;

  proyectosInView.forEach((p) => {
    const e = String(p.estado || "").toLowerCase();

    if (e.includes("rech") || e.includes("desfavorable") || e.includes("inadmis") || e.includes("no admit") || e.includes("desist")) {
      rechazados++;
    } else if (e.includes("aprob") || e.includes("favorable") || e.includes("rca favorable")) {
      aprobados++;
    } else {
      calificacion++;
    }
  });

  const setVal = (key, val) => {
    const el = root.querySelector(`.ms-value[data-key="${key}"]`);
    if (el) el.textContent = String(val);
  };

  setVal("aprobados", aprobados);
  setVal("calificacion", calificacion);
  setVal("rechazados", rechazados);
}



// ---------------------------
// Refresh por BBOX (moveend)
// ---------------------------
function refreshByBbox() {
  const map = state.map;
  if (!map || !state.proyectos.length) return;

  const bounds = map.getBounds();

  const proyectosEnBBox = state.proyectos.filter((p) => bounds.contains([p.lat, p.lon]));

  drawMarkers(proyectosEnBBox);

  if (canOverwriteBboxInfo()) {
    const bboxInfo = document.getElementById("bboxInfo");
    if (bboxInfo) bboxInfo.textContent = `Proyectos en pantalla: ${proyectosEnBBox.length} proyectos`;
  }


  const resumenRE = calcResumenRegionEstado(proyectosEnBBox);
  renderSummaryTable(resumenRE);

  const resumenSec = calcResumenSector(proyectosEnBBox);
  renderSectorTable(resumenSec);
  updateMobileSummary(proyectosEnBBox);

}

// ---------------------------
// Click en mapa → mapainfo.html
// ---------------------------
function onMapClick(e) {
  const { lat, lng } = e.latlng;

  const modo = getModoSeleccion(); // proximidad (tu UI actual)
  const radioKm = getRadioAnalisisKm(); // puede no existir
  const n = getNProximos();

  const url = new URL("mapainfo.html", window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lng", lng.toFixed(6));
  url.searchParams.set("modo", modo);
  url.searchParams.set("radio", radioKm.toString());
  url.searchParams.set("n", n.toString());

  window.open(url.toString(), "_blank");
}

// ---------------------------
// Panel responsive móvil
// ---------------------------
function initPanelResponsive() {
  const panel = document.getElementById("configPanel");
  const backdrop = document.getElementById("panelBackdrop");
  const headerBtn = document.getElementById("togglePanelBtn");
  if (!panel) return;

  const isMobile = () => window.innerWidth < 768;
  let isOpen = false;

  function updateUI() {
    if (isMobile()) {
      if (isOpen) {
        panel.classList.add("is-open");
        backdrop?.classList.add("active");
        if (headerBtn) headerBtn.textContent = "✕ Cerrar";
        document.body.style.overflow = "hidden";
      } else {
        panel.classList.remove("is-open");
        backdrop?.classList.remove("active");
        if (headerBtn) headerBtn.textContent = "☰ Configuración";
        document.body.style.overflow = "";
      }
    } else {
      panel.classList.remove("is-open");
      backdrop?.classList.remove("active");
      document.body.style.overflow = "";
      if (headerBtn) headerBtn.textContent = "☰ Configuración";
    }

    if (state.map) setTimeout(() => state.map.invalidateSize(), 250);
  }

  function toggle() {
    if (!isMobile()) return;
    isOpen = !isOpen;
    updateUI();
  }

  function close() {
    if (!isMobile()) return;
    isOpen = false;
    updateUI();
  }

  updateUI();
  headerBtn?.addEventListener("click", toggle);
  backdrop?.addEventListener("click", close);

  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!isMobile()) isOpen = false;
      updateUI();
    }, 150);
  });

  panel.addEventListener("click", (e) => e.stopPropagation());
}

// ---------------------------
// Controles (slider N)
// ---------------------------
function initControls() {
  const nSlider = document.getElementById("nSlider");
  const nValueSpan = document.getElementById("nValue");
  if (nSlider && nValueSpan) {
    nValueSpan.textContent = nSlider.value;
    nSlider.addEventListener("input", () => {
      nValueSpan.textContent = nSlider.value;
    });
  }
}

// ---------------------------
// Main
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 GeoEVA app/index.js iniciando...");

  initMap();
  initControls();
  initPanelResponsive();

  await loadRegionesData();

  try {
    // Perfil "index": nombre/region/estado/sector/lat/lon
    state.proyectos = await loadProyectosXlsx(DATA_XLSX_URL, "index");
    console.log("✔ Proyectos cargados:", state.proyectos.length);
  } catch (err) {
    console.error("❌ Error cargando XLSX:", err);
    return;
  }

  refreshByBbox();
  console.log("✅ GeoEVA Explorador listo (nuevo app/index.js).");
});
