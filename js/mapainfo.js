// js/mapainfo.js - VERSIÓN DEFINITIVA CON MAPA EN PDF
// PDF con jsPDF + captura de mapa con dom-to-image

import { loadProyectosXlsx } from "./core/dataLoader.js";
import { runProximityEngine } from "./features/proximity/proximityEngine.js";
import { buildReportModel } from "./report/reportModel.js";
import { createMapLayers } from "./ui/mapLayers.js";
import { createProjectsPanel } from "./ui/panel.js";
import { updateCharts } from "./ui/chartsController.js";
import { downloadProximityKMZ } from "./export/kmzExport.js";
import { getMapainfoParamsFromUrl } from "./app/router.js";
import { renderInfoBar } from "./ui/infoBar.js";
import { bindKmzButton } from "./ui/actions.js";

const DATA_XLSX_URL = "capas/nacional.xlsx";

let map = null;
let mapLayers = null;
let panel = null;
let model = null;

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
  const hint = document.getElementById('mapTouchHint');
  let hintTimeout;
  
  container.style.touchAction = "pan-y";

  container.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length >= 2) e.preventDefault();
  }, { passive: false });

  container.addEventListener("touchstart", (e) => {
    const touchCount = e.touches ? e.touches.length : 0;
    
    if (touchCount >= 2) {
      // 2+ dedos: habilitar mapa
      map.dragging.enable();
      
      // Ocultar hint
      if (hint) {
        hint.classList.remove('active');
      }
    } else {
      // 1 dedo: deshabilitar mapa
      map.dragging.disable();
      
      // Mostrar hint brevemente
      if (hint) {
        hint.classList.add('active');
        clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
          hint.classList.remove('active');
        }, 2000);
      }
    }
  }, { passive: true });

  container.addEventListener("touchend", () => {
    map.dragging.disable();
  }, { passive: true });
  
  // Mostrar hint inicial por 3 segundos
  if (hint) {
    hint.classList.add('active');
    setTimeout(() => {
      hint.classList.remove('active');
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

  window.__openMobileSheet = open;
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
    console.warn("dom-to-image no cargado");
    return null;
  }

  const mapDiv = document.getElementById("map");
  if (!mapDiv) return null;

  try {
    // Ajustar zoom para que el círculo ocupe 60-70% del viewport
    const theMap = window.__leafletMap;
    const bounds = typeof mapLayers.getQueryCircleBounds === "function" 
      ? mapLayers.getQueryCircleBounds() 
      : null;
    
    if (theMap && bounds) {
      // Padding para que el círculo ocupe ~65% del espacio
      theMap.fitBounds(bounds, { 
        padding: [30, 30],
        animate: false,
        maxZoom: 14 
      });
    }

    // Esperar tiles (más tiempo para asegurar carga)
    await new Promise(r => setTimeout(r, 1000));

    // Capturar DIV completo con aspect ratio del contenedor
    const dataUrl = await window.domtoimage.toPng(mapDiv, {
      quality: 0.92,
      width: mapDiv.offsetWidth,
      height: mapDiv.offsetHeight
    });

    return dataUrl;
  } catch (error) {
    console.warn("Error capturando mapa:", error);
    return null;
  }
}

// =====================================================
// PDF CON jsPDF + IMAGEN DE MAPA
// =====================================================
async function downloadPDFDirect({ params, resumen, proyectos }) {
  console.log('📄 Generando PDF...');
  
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF no disponible');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const margin = 15;
  const pageWidth = 210;
  const contentWidth = pageWidth - (margin * 2);
  let y = margin;

  // Título
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('GeoEVA – Informe de Proximidad', margin, y);
  y += 10;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const info = [
    `Punto: ${Number(params.lat).toFixed(6)}, ${Number(params.lng).toFixed(6)}`,
    `Modo: ${params.modo} | Radio: ${Number(params.radio).toFixed(2)} km | Proyectos: ${params.n}`,
    `${resumen.texto || 'Sin datos'}`,
    `${resumen.inversion || 'Sin datos'}`
  ];

  info.forEach(line => {
    const lines = doc.splitTextToSize(line, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 5;
  });

  y += 5;

  // MAPA
  console.log('📷 Capturando mapa...');
  const mapPng = await captureMapPng();

  if (mapPng) {
    // Aspect ratio 1:1 (cuadrado)
    const imgSize = Math.min(contentWidth, 100); // 100mm máximo
    const imgW = imgSize;
    const imgH = imgSize;

    if (y + imgH > 270) {
      doc.addPage();
      y = margin;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Mapa de consulta", margin, y);
    y += 6;

    doc.addImage(mapPng, "PNG", margin, y, imgW, imgH);
    y += imgH + 8;

    console.log('✅ Mapa agregado');
  } else {
    doc.setFontSize(9);
    doc.text("⚠ No se pudo capturar mapa", margin, y);
    y += 8;
  }

  // Tabla
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Proyectos Encontrados', margin, y);
  y += 8;

  const headers = [['#', 'Proyecto', 'Estado', 'Sector', 'Región', 'Dist. (km)']];
  const data = proyectos.map((p, i) => [
    String(i + 1),
    (p.nombre || '').substring(0, 40),
    p.estado || '—',
    p.sector || '—',
    p.region || '—',
    Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : '—'
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head: headers,
      body: data,
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 65 },
        2: { cellWidth: 25 },
        3: { cellWidth: 25 },
        4: { cellWidth: 20 },
        5: { cellWidth: 20, halign: 'right' }
      }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Footer
  if (y > 270) {
    doc.addPage();
    y = margin;
  }
  
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generado: ${new Date().toLocaleString('es-CL')}`, margin, y);

  const filename = `GeoEVA_informe_${Date.now()}.pdf`;
  doc.save(filename);
  console.log('✅ PDF:', filename);
}

function bindPdfButtonOnce() {
  const btn = document.getElementById("btnPdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
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
        model?.query?.radioKmFinal ?? model?.query?.radioKm ?? model?.query?.radio ?? NaN
      );

      await downloadPDFDirect({
        params: {
          lat: model.query.lat,
          lng: model.query.lng,
          radio: Number.isFinite(radio) ? radio : 0,
          modo: model.query.modo,
          n: model.query.n ?? (model.projects?.length ?? 0),
        },
        resumen: { texto: resumenTexto, inversion: invTexto },
        proyectos: Array.isArray(model.projects) ? model.projects : [],
      });
      
      btn.textContent = "✅ Listo";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
      
    } catch (err) {
      console.error("❌ Error:", err);
      alert(`Error: ${err.message}`);
      btn.textContent = "🖨️ PDF";
      btn.disabled = false;
    }
  });
}

async function main() {
  const params = getMapainfoParamsFromUrl();
  if (isMobile()) params.n = 10;

  initMap({ lat: params.lat, lng: params.lng });

  panel = createProjectsPanel({
    containerId: "panelContent",
    countId: "panelCount",
    onSelectProject: (id) => {
      panel.highlight(id);
      mapLayers.highlightProject(id);
    },
  });

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

  window.__geoeva_model = model;

  renderInfoBar(model);

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

  const bounds = typeof mapLayers.getQueryCircleBounds === "function" ? mapLayers.getQueryCircleBounds() : null;
  if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
  else map.setView([model.query.lat, model.query.lng], 12);

  // ✅ CAMBIO: Renderizar panel SIEMPRE (en móvil y desktop)
  panel.render(model.projects);
  
  // ✅ Gráficos solo en desktop
  if (!isMobile()) updateCharts(model);

  bindKmzButton({
    buttonId: "btnKmz",
    getModel: () => model,
    exporter: downloadProximityKMZ,
    attachGlobalName: "downloadProximityKMZ",
  });

  bindPdfButtonOnce();
}

document.addEventListener("DOMContentLoaded", () => {
  initMobileSheet();
  main().catch((err) => {
    console.error("❌ Error:", err);
    alert("Error fatal.");
  });
});