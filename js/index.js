// js/app/index.js
// Requiere: <script type="module" src="js/app/index.js"></script>

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

// -------- helpers mínimos
function parseCoord(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function pickBucket(estado) {
  const e = String(estado || "").toLowerCase();
  if (e.includes("aprob")) return "Aprob";
  if (e.includes("calif")) return "Calif";
  if (e.includes("rech")) return "Rech";
  return "Otros";
}

// -------- loaders
async function loadRegionesData() {
  try {
    const resp = await fetch(REGIONES_JSON_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const regiones = await resp.json();
    populateRegionSelect(regiones);
  } catch (err) {
    console.error("❌ Error cargando regiones.json:", err);
    const select = document.getElementById("region-select");
    if (select) select.innerHTML = '<option value="">❌ Error cargando regiones</option>';
  }
}

function populateRegionSelect(regiones) {
  const select = document.getElementById("region-select");
  if (!select) return;

  select.innerHTML = '<option value="">Selecciona una región</option>';

  regiones.forEach((region) => {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.nombre;
    select.appendChild(option);
  });

  select.addEventListener("change", (e) => {
    const regionId = e.target.value;
    if (!regionId || !map) return;

    const region = regiones.find((r) => r.id === regionId);
    if (!region) return;

    if (region.centro && region.zoom) map.setView(region.centro, region.zoom + 2);
    setTimeout(actualizarResumenYCapas, 250);
  });
}

async function loadExcelData() {
  const resp = await fetch(DATA_XLSX_URL);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!json.length) return [];

  const rows = json.slice(1);

  const COL_NOMBRE = 0;
  const COL_REGION = 3;
  const COL_ESTADO = 11;
  const COL_SECTOR = 13;
  const COL_LAT = 14;
  const COL_LON = 15;

  const data = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    const lat = parseCoord(row[COL_LAT]);
    const lon = parseCoord(row[COL_LON]);
    if (lat === null || lon === null) continue;

    const estado = row[COL_ESTADO] || "";

    data.push({
      lat,
      lon,
      nombre: row[COL_NOMBRE] || "",
      region: row[COL_REGION] || "",
      estado,
      sector: row[COL_SECTOR] || "",
      bucket: pickBucket(estado),
    });
  }

  return data;
}

// -------- map
function initMap() {
  map = L.map("map", { center: [-33.45, -70.65], zoom: 10, minZoom: 4, zoomControl: true });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1.0,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.2, maxZoom: 19 }
  ).addTo(map);

  L.control.scale().addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on("moveend", actualizarResumenYCapas);
  map.on("click", onMapClick);

  setTimeout(() => map.invalidateSize(), 120);
}

function proyectosEnPantalla() {
  if (!map || !proyectos.length) return [];
  const bounds = map.getBounds();
  return proyectos.filter((p) => bounds.contains([p.lat, p.lon]));
}

function dibujarMarcadores(items) {
  markersLayer.clearLayers();

  const colores = { Aprob: "#10b981", Calif: "#f59e0b", Rech: "#ef4444", Otros: "#6b7280" };

  items.forEach((p) => {
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      fillColor: colores[p.bucket] || colores.Otros,
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8,
    });

    marker.bindPopup(`
      <strong>${p.nombre}</strong><br/>
      Estado: ${p.estado}<br/>
      Sector: ${p.sector}<br/>
      Región: ${p.region}
    `);

    markersLayer.addLayer(marker);
  });
}

function actualizarResumenYCapas() {
  if (!map || !proyectos.length) return;

  const visibles = proyectosEnPantalla();
  dibujarMarcadores(visibles);

  const bboxInfo = document.getElementById("bboxInfo");
  if (bboxInfo) bboxInfo.textContent = `Proyectos en pantalla: ${visibles.length} proyectos`;

  const resumen = summarizeByRegionAndState(visibles);
  renderSummaryTable(resumen, "summaryTableContainer");
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;

  const modo = filtros.getModoSeleccion(); // en tu HTML: proximidad
  const n = filtros.getNProximos();

  const url = buildMapainfoUrl({
    baseHref: window.location.href,
    lat,
    lng,
    modo,
    radioKm: 10, // fijo en index.html actual
    n,
    sectores: [],
  });

  window.open(url, "_blank");
}

// -------- boot
function boot() {
  initMap();

  initPanelResponsive({
    panelId: "configPanel",
    backdropId: "panelBackdrop",
    headerBtnId: "togglePanelBtn",
    isMobileWidth: 768,
    onAfterToggle: () => setTimeout(() => map?.invalidateSize(), 250),
  });

  filtros = initFiltersController({
    onFiltersChanged: () => {
      // En tu index actual, cambiar N no altera el mapa principal (solo mapainfo),
      // así que no recalculamos aquí.
    },
  });

  Promise.all([loadRegionesData(), loadExcelData()])
    .then(([, data]) => {
      proyectos = data;
      actualizarResumenYCapas();
    })
    .catch((err) => {
      console.error("❌ Boot error:", err);
      alert("Error al iniciar GeoEVA. Revisa consola.");
    });
}

document.addEventListener("DOMContentLoaded", boot);
