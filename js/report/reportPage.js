// js/report/reportPage.js
// Reporte Desktop/PDF (misma data y lógica que mapainfo)
// - Carga XLSX
// - Ejecuta motor de proximidad
// - Renderiza: info, KPIs, mapa, gráficos, tabla
// - Imprime/Guarda PDF vía window.print()
//
// Requisitos en report.html (IDs esperados):
//  - #map
//  - #generatedAtLabel
//  - #kpiGrid
//  - #chartsGrid (donde updateCharts() inyecta Plotly)
//  - #projectsTable tbody
//  - botones/links: #btnPrint, #btnBack
//  - labels para infoBar (puedes reutilizar los mismos que en mapainfo):
//    coordsLabelId, modoLabelId, radioLabelId, countLabelId, invLabelId
//
// Notas:
//  - Este archivo usa XLSX (loadProyectosXlsx) + runProximityEngine + buildReportModel.
//  - El “Titular” DEBE venir ya normalizado desde buildReportModel (robusto a XLSX/JSON).
//  - Si tu buildReportModel aún no hace pickTitular robusto, ajústalo como ya vimos.

import { loadProyectosXlsx } from "../core/dataLoader.js";
import { runProximityEngine } from "../features/proximity/proximityEngine.js";
import { buildReportModel } from "../report/reportModel.js";
import { createMapLayers } from "../ui/mapLayers.js";
import { updateCharts } from "../ui/chartsController.js";
import { getMapainfoParamsFromUrl } from "../app/router.js";
import { renderInfoBar } from "../ui/infoBar.js";
import { formatMMU } from "../core/utils.js";

const DATA_XLSX_URL = "capas/nacional.xlsx";

let map = null;
let mapLayers = null;
let model = null;

/* =========================
   Helpers
========================= */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(s) {
  // Para URLs en atributos
  return String(s ?? "").replaceAll('"', "%22");
}

function isFiniteNumber(x) {
  return Number.isFinite(Number(x));
}

function setGeneratedAt() {
  const el = document.getElementById("generatedAtLabel");
  if (!el) return;
  const d = new Date();
  el.textContent = `Fecha: ${d.toLocaleString("es-CL")}`;
}

/* =========================
   Mapa (impresión confiable)
========================= */

function initMap({ lat, lng }) {
  if (!window.L) throw new Error("Leaflet (L) no está cargado.");

  map = L.map("map", {
    center: [lat, lng],
    zoom: 11,
    minZoom: 4,
    zoomControl: false,
    preferCanvas: true,
  });

  // Basemap simple OSM para impresión confiable
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  mapLayers = createMapLayers(map);
  setTimeout(() => map.invalidateSize(), 150);
}

/* =========================
   KPIs
========================= */

function renderKpis(m) {
  const grid = document.getElementById("kpiGrid");
  if (!grid || !m) return;

  grid.innerHTML = "";

  const rows = Array.isArray(m.projects) ? m.projects : [];
  const total = rows.length;

  // Fallback stats si no vienen (robusto)
  const dists = rows.map((r) => Number(r.distKm)).filter(Number.isFinite);
  const invs = rows.map((r) => Number(r.inversion)).filter(Number.isFinite);

  const distMinKm =
    m.stats && Number.isFinite(m.stats.distMinKm)
      ? m.stats.distMinKm
      : dists.length
        ? Math.min(...dists)
        : NaN;

  const distMaxKm =
    m.stats && Number.isFinite(m.stats.distMaxKm)
      ? m.stats.distMaxKm
      : dists.length
        ? Math.max(...dists)
        : NaN;

  const distAvgKm =
    m.stats && Number.isFinite(m.stats.distAvgKm)
      ? m.stats.distAvgKm
      : dists.length
        ? dists.reduce((a, b) => a + b, 0) / dists.length
        : NaN;

  const invTotal =
    m.stats && Number.isFinite(m.stats.invTotal)
      ? m.stats.invTotal
      : invs.length
        ? invs.reduce((a, b) => a + b, 0)
        : 0;

  const items = [
    { label: "Proyectos", value: String(total) },
    { label: "Dist. mínima", value: Number.isFinite(distMinKm) ? `${distMinKm.toFixed(2)} km` : "—" },
    { label: "Dist. promedio", value: Number.isFinite(distAvgKm) ? `${distAvgKm.toFixed(2)} km` : "—" },
    { label: "Dist. máxima", value: Number.isFinite(distMaxKm) ? `${distMaxKm.toFixed(2)} km` : "—" },
    { label: "Inversión total", value: formatMMU(invTotal) },
  ];

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="label">${escapeHtml(it.label)}</div><div class="value">${escapeHtml(it.value)}</div>`;
    grid.appendChild(div);
  }
}

/* =========================
   Tabla
========================= */

function renderTable(m) {
  const tbody = document.querySelector("#projectsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const rows = Array.isArray(m?.projects) ? m.projects : [];

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const tr = document.createElement("tr");

    const exp = String(p?.web ?? "").trim();
    const anx = String(p?.anexos ?? "").trim();

    // Nota: aquí SI mostramos titular (ya viene normalizado desde reportModel)
    tr.innerHTML = `
      <td>${escapeHtml(String(p?.rank ?? (i + 1)))}</td>
      <td>${escapeHtml(p?.nombre ?? "")}</td>
      <td>${escapeHtml(p?.titular ?? "—")}</td>
      <td>${escapeHtml(p?.estado ?? "—")}</td>
      <td>${escapeHtml(p?.sector ?? "—")}</td>
      <td>${escapeHtml(p?.region ?? "—")}</td>
      <td>${Number.isFinite(p?.distKm) ? p.distKm.toFixed(2) : "—"}</td>
      <td>${Number.isFinite(p?.inversion) ? Number(p.inversion).toFixed(1) : "—"}</td>
      <td>${exp ? `<a class="link" href="${escapeAttr(exp)}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
      <td>${anx ? `<a class="link" href="${escapeAttr(anx)}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
    `;

    tbody.appendChild(tr);
  }
}

/* =========================
   Navegación / botones
========================= */

function wireButtons(params) {
  const btnPrint = document.getElementById("btnPrint");
  if (btnPrint) {
    btnPrint.addEventListener("click", (e) => {
      e.preventDefault();
      window.print();
    });
  }

  const back = document.getElementById("btnBack");
  if (back) {
    // Volver a mapainfo con los mismos parámetros
    const url = new URL("mapainfo.html", window.location.href);
    url.searchParams.set("lat", Number(params.lat).toFixed(6));
    url.searchParams.set("lng", Number(params.lng).toFixed(6));
    url.searchParams.set("modo", params.modo);
    url.searchParams.set("radio", String(params.radio));
    url.searchParams.set("n", String(params.n));

    if (Array.isArray(params.sectores) && params.sectores.length) {
      url.searchParams.set("sectores", params.sectores.join("|"));
    }

    back.setAttribute("href", url.toString());
  }
}

/* =========================
   Charts wrappers / print fixes
========================= */

function wrapChartsAsCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  const children = Array.from(grid.children);

  const wrapped = children.map((ch) => {
    // Si ya está envuelto
    if (ch.classList?.contains("chart-card")) return ch;

    const wrap = document.createElement("div");
    wrap.className = "chart-card";
    wrap.appendChild(ch);
    return wrap;
  });

  grid.replaceChildren(...wrapped);
}

function limitChartsToSixPreferred() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  const nodes = Array.from(grid.children);

  // Orden preferente: sector / estado / año
  const priority = [/sector/i, /estado/i, /ano|año/i];

  const scored = nodes.map((el) => {
    const hay =
      (el.id || "") +
      " " +
      (el.className || "") +
      " " +
      (el.getAttribute?.("data-title") || "") +
      " " +
      (el.getAttribute?.("aria-label") || "");

    let score = 999;
    for (let i = 0; i < priority.length; i++) {
      if (priority[i].test(hay)) {
        score = i;
        break;
      }
    }
    return { el, score };
  });

  scored.sort((a, b) => a.score - b.score);

  const keep = scored.slice(0, 6).map((x) => x.el);
  if (keep.length) grid.replaceChildren(...keep);
}

function forceChartsResizeBeforePrint() {
  // Reduce recortes al imprimir (Plotly)
  window.addEventListener("beforeprint", () => {
    try {
      const plotlyDivs = document.querySelectorAll(".js-plotly-plot");
      plotlyDivs.forEach((d) => {
        if (window.Plotly?.Plots?.resize) window.Plotly.Plots.resize(d);
      });
    } catch (e) {
      console.warn("beforeprint resize charts warning:", e);
    }
  });

  // A veces afterprint ayuda a recuperar layout
  window.addEventListener("afterprint", () => {
    try {
      const plotlyDivs = document.querySelectorAll(".js-plotly-plot");
      plotlyDivs.forEach((d) => {
        if (window.Plotly?.Plots?.resize) window.Plotly.Plots.resize(d);
      });
    } catch {}
  });
}

/* =========================
   Main
========================= */

async function main() {
  const params = getMapainfoParamsFromUrl();

  // Defaults razonables (por si viene algo raro)
  params.lat = Number(params.lat);
  params.lng = Number(params.lng);
  params.radio = Number(params.radio);
  params.n = Number(params.n);

  if (!isFiniteNumber(params.lat) || !isFiniteNumber(params.lng)) {
    throw new Error("Parámetros inválidos: lat/lng.");
  }
  if (!isFiniteNumber(params.radio) || params.radio <= 0) {
    params.radio = 10;
  }
  if (!isFiniteNumber(params.n) || params.n <= 0) {
    params.n = 10;
  }

  wireButtons(params);
  setGeneratedAt();
  initMap({ lat: params.lat, lng: params.lng });

  // 1) Carga XLSX
  const proyectos = await loadProyectosXlsx(DATA_XLSX_URL, "mapainfo");

  // 2) Motor proximidad
  const engineOutput = runProximityEngine({
    projects: proyectos,
    center: { lat: params.lat, lng: params.lng },
    modo: params.modo,
    radioKm: params.radio,
    n: params.n,
    sectores: params.sectores, // si tu router lo soporta
  });

  // 3) Modelo canónico
  model = buildReportModel({
    engineOutput,
    meta: { sourceXlsx: DATA_XLSX_URL, generatedAt: new Date().toISOString() },
  });

  // 4) Barra superior (IDs de report.html)
  renderInfoBar(model, {
    coordsLabelId: "coordsLabel",
    modoLabelId: "modoLabel",
    radioLabelId: "radioLabel",
    countLabelId: "countLabel",
    invLabelId: "invLabel",
  });

  // 5) KPIs
  renderKpis(model);

  // 6) Mapa: punto + círculo + proyectos
  const radioFinal =
    Number.isFinite(model?.query?.radioKmFinal) && model.query.radioKmFinal > 0
      ? model.query.radioKmFinal
      : params.radio;

  mapLayers.setQueryPoint(model.query.lat, model.query.lng);
  mapLayers.setQueryCircle(model.query.lat, model.query.lng, radioFinal);
  mapLayers.renderProjects(model.projects, { onMarkerClick: () => {} });

  const bounds = typeof mapLayers.getQueryCircleBounds === "function" ? mapLayers.getQueryCircleBounds() : null;
  if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  else map.setView([model.query.lat, model.query.lng], 12);

  // 7) Gráficos
  updateCharts(model);

  // Tip: esperar un poco para que Plotly inserte DOM antes de envolver/filtrar
  await new Promise((r) => setTimeout(r, 80));

  // Envolver dentro de cards para print
  wrapChartsAsCards();

  // Limitar a 6 gráficos preferidos
  limitChartsToSixPreferred();

  // Forzar resize antes de imprimir (evita recortes por layout)
  forceChartsResizeBeforePrint();

  // 8) Tabla
  renderTable(model);

  // Debug
  window.__geoeva_report_model = model;
  window.__leafletReportMap = map;
}

document.addEventListener("DOMContentLoaded", () => {
  main().catch((err) => {
    console.error("❌ Error fatal en reportPage.js:", err);
    alert("Error al generar el informe. Revisa la consola.");
  });
});
