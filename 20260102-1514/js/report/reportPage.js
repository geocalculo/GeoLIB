// js/report/reportPage.js
// Reporte Desktop/PDF (misma data y lógica que mapainfo)
// - Carga XLSX
// - Ejecuta motor de proximidad
// - Renderiza: info, KPIs, mapa, gráficos, tabla
// - Imprime/Guarda PDF vía window.print()

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

function setGeneratedAt() {
  const el = document.getElementById("generatedAtLabel");
  if (!el) return;
  const d = new Date();
  el.textContent = `Fecha: ${d.toLocaleString("es-CL")}`;
}

function initMap({ lat, lng }) {
  map = L.map("map", { center: [lat, lng], zoom: 11, minZoom: 4, zoomControl: false });

  // Basemap simple (OSM) para impresión confiable
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  mapLayers = createMapLayers(map);
  setTimeout(() => map.invalidateSize(), 150);
}

function renderKpis(m) {
  const grid = document.getElementById("kpiGrid");
  if (!grid || !m) return;
  grid.innerHTML = "";

  const rows = Array.isArray(m.projects) ? m.projects : [];
  const total = rows.length;

  // Fallback stats (si buildReportModel no los trae)
  const dists = rows.map(r => Number(r.distKm)).filter(Number.isFinite);
  const invs = rows.map(r => Number(r.inversion)).filter(Number.isFinite); // ajusta si tu campo se llama distinto

  const distMinKm = (m.stats && Number.isFinite(m.stats.distMinKm)) ? m.stats.distMinKm : (dists.length ? Math.min(...dists) : NaN);
  const distMaxKm = (m.stats && Number.isFinite(m.stats.distMaxKm)) ? m.stats.distMaxKm : (dists.length ? Math.max(...dists) : NaN);
  const distAvgKm =
    (m.stats && Number.isFinite(m.stats.distAvgKm))
      ? m.stats.distAvgKm
      : (dists.length ? (dists.reduce((a, b) => a + b, 0) / dists.length) : NaN);

  const invTotal =
    (m.stats && Number.isFinite(m.stats.invTotal))
      ? m.stats.invTotal
      : (invs.length ? invs.reduce((a, b) => a + b, 0) : 0);

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
    div.innerHTML = `<div class="label">${it.label}</div><div class="value">${it.value}</div>`;
    grid.appendChild(div);
  }
}


function renderTable(m) {
  const tbody = document.querySelector("#projectsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = Array.isArray(m?.projects) ? m.projects : [];
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const tr = document.createElement("tr");

    const exp = (p.web || "").trim();
    const anx = (p.anexos || "").trim();

    tr.innerHTML = `
      <td>${p.rank ?? (i + 1)}</td>
      <td>${escapeHtml(p.nombre ?? "")}</td>
      <td>${escapeHtml(p.estado ?? "")}</td>
      <td>${escapeHtml(p.sector ?? "")}</td>
      <td>${Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—"}</td>
      <td>${exp ? `<a class="link" href="${escapeAttr(exp)}" target="_blank">Abrir</a>` : "—"}</td>
      <td>${anx ? `<a class="link" href="${escapeAttr(anx)}" target="_blank">Abrir</a>` : "—"}</td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(s) {
  // Para URLs (atributos)
  return String(s ?? "").replaceAll('"', "%22");
}

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

async function main() {
  const params = getMapainfoParamsFromUrl();
  wireButtons(params);
  setGeneratedAt();
  initMap({ lat: params.lat, lng: params.lng });

  const proyectos = await loadProyectosXlsx(DATA_XLSX_URL, "mapainfo");
  const engineOutput = runProximityEngine({
    projects: proyectos,
    center: { lat: params.lat, lng: params.lng },
    modo: params.modo,
    radioKm: params.radio,
    n: params.n,
  });

  model = buildReportModel({
    engineOutput,
    meta: { sourceXlsx: DATA_XLSX_URL, generatedAt: new Date().toISOString() },
  });

  // Barra meta (reusa ids de report.html)
  renderInfoBar(model, {
    coordsLabelId: "coordsLabel",
    modoLabelId: "modoLabel",
    radioLabelId: "radioLabel",
    countLabelId: "countLabel",
    invLabelId: "invLabel",
  });

  renderKpis(model);

  // Mapa: punto + círculo + proyectos
  const radioFinal =
    Number.isFinite(model.query.radioKmFinal) && model.query.radioKmFinal > 0
      ? model.query.radioKmFinal
      : params.radio;

  mapLayers.setQueryPoint(model.query.lat, model.query.lng);
  mapLayers.setQueryCircle(model.query.lat, model.query.lng, radioFinal);
  mapLayers.renderProjects(model.projects, { onMarkerClick: () => {} });

  const bounds = typeof mapLayers.getQueryCircleBounds === "function" ? mapLayers.getQueryCircleBounds() : null;
  if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  else map.setView([model.query.lat, model.query.lng], 12);

// Gráficos (reporte: 3 filas x 2 columnas)
updateCharts(model);

// Limitar a sector/estado/año (6 gráficos)
limitChartsToSixPreferred();

function forceChartsResizeBeforePrint() {
  // Si usas Plotly, esto reduce recortes
  window.addEventListener("beforeprint", () => {
    try {
      const plotlyDivs = document.querySelectorAll(".js-plotly-plot");
      plotlyDivs.forEach(d => {
        if (window.Plotly && window.Plotly.Plots && window.Plotly.Plots.resize) {
          window.Plotly.Plots.resize(d);
        }
      });
    } catch (e) {
      console.warn("beforeprint resize charts warning:", e);
    }
  });
}


// Envolver dentro de cards para print
wrapChartsAsCards();

// Forzar resize antes de imprimir (evita recortes por layout)
forceChartsResizeBeforePrint();


  // Tabla
  renderTable(model);

  // Exponer para debug
  window.__geoeva_report_model = model;
}

function wrapChartsAsCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  // graficos.js suele inyectar divs directos. Aquí los envolvemos para print.
  const children = Array.from(grid.children);
  const wrapped = [];
  for (const ch of children) {
    if (ch.classList?.contains("chart-card")) {
      wrapped.push(ch);
      continue;
    }
    const wrap = document.createElement("div");
    wrap.className = "chart-card";
    wrap.appendChild(ch);
    wrapped.push(wrap);
  }
  grid.replaceChildren(...wrapped);
}

function limitChartsToSixPreferred() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  // Preferencia: sector / estado / año (2 gráficos por tema: cantidad e inversión)
  // Esto depende de IDs o data-attrs. Como no los tenemos aquí, hacemos una selección heurística.
  // Recomendación: en graficos.js asigna ids fijos a cada chart para filtrar por id.
  const nodes = Array.from(grid.children);

  // Heurística: prioriza charts que contengan estas palabras en su id o class
  const priority = [
    /sector/i,
    /estado/i,
    /ano|año/i,
  ];

  // Ordena: primero los que matchean prioridad (en ese orden), luego el resto
  const scored = nodes.map((el) => {
    const hay = (el.id || "") + " " + (el.className || "") + " " + (el.getAttribute("data-title") || "");
    let score = 999;
    for (let i = 0; i < priority.length; i++) {
      if (priority[i].test(hay)) { score = i; break; }
    }
    return { el, score, hay };
  });

  scored.sort((a, b) => a.score - b.score);

  const keep = scored.slice(0, 6).map(x => x.el);
  grid.replaceChildren(...keep);
}


document.addEventListener("DOMContentLoaded", () => {
  main().catch((err) => {
    console.error("❌ Error fatal en reportPage.js:", err);
    alert("Error al generar el informe. Revisa la consola.");
  });
});
