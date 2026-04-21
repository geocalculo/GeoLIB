// js/mapainfo.js - VERSIÓN JSON (sin dependencia XLSX)
// PDF con jsPDF + captura de mapa con dom-to-image
//
// Fixes incluidos:
// - ✅ computeExecutiveInsights(): se invoca con el OBJETO query (no con params.n)
// - ✅ PDF: eliminado "const aiText" duplicado (SyntaxError fatal)
// - ✅ Títulos canónicos iguales en PDF vs HTML (charts + executive title)
// - ✅ Forzar que gráficos partan SIEMPRE en página 2 del PDF (una sola vez)
// - ✅ renderExecutiveAnalysis(): título con radio + query correcto
// - ✅ Robustez: normaliza estados/etiquetas para sumar inversión por estado
// - ✅ (Opcional): lista PDF sigue mostrando top-N (no filtra aprobados; si quieres, te dejo un switch)
//
// Requiere en mapainfo.html: Leaflet, Plotly, dom-to-image, jsPDF, autotable, etc.

import { loadProyectos } from "./core/dataLoader.js";
import { runProximityEngine } from "./features/proximity/proximityEngine.js";
import { buildReportModel } from "./report/reportModel.js";
import { createMapLayers } from "./ui/mapLayers.js";
import { createProjectsPanel } from "./ui/panel.js";
import { updateCharts } from "./ui/chartsController.js";
import { downloadProximityKMZ } from "./export/kmzExport.js";
import { getMapainfoParamsFromUrl } from "./app/router.js";
import { renderInfoBar } from "./ui/infoBar.js";
import { bindKmzButton } from "./ui/actions.js";
import { log, warn, error } from "./core/logger.js";

import { trackEvent } from "./core/tracking.js";

const DATA_URL = "capas/nacional.compact.v2.json";
const RUNTIME_DEBUG =
  window.__GEOEVA_RUNTIME_DEBUG__ === true ||
  new URLSearchParams(window.location.search).get("debugRuntime") === "1";

function runtimeDebugLog(...args) {
  if (!RUNTIME_DEBUG) return;
  console.log("[GeoEVA][Runtime]", ...args);
}



let map = null;
let mapLayers = null;
let panel = null;
let model = null;

const REPORT_TITLES = {
  execTitle: (radioKm) =>
    `Análisis técnico en el área de influencia (radio de ${Number.isFinite(radioKm) ? radioKm.toFixed(0) : "—"} km)`,

  chartsTitle: "Análisis gráfico de la inversión",

  // Deben coincidir EXACTO con mapainfo.html
  chart1: "Inversión por sector (MMU$)",
  chart2: "Inversión por año (MMU$)",
  chart3: "Inversión por estado (MMU$)",
  chart4: "Plazo promedio por sector (meses) – Solo Aprobados",
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




function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function readBasemapPrefs() {
  try {
    const raw = localStorage.getItem("geoeva_basemap");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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

function slugifyRegion(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "sin-region";

  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "sin-region";
}

function buildExportId({ region, now = new Date() } = {}) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${y}-${m}-${day}_${hh}-${mm}-${ss}_${slugifyRegion(region)}`;
}

function triggerDownload({ filename, blob, mimeType } = {}) {
  if (!filename) throw new Error("triggerDownload: filename requerido");

  const fileBlob =
    blob instanceof Blob
      ? blob
      : new Blob([blob ?? ""], { type: mimeType || "application/octet-stream" });

  const url = URL.createObjectURL(fileBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resolveExportRegion({ model, params, proyectos } = {}) {
  const byParams = String(params?.region ?? params?.regionNombre ?? "").trim();
  if (byParams) return byParams;

  const byModelQuery = String(model?.query?.region ?? model?.query?.regionNombre ?? "").trim();
  if (byModelQuery) return byModelQuery;

  const byModelMeta = String(model?.meta?.region ?? model?.meta?.regionNombre ?? "").trim();
  if (byModelMeta) return byModelMeta;

  const byProjects = (Array.isArray(proyectos) ? proyectos : []).find(
    (p) => String(p?.region ?? "").trim()
  )?.region;

  return String(byProjects ?? "").trim() || "sin-region";
}

async function dataUrlToJpegBlob(dataUrl, { quality = 0.86 } = {}) {
  if (!dataUrl || typeof dataUrl !== "string") return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 0;
        canvas.height = img.naturalHeight || img.height || 0;
        if (canvas.width <= 0 || canvas.height <= 0) {
          resolve(null);
          return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => resolve(blob || null), "image/jpeg", quality);
      } catch (e) {
        warn("No se pudo convertir la captura a JPG:", e);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function exportMetadataAndThumbnail({ exportId, model, params, proyectos } = {}) {
  if (!exportId) throw new Error("exportMetadataAndThumbnail: exportId requerido");

  const nowIso = new Date().toISOString();
  const regionName = resolveExportRegion({ model, params, proyectos });
  const latNum = Number(params?.lat);
  const lngNum = Number(params?.lng);
  const metadata = {
    fecha: nowIso,
    titulo: "Consulta territorial",
    lat: Number.isFinite(latNum) ? Number(latNum.toFixed(6)) : null,
    lon: Number.isFinite(lngNum) ? Number(lngNum.toFixed(6)) : null,
    región: regionName || "sin-region",
  };

  triggerDownload({
    filename: `${exportId}.json`,
    blob: JSON.stringify(metadata, null, 2),
    mimeType: "application/json;charset=utf-8",
  });

  const mapPng = await captureMapPng();
  if (!mapPng) {
    warn("No se pudo capturar mapa para miniatura JPG.");
    return;
  }

  const jpgBlob = await dataUrlToJpegBlob(mapPng, { quality: 0.86 });
  if (!jpgBlob) {
    warn("No se pudo generar miniatura JPG.");
    return;
  }

  triggerDownload({
    filename: `${exportId}.jpg`,
    blob: jpgBlob,
    mimeType: "image/jpeg",
  });
}

  // =====================================================
  // Helper CANÓNICO para leer Titular (JSON usa 'titular')
  // =====================================================
  // Helper CANÓNICO para leer Titular (robusto a mayúsculas/minúsculas)








function enableTwoFingerZoomOnly(map) {
  if (!map || !isMobile()) return;
  if (map._twoFingerEnabled) return;
  map._twoFingerEnabled = true;

  map.dragging.disable();
  map.touchZoom.enable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
  if (map.tap) map.tap.enable();

  const container = map.getContainer();
  const hint = document.getElementById("mapTouchHint");
  let hintTimeout;

  container.style.touchAction = "pan-y";

  container.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches.length >= 2) e.preventDefault();
    },
    { passive: false }
  );

  container.addEventListener(
    "touchstart",
    (e) => {
      const touchCount = e.touches ? e.touches.length : 0;

      if (touchCount >= 2) {
        map.dragging.enable();
        if (hint) hint.classList.remove("active");
      } else {
        map.dragging.disable();
        if (hint) {
          hint.classList.add("active");
          clearTimeout(hintTimeout);
          hintTimeout = setTimeout(() => {
            hint.classList.remove("active");
          }, 2000);
        }
      }
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    () => {
      map.dragging.disable();
    },
    { passive: true }
  );

  if (hint) {
    hint.classList.add("active");
    setTimeout(() => {
      hint.classList.remove("active");
    }, 3000);
  }
}

function initMobileSheet() {
  const sheet = document.getElementById("mobileSheet");
  const backdrop = document.getElementById("mobileSheetBackdrop");
  const btnClose = document.getElementById("msClose");
  const handle = document.getElementById("mobileSheetHandle");

  if (!sheet || !backdrop) return;

  function close() {
    sheet.classList.add("hidden");
    backdrop.classList.add("hidden");
    sheet.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
  }

  function open() {
    sheet.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
  }

  backdrop.addEventListener("click", close);
  btnClose?.addEventListener("click", close);
  handle?.addEventListener("click", close);

  window.__openMobileSheet = open;   // ✅ FIX
  window.__closeMobileSheet = close;
}


function openMobileSheet(p) {
  if (!isMobile()) return;

  const title = document.getElementById("msTitle");
  const meta = document.getElementById("msMeta");
  const exp = document.getElementById("msExp");
  const anx = document.getElementById("msAnx");

  if (!title || !meta || !exp || !anx) return;

  title.textContent = p?.nombre || "Proyecto";

  const dist = Number.isFinite(p?.distKm) ? `${p.distKm.toFixed(2)} km` : "—";
  meta.innerHTML = `
    <div><b>Distancia:</b> ${dist}</div>
    <div><b>Estado:</b> ${escapeHtml(p?.estado || "—")}</div>
    <div><b>Sector:</b> ${escapeHtml(p?.sector || "—")}</div>
  `;

  const expUrl = (p?.web || "").trim();
  const anxUrl = (p?.anexos || "").trim();

  if (expUrl) {
    exp.href = expUrl;
    exp.style.opacity = "1";
    exp.style.pointerEvents = "auto";
  } else {
    exp.href = "#";
    exp.style.opacity = "0.5";
    exp.style.pointerEvents = "none";
  }

  if (anxUrl) {
    anx.href = anxUrl;
    anx.style.opacity = "1";
    anx.style.pointerEvents = "auto";
  } else {
    anx.href = "#";
    anx.style.opacity = "0.5";
    anx.style.pointerEvents = "none";
  }

  window.__openMobileSheet?.();
}

window.openMobileSheet = openMobileSheet;
window.__isMobile = isMobile;



function initMap({ lat, lng }) {
  map = L.map("map", { center: [lat, lng], zoom: 11, minZoom: 4, zoomControl: true });
  window.__leafletMap = map;

  enableTwoFingerZoomOnly(map);

  const prefs = readBasemapPrefs() || {
    addOSM: true,
    osmOpacity: 1.0,
    addIMG: true,
    imgOpacity: 0.1,
  };

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    opacity: Math.max(0, Math.min(1, Number(prefs.osmOpacity ?? 1))),
    attribution: "&copy; OpenStreetMap contributors",
  });

  const img = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, opacity: Math.max(0, Math.min(1, Number(prefs.imgOpacity ?? 0.1))) }
  );

  if (prefs.addOSM !== false) osm.addTo(map);
  if (prefs.addIMG !== false) img.addTo(map);

  L.control.scale().addTo(map);

  mapLayers = createMapLayers(map);
  setTimeout(() => map.invalidateSize(), 150);
}

// =====================================================
// CAPTURA DE MAPA CON dom-to-image (NO DEPENDE DE CORS)
// =====================================================
async function captureMapPng() {
  if (!window.domtoimage) {
    warn("dom-to-image no cargado");
    return null;
  }

  const mapDiv = document.getElementById("map");
  if (!mapDiv) return null;

  try {
    const theMap = window.__leafletMap;
    const bounds =
      typeof mapLayers?.getQueryCircleBounds === "function"
        ? mapLayers.getQueryCircleBounds()
        : null;

    if (theMap && bounds) {
      theMap.fitBounds(bounds, { padding: [30, 30], animate: false, maxZoom: 14 });
      theMap.invalidateSize(true);
    }

    // Espera breve para layout + tiles
  // Espera breve para layout + tiles (más fiable en Leaflet)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 250));
    try { theMap?.invalidateSize(true); } catch {}
    await new Promise((r) => setTimeout(r, 120));


    // Captura con tamaño REAL del contenedor (no inventar)
    const rect = mapDiv.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    const dataUrl = await window.domtoimage.toPng(mapDiv, {
      width: w,
      height: h,
      style: { transform: "scale(1)", transformOrigin: "top left" },
    });

    return dataUrl;
  } catch (error) {
    warn("Error capturando mapa:", error);
    return null;
  }
}



// =====================================================
// EXPORTAR GRAFICOS PLOTLY A IMAGEN (para PDF) - LIVIANO
// =====================================================
async function ensureChartsRenderedForPdf(model) {
  if (!window.Plotly) {
    warn("Plotly no está cargado; no se exportarán gráficos.");
    return [];
  }

  const chartsSection = document.getElementById("chartsSection");
  const chartsGrid = document.getElementById("chartsGrid");
  if (!chartsSection || !chartsGrid) {
    warn("No existe chartsSection/chartsGrid en el DOM.");
    return [];
  }

  const prev = {
    display: chartsSection.style.display,
    position: chartsSection.style.position,
    left: chartsSection.style.left,
    top: chartsSection.style.top,
    width: chartsSection.style.width,
    visibility: chartsSection.style.visibility,
  };

  // ganar a display:none !important del CSS móvil
  chartsSection.style.setProperty("display", "block", "important");
  chartsSection.style.position = "absolute";
  chartsSection.style.left = "-10000px";
  chartsSection.style.top = "0";
  chartsSection.style.width = "820px";
  chartsSection.style.visibility = "hidden";

  try {
    await updateCharts(model);
  } catch (e) {
    warn("No se pudo ejecutar updateCharts(model):", e);
  }

  await new Promise((r) => setTimeout(r, 250));

  const plotDivs = Array.from(chartsGrid.querySelectorAll(".js-plotly-plot"));
  if (!plotDivs.length) warn("No se encontraron .js-plotly-plot dentro de chartsGrid.");

  try {
    plotDivs.forEach((d) => window.Plotly.Plots.resize(d));
  } catch {}
  await new Promise((r) => setTimeout(r, 120));

  const images = [];
  for (let i = 0; i < plotDivs.length; i++) {
    const el = plotDivs[i];

    const title = el.getAttribute("data-title") || el.getAttribute("aria-label") || `Gráfico ${i + 1}`;

    try {
      const dataUrl = await window.Plotly.toImage(el, {
        format: "jpeg",
        width: 620,
        height: 360,
        scale: 1,
      });
      images.push({ title, dataUrl, kind: "JPEG" });
    } catch (e) {
      warn(`No se pudo exportar gráfico ${i + 1}:`, e);
    }
  }

  // restaurar estilos
  if (prev.display) chartsSection.style.setProperty("display", prev.display, "important");
  else chartsSection.style.removeProperty("display");
  chartsSection.style.position = prev.position;
  chartsSection.style.left = prev.left;
  chartsSection.style.top = prev.top;
  chartsSection.style.width = prev.width;
  chartsSection.style.visibility = prev.visibility;

  return images;
}

function addPlotImagesToPdf(doc, { images, margin, pageWidth, yStart }) {
  const contentWidth = pageWidth - margin * 2;
  if (!images || !images.length) return yStart;

  let y = yStart;
  const titleH = 8;
  const pageBottom = 280;

  const SECTION_TITLE = REPORT_TITLES?.chartsTitle || "Análisis gráfico de la inversión";
  const CANON_TITLES = [REPORT_TITLES?.chart1, REPORT_TITLES?.chart2, REPORT_TITLES?.chart3, REPORT_TITLES?.chart4].filter(
    Boolean
  );

  const canonTitleForIndex = (idx, fallback) => (CANON_TITLES[idx] ? CANON_TITLES[idx] : fallback || `Gráfico ${idx + 1}`);

  const newPageIfNeeded = (needH = 0) => {
    if (y + needH > pageBottom) {
      doc.addPage();
      y = margin;
    }
  };

  newPageIfNeeded(20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(SECTION_TITLE, margin, y);
  y += titleH;

  const gapX = 6;
  const gapY = 10;
  const colW = (contentWidth - gapX) / 2;
  const tileH = 62;

  let i = 0;
  while (i < images.length) {
    const needH = tileH * 2 + gapY + 10;
    if (y + needH > pageBottom) {
      doc.addPage();
      y = margin;

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`${SECTION_TITLE} (cont.)`, margin, y);
      y += titleH;
    }

    for (let slot = 0; slot < 4 && i < images.length; slot++, i++) {
      const img = images[i];

      const row = Math.floor(slot / 2);
      const col = slot % 2;

      const x = margin + col * (colW + gapX);
      const yImg = y + row * (tileH + gapY);

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      const canonTitle = canonTitleForIndex(i, img?.title);
      const label = `${i + 1}. ${String(canonTitle).slice(0, 60)}`;
      doc.text(label, x, yImg - 2);

      try {
        doc.addImage(img.dataUrl, img.kind || "JPEG", x, yImg, colW, tileH, undefined, "FAST");
      } catch (e) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text("⚠ No se pudo insertar este gráfico.", x, yImg + 10);
      }
    }

    y += tileH * 2 + gapY + 12;
  }

  return y;
}

// =====================================================
// PÁRRAFO “ORO” (coherente con gráficos)
// - Gráficos: 3 estados (Aprobado/En Calificación/Rechazado)
// - Duración: SOLO APROBADOS
// =====================================================
/**
 * computeExecutiveInsights(projects, query)
 * GeoEVA – Resumen ejecutivo técnico (estable / determinístico / sin random)
 * - Sin juicios subjetivos ("moderado", "importante", etc.)
 * - Unidades consistentes: MMU$ (millones de US$) como en gráficos
 * - Robusto a distintos nombres de campos
 * - Narrativa fluida en párrafos (con saltos suaves)
 */
function computeExecutiveInsights(projects = [], query = {}) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const pretty = (s) => (String(s ?? "—").trim() || "—");

  const normalizeEstadoLabel = (s) => {
    const t = norm(s);
    if (t === "aprobado") return "Aprobado";
    if (t === "en calificación" || t === "en calificacion") return "En Calificación";
    if (t === "rechazado") return "Rechazado";
    return pretty(s);
  };

  const isAprobado = (p) => norm(p?.estado) === "aprobado";

  const getInv = (p) => {
    const v = Number(
      p?.inversion ??
      p?.inversionMm ??
      p?.inv ??
      p?.mmus ??
      p?.inversion_mmus ??
      p?.inversionMMUS
    );
    return Number.isFinite(v) ? v : null;
  };

  const getMeses = (p) => {
    const v = Number(
      p?.meses ??
      p?.plazo_meses ??
      p?.plazoMeses ??
      p?.meses_aprobacion ??
      p?.duracion_meses
    );
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const getAnio = (p) => {
    const v =
      p?.anio ??
      p?.año ??
      p?.year ??
      p?.anio_ingreso ??
      p?.anio_calificacion ??
      p?.anioResolucion;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const sumByKey = (arr, keyFn, valFn) => {
    const out = {};
    for (const it of arr) {
      const k = keyFn(it);
      const v = valFn(it);
      if (k == null || k === "" || v == null) continue;
      out[k] = (out[k] || 0) + v;
    }
    return out;
  };

  const fmtMMUS = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));
  const fmtInv = (v) => `${fmtMMUS(v)} MMU$`;
  const fmtMes = (v) => (v == null || !Number.isFinite(v) ? "—" : String(Math.round(v)));

  const fmtRadioTxt = () => {
    const radioKm = Number(query?.radioKmFinal ?? query?.radioKm ?? query?.radio);
    return Number.isFinite(radioKm) ? `${radioKm.toFixed(0)} km` : "el radio definido";
  };

  const inRadius = Array.isArray(projects) ? projects : [];
  if (!inRadius.length) {
    return "No se identificaron proyectos en el área de influencia consultada.";
  }

  const radioTxt = fmtRadioTxt();

  // ============================
  // CÁLCULOS
  // ============================
  const invByEstado = sumByKey(inRadius, (p) => normalizeEstadoLabel(p?.estado), (p) => getInv(p));
  const invTotal = Object.values(invByEstado).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) || 0;

  const invAprob = invByEstado["Aprobado"] ?? 0;
  const invCalif = invByEstado["En Calificación"] ?? 0;
  const invRech = invByEstado["Rechazado"] ?? 0;

  const invBySector = sumByKey(inRadius, (p) => pretty(p?.sector), (p) => getInv(p));
  const sectorsSorted = Object.entries(invBySector).sort((a, b) => (b[1] || 0) - (a[1] || 0));

  const invByYear = sumByKey(inRadius, (p) => getAnio(p), (p) => getInv(p));
  let maxYear = null;
  let maxYearInv = null;
  for (const [yStr, v] of Object.entries(invByYear)) {
    const y = Number(yStr);
    const val = Number(v);
    if (!Number.isFinite(y) || !Number.isFinite(val)) continue;
    if (maxYearInv == null || val > maxYearInv) {
      maxYearInv = val;
      maxYear = y;
    }
  }

  const aprobados = inRadius.filter(isAprobado);
  const mesesAprob = aprobados.map(getMeses).filter((v) => v != null);
  const avgMeses = mesesAprob.length
    ? mesesAprob.reduce((a, b) => a + b, 0) / mesesAprob.length
    : null;

  const mesesSumBySector = {};
  const mesesCntBySector = {};
  for (const p of aprobados) {
    const m = getMeses(p);
    if (m == null) continue;
    const k = pretty(p?.sector);
    mesesSumBySector[k] = (mesesSumBySector[k] || 0) + m;
    mesesCntBySector[k] = (mesesCntBySector[k] || 0) + 1;
  }

  const avgMesesBySector = Object.entries(mesesSumBySector)
    .map(([k, sum]) => [k, sum / (mesesCntBySector[k] || 1)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => a[1] - b[1]);

  const breve = avgMesesBySector.length ? avgMesesBySector[0] : null;
  const extenso = avgMesesBySector.length >= 2 ? avgMesesBySector[avgMesesBySector.length - 1] : null;

  // ============================
  // NARRATIVA
  // ============================
  const parts = [];

  // 1) Apertura
  if (invTotal > 0) {
    const numProyectos = inRadius.length;
    const invProm = numProyectos > 0 ? invTotal / numProyectos : null;
    parts.push(
      `En un radio de ${radioTxt} se identificaron ${numProyectos} proyectos que suman una inversión total estimada de ${fmtInv(invTotal)}.` +
      (invProm != null ? ` La inversión promedio estimada por proyecto es ${fmtInv(invProm)}.` : "")
    );
  } else {
    parts.push(
      `En un radio de ${radioTxt} se identificaron ${inRadius.length} proyectos, pero la información disponible no permite cuantificar la inversión total asociada.`
    );
  }

  // 2) Por estado (ENTEROS, ajuste en el mayor)
  if (invTotal > 0 && (invAprob > 0 || invCalif > 0 || invRech > 0)) {

    const estados = [
      { label: "Aprobado", val: invAprob },
      { label: "En Calificación", val: invCalif },
      { label: "Rechazado", val: invRech }
    ].filter(e => e.val > 0);

    if (estados.length === 1) {
      parts.push(
        `Por estado (inversión), se observa: ${estados[0].label}: ${fmtInv(estados[0].val)} (100%).`
      );
    } else {

      const withPct = estados.map(e => ({
        ...e,
        pct: Math.round((e.val / invTotal) * 100)
      }));

      let sumPct = withPct.reduce((a, e) => a + e.pct, 0);
      let delta = 100 - sumPct;

      const idxByDesc = withPct
        .map((e, i) => ({ i, pct: e.pct }))
        .sort((a, b) => b.pct - a.pct)
        .map(o => o.i);

      if (delta !== 0) {
        for (const idx of idxByDesc) {
          const p = withPct[idx].pct;
          if (delta > 0) {
            withPct[idx].pct += delta;
            delta = 0;
            break;
          } else if (p + delta >= 1) {
            withPct[idx].pct += delta;
            delta = 0;
            break;
          }
        }
      }

      const chunks = withPct.map(e =>
        `${e.label}: ${fmtInv(e.val)} (${e.pct}%)`
      );

      parts.push(`Por estado (inversión), se observa: ${chunks.join(", ")}.`);
    }

    // Relación calificación / aprobado
    if (invAprob > 0 && invCalif > 0) {
      const ratio = invCalif / invAprob;
      if (Number.isFinite(ratio) && ratio > 0) {
        if (ratio >= 1) {
          parts.push(`La inversión en calificación equivale a ${ratio.toFixed(1)}× la inversión aprobada.`);
        } else {
          const pct = ratio * 100;
          if (pct >= 1) {
            parts.push(`La inversión en calificación equivale a un ${pct.toFixed(0)}% de la inversión aprobada.`);
          }
        }
      }
    }
  }

  // 3) Sector
  if (invTotal > 0 && sectorsSorted.length) {
    const top = sectorsSorted.slice(0, 4).filter(([, v]) => v > 0);
    if (top.length) {
      const topTxt = top.map(([s, v]) => {
        const pct = Math.round((v / invTotal) * 100);
        return `${pretty(s)} (${fmtInv(v)}, ${pct}%)`;
      });
      parts.push(`Por sector, destacan: ${topTxt.join(", ")}.`);
    }
  }

  // 4) Año peak
  if (invTotal > 0 && maxYear != null && maxYearInv != null && maxYearInv > 0) {
    const pct = Math.round((maxYearInv / invTotal) * 100);
    parts.push(
      `El año que registra la mayor inversión corresponde a ${maxYear}, con ${fmtInv(maxYearInv)} (${pct}% del total identificado).`
    );
  }

  // 5) Plazos
  if (avgMeses != null && aprobados.length > 0) {
    const mesesNum = Math.round(avgMeses);
    const años = Math.floor(mesesNum / 12);
    const mesesRest = mesesNum % 12;

    const tiempoTxt =
      años >= 2
        ? (mesesRest ? `${años} años y ${mesesRest} meses` : `${años} años`)
        : años === 1
          ? (mesesRest ? `1 año y ${mesesRest} meses` : `1 año`)
          : `${mesesNum} meses`;

    parts.push(
      `Considerando únicamente los proyectos aprobados, la duración promedio del proceso de evaluación es de ${tiempoTxt}.`
    );

    if (breve && extenso && breve[0] !== extenso[0]) {
      parts.push(
        `Por sector, el plazo promedio más breve se observa en ${pretty(breve[0])} (${fmtMes(breve[1])} meses), y el más extenso en ${pretty(extenso[0])} (${fmtMes(extenso[1])} meses).`
      );
    }
  }

  return parts.join(" ");
}



// =====================================================
// ANÁLISIS HUMANO/IA EN HTML (desktop + mobile)
// =====================================================
function ensureExecutiveSectionExists() {
  let section = document.getElementById("executiveAnalysisSection");
  if (section) return section;

  section = document.createElement("section");
  section.id = "executiveAnalysisSection";
  section.className = "executive-analysis";
  section.innerHTML = `
    <h2 class="executive-title">Lectura ejecutiva del entorno</h2>
    <p id="executiveText" class="executive-text"></p>
  `;
  return section;
}

function placeExecutiveSection(section) {
  if (isMobile()) {
    const infoBar = document.querySelector(".info-bar");
    if (infoBar && infoBar.parentNode) {
      infoBar.insertAdjacentElement("afterend", section);
      return;
    }
  }

  const mapContainer = document.querySelector(".map-container");
  const chartsSection = document.getElementById("chartsSection");

  if (mapContainer) {
    mapContainer.insertAdjacentElement("afterend", section);
    return;
  }

  if (chartsSection) {
    chartsSection.insertAdjacentElement("beforebegin", section);
    return;
  }

  const wrapper = document.querySelector(".page-wrapper") || document.body;
  wrapper.appendChild(section);
}

function renderExecutiveAnalysis(model) {
  try {
    const section = ensureExecutiveSectionExists();
    placeExecutiveSection(section);

    const h2 = section.querySelector(".executive-title");
    const radioKm =
      Number.isFinite(model?.query?.radioKmFinal) && model.query.radioKmFinal > 0
        ? model.query.radioKmFinal
        : Number.isFinite(model?.query?.radioKm)
          ? model.query.radioKm
          : Number.isFinite(model?.query?.radio)
            ? model.query.radio
            : null;

    if (h2) h2.textContent = REPORT_TITLES.execTitle(radioKm);

    const p = section.querySelector("#executiveText");
    if (!p) return;

    const txt = computeExecutiveInsights(model?.projects || [], model?.query || {});
    p.innerHTML = escapeHtml(txt).replace(/\n/g, "<br>");
  } catch (e) {
    warn("No se pudo renderizar análisis ejecutivo:", e);
  }
}

function bindExecutiveReflow(modelGetter) {
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const m = modelGetter?.();
      if (m) renderExecutiveAnalysis(m);
    }, 150);
  });
}

function drawExecutiveAiBox(doc, { x, y, w, h, title, text }) {
  doc.setDrawColor(210);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(title || "Análisis IA (resumen ejecutivo)", x + 4, y + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(50);

  const maxTextWidth = w - 8;
  const lines = doc.splitTextToSize(String(text || ""), maxTextWidth);

  const lineH = 4.2;
  const maxLines = Math.floor((h - 12) / lineH);
  const safeLines = lines.slice(0, Math.max(0, maxLines));

  let yy = y + 13;
  safeLines.forEach((line) => {
    doc.text(line, x + 4, yy);
    yy += lineH;
  });

  if (lines.length > safeLines.length) {
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("…(continúa en la siguiente página)", x + 4, y + h - 4);
  }

  doc.setTextColor(0);
}

// =====================================================
// PANEL RESUMEN (MAPA + LISTA) PARA PDF
// =====================================================




// =====================================================
// PANEL RESUMEN (MAPA + LISTA) PARA PDF
// - Lista compacta en 3 líneas por proyecto:
//   1) Nº + Nombre
//   2) Titular + Inversión
//   3) Estado · Distancia
// =====================================================
function drawSummaryListPanel(doc, { x, y, w, h, projects }) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const pretty = (s) => (String(s ?? "—").trim() || "—");

  // ✅ URL robusta para link en PDF
  const safeUrl = (u) => {
    const s = String(u ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return "https://" + s.replace(/^\/+/, "");
  };

  const getInv = (p) => {
    const v = Number(
      p?.inversion ??
        p?.inversionMm ??
        p?.inv ??
        p?.mmus ??
        p?.inversion_mmus ??
        p?.inversionMMUS
    );
    return Number.isFinite(v) ? v : null;
  };

  const fmtInv = (p) => {
    const v = getInv(p);
    return v == null ? "—" : v.toFixed(1);
  };

  // Caja
  doc.setDrawColor(220);
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");

  let yy = y + 6;

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text("Lista de Proyectos", x + 4, yy);
  yy += 6;

  // Config filas (3 líneas)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  const line1 = 3.6; // Nombre
  const line2 = 3.4; // Titular+Inv
  const line3 = 3.4; // Estado+Dist
  const gapAfter = 2.0;
  const rowH = line1 + line2 + line3 + gapAfter;

  const headerH = 14; // aprox: título + padding
  const usableH = Math.max(0, h - headerH);
  const maxRows = Math.max(1, Math.floor(usableH / rowH));

  // Si quieres que muestre solo APROBADOS, cambia a true:
  const ONLY_APPROVED = false;

  const rows = (projects || [])
    .filter((p) => (ONLY_APPROVED ? norm(p?.estado) === "aprobado" : true))
    .slice(0, maxRows);

  // Helper wrap seguro al ancho del panel
  const wrap = (txt, maxW) => {
    const s = String(txt ?? "");
    try {
      return doc.splitTextToSize(s, maxW);
    } catch {
      return [s];
    }
  };

  const textW = Math.max(10, w - 8); // padding 4+4
  const xText = x + 4;

  rows.forEach((p, i) => {
    const n = String(i + 1).padStart(2, "0");

    const name = pretty(p?.nombre || p?.proyecto || "Proyecto");
    const titular = p?.titular || "–";

    const inv = fmtInv(p); // MMUS$
    const estado = pretty(p?.estado);
    const dist = Number.isFinite(p?.distKm) ? `${p.distKm.toFixed(1)} km` : "—";

    // 1) Nombre (bold, 1 línea) + ✅ LINK invisible al expediente (p.web)
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);

    const nameLine = `${n}  ${name}`;
    const nameWrapped = wrap(nameLine, textW);
    const nameToPrint = String(nameWrapped[0] ?? nameLine);

    doc.text(nameToPrint, xText, yy);

    // 🔗 Link solo en PDF: el nombre abre el expediente SEA (columna web)
    const url = safeUrl(p?.web);
    if (url) {
      const linkW = doc.getTextWidth(nameToPrint);
      // Caja clickeable sobre la línea del texto
      doc.link(xText, yy - 3.8, linkW, 5.2, { url });
    }

    yy += line1;

    // 2) Titular + Inversión (normal, 1 línea)
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    const infoLine = `Titular: ${titular} | Inv: ${inv} MMUS$`;
    const infoWrapped = wrap(infoLine, textW);
    doc.text(String(infoWrapped[0] ?? infoLine), xText, yy);
    yy += line2;

    // 3) Estado + Dist (gris, 1 línea)
    doc.setTextColor(110);
    const metaLine = `${estado} · ${dist}`;
    const metaWrapped = wrap(metaLine, textW);
    doc.text(String(metaWrapped[0] ?? metaLine), xText, yy);
    yy += line3 + gapAfter;

    // Separador
    if (i < rows.length - 1) {
      doc.setDrawColor(235);
      doc.line(x + 4, yy - 1.2, x + w - 4, yy - 1.2);
    }
  });

  doc.setTextColor(0);
}
// =====================================================
// PIE DE PAGINA HTTPS://GEOEVA.CLY HTTPS://GEOIPT.CL
// =====================================================
function addPdfFooter(doc, { margin = 15 } = {}) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const leftX = margin;
  const rightX = pageWidth - margin;
  const y = pageHeight - 10;

  const url1 = "https://geoipt.cl";
  const url2 = "https://geoeva.cl";

  const line1 = "geoipt.cl – Sitio de consulta de instrumentos de planificación territorial";
  const line2 = "geoeva.cl – Sitio de consulta de evaluación ambiental de proyectos cercanos";

  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);

    // Línea separadora
    doc.setDrawColor(220);
    doc.line(margin, y - 4, pageWidth - margin, y - 4);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);

    // Texto (izquierda)
    doc.text(line1, leftX, y);
    doc.text(line2, leftX, y + 4);

    // Links clickeables (derecha)
    doc.setTextColor(60);
    const u1w = doc.getTextWidth(url1);
    const u2w = doc.getTextWidth(url2);

    doc.text(url1, rightX - u1w, y);
    doc.link(rightX - u1w, y - 3.2, u1w, 4.6, { url: url1 });

    doc.text(url2, rightX - u2w, y + 4);
    doc.link(rightX - u2w, y + 0.8, u2w, 4.6, { url: url2 });

    doc.setTextColor(0);
  }
}



// =====================================================
// PDF CON jsPDF + IMAGEN DE MAPA
// =====================================================
async function downloadPDFDirect({ params, resumen, proyectos, model, filename }) {
  log("📄 Generando PDF...");
  runtimeDebugLog("enter downloadPDFDirect", {
    params,
    proyectos: Array.isArray(proyectos) ? proyectos.length : null,
  });


  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("jsPDF no disponible");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const margin = 15;
  const pageWidth = 210;
  const pageBottom = 270;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // =====================================================
  // Helpers
  // =====================================================
  const safeUrl = (u) => {
    const s = String(u ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return "https://" + s.replace(/^\/+/, "");
  };

  // ✅ Helper inversión (MMUS$) para TABLA FINAL
  const getInv = (p) => {
    const v = Number(
      p?.inversion ??
        p?.inversionMm ??
        p?.inv ??
        p?.mmus ??
        p?.inversion_mmus ??
        p?.inversionMMUS
    );
    return Number.isFinite(v) ? v : null;
  };

  const fmtInv = (p) => {
    const v = getInv(p);
    return v == null ? "—" : v.toFixed(1);
  };

  // =====================================================
  // PORTADA / CABECERA
  // =====================================================
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("GeoEVA – Informe de Proximidad", margin, y);
  y += 10;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const info = [
    `Punto: ${Number(params.lat).toFixed(6)}, ${Number(params.lng).toFixed(6)}`,
    `Modo: ${params.modo} | Radio: ${Number(params.radio).toFixed(2)} km | Proyectos: ${params.n}`,
    `${resumen?.texto || "Sin datos"}`,
    `${resumen?.inversion || "Sin datos"}`,
  ];

  info.forEach((line) => {
    const lines = doc.splitTextToSize(String(line ?? ""), contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 5;
  });

  y += 5;

  // =====================================================
  // MAPA + PANEL (SIN DEFORMAR)
  // =====================================================
  log("📷 Capturando mapa...");
  const mapPng = await captureMapPng();

  if (mapPng) {
    // Si no cabe el bloque completo en la página, saltar ANTES
    if (y + 20 > pageBottom) {
      doc.addPage();
      y = margin;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Mapa de consulta", margin, y);
    y += 6;

    const gap = 6;
    const panelW = 68;

    // alto máximo permitido para el bloque mapa+panel
    const maxBlockH = 95;

    // ancho máximo disponible para el mapa (dejando espacio al panel)
    const mapMaxW = contentWidth - panelW - gap;

    // proporción REAL del PNG
    const props = doc.getImageProperties(mapPng);
    const imgRatio = props.width / props.height;

    // ratio seguro (fallback si viene raro)
    const safeRatio =
      Number.isFinite(imgRatio) && imgRatio > 0 ? imgRatio : mapMaxW / maxBlockH;

    // intento 1: usar ancho máximo
    let mapW = mapMaxW;
    let mapH = mapW / safeRatio;

    // si se pasa del alto máximo, ajusta por alto
    if (mapH > maxBlockH) {
      mapH = maxBlockH;
      mapW = mapH * safeRatio;
    }

    // si no cabe en la página, saltar ANTES de dibujar
    if (y + mapH > pageBottom) {
      doc.addPage();
      y = margin;

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Mapa de consulta", margin, y);
      y += 6;
    }

    // insertar mapa SIN deformar
    doc.addImage(mapPng, "PNG", margin, y, mapW, mapH);

    // panel con misma altura
    drawSummaryListPanel(doc, {
      x: margin + mapW + gap,
      y,
      w: panelW,
      h: mapH,
      projects: proyectos,
    });

    y += mapH + 10;

    // =====================================================
    // ANÁLISIS (CAJA IA)
    // =====================================================
    const aiBoxH = 55;
    if (y + aiBoxH > pageBottom) {
      doc.addPage();
      y = margin;
    }

    const aiText = computeExecutiveInsights(proyectos, params);

    drawExecutiveAiBox(doc, {
      x: margin,
      y,
      w: contentWidth,
      h: aiBoxH,
      title: REPORT_TITLES.execTitle(Number(params?.radio)),
      text: aiText,
    });

    y += aiBoxH + 8;

    // =====================================================
    // FORZAR GRÁFICOS DESDE PÁGINA 2 (UNA SOLA VEZ)
    // =====================================================
    doc.addPage();
    y = margin;

    log("✅ Mapa + lista resumen + análisis agregados");
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("⚠ No se pudo capturar mapa", margin, y);
    y += 8;

    // si no hay mapa, igual partimos gráficos en página 2
    doc.addPage();
    y = margin;
  }

  // =====================================================
  // GRÁFICOS PLOTLY
  // =====================================================
  log("📊 Exportando gráficos...");
  const chartImages = await ensureChartsRenderedForPdf(model || window.__geoeva_model);

  if (chartImages.length) {
    y = addPlotImagesToPdf(doc, { images: chartImages, margin, pageWidth, yStart: y });
    log(`✅ Gráficos agregados: ${chartImages.length}`);
  } else {
    log("⚠ No hay gráficos para agregar (Plotly / render / DOM).");
  }

  // =====================================================
  // TABLA FINAL
  // =====================================================
  if (y > 250) {
    doc.addPage();
    y = margin;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Proyectos Encontrados", margin, y);
  y += 8;

  const headers = [
    [
      "#",
      "Proyecto",
      "Titular",
      "Inv (MMUS$)",
      "Estado",
      "Sector",
      "Región",
      "Dist. (km)",
    ],
  ];

  // ⚠️ Importante: aquí trunco "Proyecto" a 40 chars.
  // En didDrawCell usamos EXACTAMENTE el mismo label (cell.text[0]) para medir el ancho del link.
  const data = (proyectos || []).map((p, i) => [
    String(i + 1),
    (p?.nombre || "").toString().substring(0, 40),
    (String(p?.titular ?? "–")).substring(0, 35),
    fmtInv(p),
    (p?.estado || "—").toString(),
    (p?.sector || "—").toString(),
    (p?.region || "—").toString(),
    Number.isFinite(p?.distKm) ? p.distKm.toFixed(2) : "—",
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head: headers,
      body: data,
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { cellWidth: 8 },                   // #
        1: { cellWidth: 48 },                  // Proyecto
        2: { cellWidth: 32 },                  // Titular
        3: { cellWidth: 16, halign: "right" }, // Inv
        4: { cellWidth: 16 },                  // Estado
        5: { cellWidth: 18 },                  // Sector
        6: { cellWidth: 20 },                  // Región
        7: { cellWidth: 16, halign: "right" }, // Dist
      },

      // ✅ SOLO UNO: link expediente (web) + icono 📎 a anexos (documentacion)
      didDrawCell: (hook) => {
        try {
          if (hook.section !== "body") return;
          if (hook.column.index !== 1) return; // SOLO columna "Proyecto"

          const i = hook.row.index;
          const p = (proyectos || [])[i];
          if (!p) return;

          const cell = hook.cell;

          // 1) Link al expediente sobre el texto del nombre
          const expUrl = safeUrl(p?.web);
          if (expUrl) {
            const label =
              String(cell.text?.[0] ?? "").trim() ||
              ((p?.nombre || "").toString().substring(0, 40)) ||
              "—";

            const x0 = cell.x + 2; // padding izquierdo
            const w = doc.getTextWidth(label);
            doc.link(x0, cell.y + 1, w, cell.height - 2, { url: expUrl });
          }

          // 2) Tag pequeño → anexos (documentacion)
          const anexosUrl = safeUrl(p?.documentacion);
          if (anexosUrl) {
            const tag = "[anexos]";

            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);          // 👈 más chico que el texto normal
            doc.setTextColor(120);       // 👈 gris tipo referencia

            const tagW = doc.getTextWidth(tag);
            const tagX = cell.x + cell.width - tagW - 2;
            const tagY = cell.y + cell.height / 2 + 2.1;

            // dibuja el texto
            doc.text(tag, tagX, tagY);

            // área clickeable SOLO sobre [anexos]
            doc.link(
              tagX,
              cell.y + 1,
              tagW,
              cell.height - 2,
              { url: anexosUrl }
            );

            doc.setTextColor(0);
          }


        } catch (e) {
          warn("didDrawCell link warning:", e);
        }
      },
    });

    y = doc.lastAutoTable.finalY + 10;
  } else {
    // Fallback ultra simple si no está autotable
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    data.slice(0, 25).forEach((row) => {
      if (y > pageBottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(row.join(" | ").slice(0, 110), margin, y);
      y += 5;
    });
  }

  // =====================================================
  // FOOTER + GUARDAR
  // =====================================================
  if (y > pageBottom) {
    doc.addPage();
    y = margin;
  }

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generado: ${new Date().toLocaleString("es-CL")}`, margin, y);

  const safeFilename = String(filename || `GeoEVA_informe_${Date.now()}.pdf`).trim();

  // ✅ Footer con hipervínculos en todas las páginas
  addPdfFooter(doc, { margin });

  runtimeDebugLog("before trackEvent geoeva_download_pdf_success", { filename: safeFilename });
  trackEvent("geoeva_download_pdf_success", {
    value: 1,
    event_category: "entregables",
    event_label: "mapainfo_pdf",
    file_name: safeFilename,

    radio_km: Number.isFinite(params?.radio)
      ? Number(Number(params.radio).toFixed(2))
      : null,
    modo: params?.modo || null,
    lat: Number.isFinite(Number(params?.lat))
      ? Number(Number(params.lat).toFixed(6))
      : null,
    lng: Number.isFinite(Number(params?.lng))
      ? Number(Number(params.lng).toFixed(6))
      : null,

    proyectos: Array.isArray(proyectos) ? proyectos.length : null,
    ts: Date.now(),
  });
  runtimeDebugLog("after trackEvent geoeva_download_pdf_success");
  runtimeDebugLog("before doc.save", { filename: safeFilename });
  doc.save(safeFilename);
  runtimeDebugLog("after doc.save", { filename: safeFilename });

  log("✅ PDF:", safeFilename);
}


function bindPdfButtonOnce() {
  const btn = document.getElementById("btnPdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    runtimeDebugLog("btnPdf click handler enter", {
      disabled: btn.disabled,
      bound: btn.dataset.bound,
      hasModel: Boolean(model),
    });
    try {
      if (!model) {
        alert("Espera a que carguen los datos...");
        return;
      }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "⏳ Generando...";

      const resumenTexto = document.getElementById("countLabel")?.textContent || "";
      const invTexto = document.getElementById("invLabel")?.textContent || "";

      const radio = Number(
        model?.query?.radioKmFinal ??
        model?.query?.radioKm ??
        model?.query?.radio ??
        NaN
      );

      trackEvent("geoeva_download_pdf", {
        event_category: "entregables",
        event_label: "mapainfo_pdf",
        radio_km: Number.isFinite(radio) ? Number(radio.toFixed(2)) : null,
        modo: model?.query?.modo || null,
        proyectos: Array.isArray(model?.projects) ? model.projects.length : null,
        non_interaction: true,
      });
      runtimeDebugLog("after trackEvent geoeva_download_pdf");

      runtimeDebugLog("before downloadPDFDirect()");
      const exportRegion = resolveExportRegion({
        model,
        params: model?.query,
        proyectos: model?.projects,
      });
      const exportId = buildExportId({ region: exportRegion });
      await downloadPDFDirect({
        params: {
          lat: model.query.lat,
          lng: model.query.lng,
          radio: Number.isFinite(radio) ? radio : 0,
          modo: model.query.modo,
          n: model.query.n ?? (model.projects?.length ?? 0),
        },
        resumen: {
          texto: resumenTexto,
          inversion: invTexto,
        },
        proyectos: Array.isArray(model.projects) ? model.projects : [],
        model,
        filename: `${exportId}.pdf`,
      });
      runtimeDebugLog("after downloadPDFDirect()");
      // Temporalmente desactivado: exportación extendida (JSON + JPG)
      // await exportMetadataAndThumbnail({
      //   exportId,
      //   model,
      //   params: model?.query,
      //   proyectos: Array.isArray(model.projects) ? model.projects : [],
      // });

      btn.textContent = "✅ Listo";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } catch (err) {
      runtimeDebugLog("btnPdf click handler error", err);
      error("❌ Error:", err);
      alert(`Error: ${err.message}`);
      btn.textContent = "🖨️ PDF";
      btn.disabled = false;
    }
  });
}

function resizeAllPlots(retries = 6) {
  if (!window.Plotly) return;

  const plots = document.querySelectorAll(".js-plotly-plot, .plotly-graph-div, .plotly-chart");

  // Si aún no existen plots (o están en 0px), reintenta un poco
  if ((!plots || plots.length === 0) && retries > 0) {
    setTimeout(() => resizeAllPlots(retries - 1), 180);
    return;
  }

  let anyResized = false;

  plots.forEach((p) => {
    if (!p) return;
    if (p.offsetWidth > 0 && p.offsetHeight > 0) {
      try { Plotly.Plots.resize(p); anyResized = true; } catch {}
    }
  });

  // Si existían pero estaban en 0px, reintenta un poco
  if (!anyResized && retries > 0) {
    setTimeout(() => resizeAllPlots(retries - 1), 180);
  }
}

function bindMapainfoDeepScrollTracker({ threshold = 0.75 } = {}) {
  let sent = false;

  const emit = () => {
    if (sent) return;
    sent = true;
    trackEvent("geoeva_mapainfo_scroll_deep", {
      page: "mapainfo",
      threshold: Math.round(threshold * 100),
    });
  };

  const onScroll = () => {
    const doc = document.documentElement;
    const viewport = window.innerHeight || doc.clientHeight || 0;
    const scrollable = Math.max(doc.scrollHeight - viewport, 1);
    const depth = (window.scrollY || window.pageYOffset || 0) / scrollable;
    if (depth >= threshold) {
      emit();
      window.removeEventListener("scroll", onScroll);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

async function main() {
  try {
    setLoadingProgress(8, "Preparando análisis...");

    const params = getMapainfoParamsFromUrl();
    if (isMobile()) params.n = 10;

    setLoadingProgress(18, "Inicializando mapa...");
    initMap({ lat: params.lat, lng: params.lng });

    panel = createProjectsPanel({
      containerId: "panelContent",
      countId: "panelCount",
      onSelectProject: (id) => {
        panel.highlight(id);
        mapLayers.highlightProject(id);
      },
    });

    setLoadingProgress(35, "Cargando proyectos...");
    const proyectos = await loadProyectos(DATA_URL);

    setLoadingProgress(55, "Calculando proximidad...");
    const engineOutput = runProximityEngine({
      projects: proyectos,
      center: { lat: params.lat, lng: params.lng },
      modo: params.modo,
      radioKm: params.radio,
      n: params.n,
    });

    setLoadingProgress(70, "Construyendo modelo...");
    model = buildReportModel({
      engineOutput,
      meta: { sourceFile: DATA_URL, generatedAt: new Date().toISOString() },
    });

    window.__geoeva_model = model;

    setLoadingProgress(82, "Renderizando panel y mapa...");
    renderInfoBar(model);
    renderExecutiveAnalysis(model);
    bindExecutiveReflow(() => model);

    const radioFinal =
      Number.isFinite(model.query.radioKmFinal) && model.query.radioKmFinal > 0
        ? model.query.radioKmFinal
        : params.radio;

    mapLayers.setQueryPoint(model.query.lat, model.query.lng);
    mapLayers.setQueryCircle(model.query.lat, model.query.lng, radioFinal);

    mapLayers.renderProjects(model.projects, {
      onMarkerClick: (id) => {
        panel.highlight(id);
        mapLayers.highlightProject(id);
      },
    });

    const bounds =
      typeof mapLayers.getQueryCircleBounds === "function"
        ? mapLayers.getQueryCircleBounds()
        : null;

    if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
    else map.setView([model.query.lat, model.query.lng], 12);

    panel.render(model.projects);

    setLoadingProgress(92, "Generando gráficos...");
    await updateCharts(model);

    requestAnimationFrame(() => resizeAllPlots());
    setTimeout(resizeAllPlots, 250);

    bindKmzButton({
      buttonId: "btnKmz",
      getModel: () => model,
      exporter: async (...args) => await downloadProximityKMZ(...args),
      attachGlobalName: "downloadProximityKMZ",
    });

    bindPdfButtonOnce();

    setLoadingProgress(100, "Listo");
    setTimeout(() => hideLoadingOverlay(), 3000);
  } catch (err) {
    error("❌ Error:", err);
    setLoadingProgress(100, "Error al cargar");
    setTimeout(() => hideLoadingOverlay(), 700);
    alert("Error fatal al cargar datos.");
  }
}

window.addEventListener("orientationchange", () => setTimeout(() => resizeAllPlots(), 450));
window.addEventListener("resize", () => setTimeout(() => resizeAllPlots(), 250));

document.addEventListener("DOMContentLoaded", () => {
  initMobileSheet();
  bindMapainfoDeepScrollTracker({ threshold: 0.75 });
  main();
});
