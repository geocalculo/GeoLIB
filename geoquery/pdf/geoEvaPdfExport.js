(function () {
  "use strict";

  const PDF_LAYOUT = { marginLeft: 10, marginRight: 10, marginTop: 13, marginBottom: 14, headerHeight: 8, footerHeight: 8, sectionGap: 4, panelGap: 3 };
  const COLORS = { ink: [31,41,55], muted: [107,114,128], line: [220,226,235], soft: [248,250,252], accent: [14,116,144], accentSoft: [236,253,245], warning: [146,64,14] };
  const LINE = 4.2;

  function assertGeoEvaPDFDependencies() {
    if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") throw new Error("jsPDF no disponible");
    if (typeof window.domtoimage?.toPng !== "function") throw new Error("dom-to-image no disponible"); const { jsPDF } = window.jspdf; const testDoc = new jsPDF(); if (typeof testDoc.autoTable !== "function") throw new Error("jsPDF-AutoTable no disponible");
  }

  function createGeoEvaPdfDocument() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: "portrait", unit: "mm", format: "letter", compress: true });
  }

  function fmtDate(date = new Date()) { return new Date(date).toISOString().slice(0, 10); }
  function fmtDateCL(date = new Date()) { const d = new Date(date); return `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`; }
  function present(value) { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text && !["undefined","null","nan","n/d","—"].includes(text.toLowerCase()) ? text : ""; }
  function fmtNumber(value, digits = 6) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(digits) : ""; }
  function fmtKm(value) { const n = Number(value); return Number.isFinite(n) ? `${n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km` : "N/D"; }
  function cleanItems(items) { return (items || []).filter(item => present(item?.label) || present(item?.value)); }
  function splitPdfText(doc, text, maxWidth) { return doc.splitTextToSize(String(text ?? ""), maxWidth); }
  function sanitizePdfFilenamePart(value) { return String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80); }
  function normalizePdfUrl(value) { const raw = String(value ?? "").trim(); return /^https?:\/\//i.test(raw) ? raw : ""; }
  function buildFilename(model, filename) {
    if (filename) return sanitizePdfFilenamePart(filename).replace(/\.pdf$/i, "") + ".pdf";
    const date = fmtDate(model?.identity?.generatedAt || new Date());
    const lat = fmtNumber(model?.query?.lat, 6);
    const lon = fmtNumber(model?.query?.lon, 6);
    return lat && lon ? `GeoEVA_Reporte_${sanitizePdfFilenamePart(lat)}_${sanitizePdfFilenamePart(lon)}_${date}.pdf` : `GeoEVA_Reporte_${date}.pdf`;
  }

  function createContext(doc, model, map, mapElement) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentLeft = PDF_LAYOUT.marginLeft;
    const contentRight = pageWidth - PDF_LAYOUT.marginRight;
    const contentWidth = contentRight - contentLeft;
    const contentTop = PDF_LAYOUT.marginTop + PDF_LAYOUT.headerHeight;
    const pageBottom = pageHeight - PDF_LAYOUT.marginBottom - PDF_LAYOUT.footerHeight;
    return { model, map, mapElement, pageWidth, pageHeight, contentLeft, contentRight, contentWidth, contentTop, pageBottom, y: contentTop, sectionGap: PDF_LAYOUT.sectionGap, panelGap: PDF_LAYOUT.panelGap, capturedCharts: [] };
  }

  function setColor(doc, key) { doc.setTextColor(...COLORS[key]); }
  function drawRoundedPanel(doc, x, y, w, h, fill = COLORS.soft) { doc.setFillColor(...fill); doc.setDrawColor(...COLORS.line); doc.roundedRect(x, y, w, h, 2.2, 2.2, "FD"); }
  function addPdfPage(doc, context) { doc.addPage(); context.y = context.contentTop; }
  function ensurePdfSpace(doc, context, requiredHeight) {
    const availableHeight = context.pageBottom - context.contentTop;
    const safeHeight = Math.min(requiredHeight, availableHeight);
    if (context.y + safeHeight > context.pageBottom) addPdfPage(doc, context);
  }
  function drawSectionTitle(doc, title, context) {
    if (!title) return;
    ensurePdfSpace(doc, context, 8);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...COLORS.accent);
    doc.text(String(title), context.contentLeft, context.y + 4);
    doc.setDrawColor(...COLORS.line); doc.line(context.contentLeft, context.y + 6, context.contentRight, context.y + 6);
    context.y += 9;
  }

  function drawDocumentIntro(doc, context) {
    const q = context.model.query || {};
    const lines = [`Generado: ${fmtDateCL(context.model.identity?.generatedAt || new Date())}`];
    if (Number.isFinite(Number(q.lat)) && Number.isFinite(Number(q.lon))) lines.push(`Coordenadas: ${fmtNumber(q.lat)} / ${fmtNumber(q.lon)}`);
    if (present(q.region) || present(q.commune)) lines.push(`Ubicación administrativa: ${present(q.region) || "N/D"}${present(q.commune) ? ` · ${present(q.commune)}` : ""}`);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...COLORS.ink);
    doc.text("GeoEVA | Reporte del punto consultado", context.contentLeft, context.y + 2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); setColor(doc, "muted");
    lines.forEach((line, i) => doc.text(line, context.contentLeft, context.y + 8 + i * 4));
    context.y += 10 + lines.length * 4;
  }

  function drawKpiGrid(doc, section, context) {
    const items = cleanItems(section.data?.items || section.data || []);
    const columns = section.data?.columns || 4;
    drawSectionTitle(doc, section.title, context);
    const gap = 2.2, cellW = (context.contentWidth - gap * (columns - 1)) / columns;
    doc.setFontSize(7.2); doc.setFont("helvetica", "bold");
    let rowH = 16;
    items.slice(0, columns).forEach(item => { rowH = Math.max(rowH, 8 + splitPdfText(doc, present(item.value) || "N/D", cellW - 6).length * 3.4); });
    ensurePdfSpace(doc, context, rowH);
    items.slice(0, columns).forEach((item, i) => {
      const x = context.contentLeft + i * (cellW + gap);
      drawRoundedPanel(doc, x, context.y, cellW, rowH, COLORS.accentSoft);
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); setColor(doc, "muted"); doc.text(String(item.label || ""), x + 3, context.y + 5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); setColor(doc, "ink"); doc.text(splitPdfText(doc, present(item.value) || "N/D", cellW - 6), x + 3, context.y + 10);
    });
    context.y += rowH + context.sectionGap;
  }

  function drawLabelValueGrid(doc, section, context) {
    const data = cleanItems(section.data?.items || section.data || []);
    drawSectionTitle(doc, section.title, context);
    if (!data.length) return drawNoticePanel(doc, { data: { text: "Sin información disponible para esta sección." } }, context);
    const cols = section.data?.columns || 2, gap = 3, cellW = (context.contentWidth - gap * (cols - 1)) / cols;
    for (let i = 0; i < data.length; i += cols) {
      const row = data.slice(i, i + cols);
      let h = 12;
      row.forEach(item => { doc.setFontSize(8); h = Math.max(h, 8 + splitPdfText(doc, present(item.value) || "N/D", cellW - 7).length * 3.8); });
      ensurePdfSpace(doc, context, h);
      row.forEach((item, idx) => { const x = context.contentLeft + idx * (cellW + gap); drawRoundedPanel(doc, x, context.y, cellW, h, [255,255,255]); doc.setFont("helvetica", "bold"); doc.setFontSize(7); setColor(doc, "muted"); doc.text(String(item.label || ""), x + 3, context.y + 5); doc.setFont("helvetica", "normal"); doc.setFontSize(8); setColor(doc, "ink"); doc.text(splitPdfText(doc, present(item.value) || "N/D", cellW - 7), x + 3, context.y + 9); });
      context.y += h + context.panelGap;
    }
    context.y += context.sectionGap - context.panelGap;
  }

  function drawTextPanel(doc, section, context) {
    drawSectionTitle(doc, section.title, context);
    const text = section.data?.text ?? section.data ?? "";
    const lines = splitPdfText(doc, text, context.contentWidth - 8);
    const h = Math.max(14, lines.length * LINE + 8);
    ensurePdfSpace(doc, context, h);
    drawRoundedPanel(doc, context.contentLeft, context.y, context.contentWidth, h, [255,255,255]);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.6); setColor(doc, "ink"); doc.text(lines, context.contentLeft + 4, context.y + 6);
    context.y += h + context.sectionGap;
  }
  function drawNoticePanel(doc, section, context) { drawTextPanel(doc, { title: section.title, data: { text: section.data?.text || section.data || "Sin información disponible." } }, context); }
  function drawMetricGrid(doc, section, context) { drawLabelValueGrid(doc, { title: section.title, data: { columns: 2, items: (section.data?.groups || []).flatMap(g => [{ label: "Subgrupo", value: g.title }, ...(g.items || [])]) } }, context); }

  function drawCardGrid(doc, section, context) {
    const cards = section.data?.items || section.data || [];
    drawSectionTitle(doc, section.title, context);
    const cols = section.data?.columns || 2, gap = 3, w = (context.contentWidth - gap) / cols;
    for (let i = 0; i < cards.length; i += cols) {
      const row = cards.slice(i, i + cols);
      let h = 24;
      row.forEach(card => { const lineCount = (card.fields || []).reduce((sum, f) => sum + splitPdfText(doc, `${f.label}: ${present(f.value) || "N/D"}`, w - 8).length, 0); h = Math.max(h, 12 + lineCount * 3.4); });
      ensurePdfSpace(doc, context, h);
      row.forEach((card, idx) => { const x = context.contentLeft + idx * (w + gap); drawRoundedPanel(doc, x, context.y, w, h, [255,255,255]); doc.setFont("helvetica", "bold"); doc.setFontSize(8.2); setColor(doc, "accent"); doc.text(splitPdfText(doc, card.title || "Registro", w - 8), x + 4, context.y + 5); doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); setColor(doc, "ink"); let yy = context.y + 10; (card.fields || []).forEach(f => { const lines = splitPdfText(doc, `${f.label}: ${present(f.value) || "N/D"}`, w - 8); doc.text(lines, x + 4, yy); yy += lines.length * 3.4; }); });
      context.y += h + context.panelGap;
    }
    context.y += context.sectionGap - context.panelGap;
  }

  async function drawPointAndMapBlock(doc, section, context) {
    drawSectionTitle(doc, section.title || "Punto consultado y mapa de ubicación", context);
    const gap = 5, pointWidth = (context.contentWidth - gap) * (1.1 / 2.1), mapWidth = context.contentWidth - gap - pointWidth, h = 58;
    ensurePdfSpace(doc, context, h);
    const y = context.y;
    drawRoundedPanel(doc, context.contentLeft, y, pointWidth, h, [255,255,255]);
    drawRoundedPanel(doc, context.contentLeft + pointWidth + gap, y, mapWidth, h, [255,255,255]);
    const items = cleanItems(section.data?.pointItems || []);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); setColor(doc, "accent"); doc.text("Punto consultado", context.contentLeft + 4, y + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); setColor(doc, "ink"); let yy = y + 12;
    items.forEach(item => { const lines = splitPdfText(doc, `${item.label}: ${present(item.value) || "N/D"}`, pointWidth - 8); doc.text(lines, context.contentLeft + 4, yy); yy += lines.length * 3.8; });
    let mapPng = section.data?.mapPng;
    if (!mapPng && context.mapElement) { try { mapPng = await captureGeoEvaMapPng({ map: context.map, mapElement: context.mapElement }); } catch (error) { console.warn("[GeoEVA PDF] No fue posible capturar el mapa", error); } }
    const mx = context.contentLeft + pointWidth + gap + 3, my = y + 8, mw = mapWidth - 6, mh = h - 12;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); setColor(doc, "accent"); doc.text("Mapa de ubicación", context.contentLeft + pointWidth + gap + 4, y + 6);
    if (mapPng) {
      const props = doc.getImageProperties(mapPng);
      const ratio = props.width && props.height ? props.width / props.height : mw / mh;
      let drawW = mw;
      let drawH = drawW / ratio;
      if (drawH > mh) { drawH = mh; drawW = drawH * ratio; }
      const drawX = mx + (mw - drawW) / 2;
      const drawY = my + (mh - drawH) / 2;
      doc.addImage(mapPng, "PNG", drawX, drawY, drawW, drawH, undefined, "FAST");
    }
    else { doc.setFont("helvetica", "normal"); doc.setFontSize(7.8); setColor(doc, "warning"); doc.text(splitPdfText(doc, `No fue posible incorporar la imagen del mapa durante esta exportación. Coordenadas: ${fmtNumber(context.model.query?.lat)} / ${fmtNumber(context.model.query?.lon)}. Mapa base: ${present(context.model.query?.basemap) || "N/D"}.`, mw - 4), mx + 2, my + 7); }
    context.y += h + context.sectionGap;
  }

  function drawMetadataTable(doc, section, context) {
    drawSectionTitle(doc, section.title, context);
    if (typeof doc.autoTable !== "function") { console.warn("[GeoEVA PDF] AutoTable no disponible"); return drawLabelValueGrid(doc, { data: { items: (section.data?.rows || []).flatMap(row => row.map((v, i) => ({ label: section.data?.head?.[i] || `Campo ${i+1}`, value: v }))) } }, context); }
    ensurePdfSpace(doc, context, 18);
    doc.autoTable({ head: [section.data?.head || []], body: section.data?.rows || [], startY: context.y, margin: { left: context.contentLeft, right: context.pageWidth - context.contentRight }, styles: { fontSize: 7.3, cellPadding: 1.6, overflow: "linebreak" }, headStyles: { fillColor: COLORS.accent, textColor: [255,255,255], fontStyle: "bold" }, showHead: "everyPage" });
    context.y = (doc.lastAutoTable?.finalY || context.y) + context.sectionGap;
  }

  async function captureGeoEvaMapPng({ map, mapElement }) {
    if (typeof window.domtoimage?.toPng !== "function") throw new Error("dom-to-image no disponible");
    if (!map || !mapElement) throw new Error("Mapa Leaflet no disponible");
    const center = typeof map.getCenter === "function" ? map.getCenter() : null;
    const zoom = typeof map.getZoom === "function" ? map.getZoom() : null;
    const hidden = [...mapElement.querySelectorAll(".leaflet-control-container, .leaflet-control, .map-toggle, .map-touch-hint, [role='tooltip'], .leaflet-tooltip")].map(el => [el, el.style.visibility]);
    try {
      hidden.forEach(([el]) => { el.style.visibility = "hidden"; });
      map.invalidateSize({ pan: false, animate: false });
      await nextFrames(2); await waitForGeoEvaMapTiles(mapElement); await new Promise(r => setTimeout(r, 220));
      const rect = mapElement.getBoundingClientRect(); const width = Math.round(rect.width); const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) throw new Error("Contenedor de mapa sin dimensiones");
      return await window.domtoimage.toPng(mapElement, { width, height, style: { transform: "scale(1)", transformOrigin: "top left" } });
    } finally {
      hidden.forEach(([el, visibility]) => { el.style.visibility = visibility; });
      if (center && Number.isFinite(zoom) && typeof map.setView === "function") map.setView(center, zoom, { animate: false });
      map.invalidateSize({ pan: false, animate: false });
    }
  }
  function nextFrames(count) { return new Promise(resolve => { const step = n => n <= 0 ? resolve() : requestAnimationFrame(() => step(n - 1)); step(count); }); }
  async function waitForGeoEvaMapTiles(mapElement, timeout = 6000) {
    const pending = [...mapElement.querySelectorAll(".leaflet-tile")].filter(image => !image.complete);
    if (!pending.length) return;
    await Promise.race([Promise.allSettled(pending.map(image => new Promise(resolve => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))), new Promise(resolve => setTimeout(resolve, timeout))]);
  }

  async function captureGeoEvaCharts() {
    const charts = [];
    const nodes = [...document.querySelectorAll('[data-pdf-chart="true"]')];
    for (const node of nodes) {
      try {
        let dataUrl = "";
        if (window.Plotly?.toImage && node.classList.contains("js-plotly-plot")) dataUrl = await window.Plotly.toImage(node, { format: "png", width: node.clientWidth || 800, height: node.clientHeight || 420 });
        else if (node.__chartjs?.toBase64Image) dataUrl = node.__chartjs.toBase64Image();
        else if (node instanceof HTMLCanvasElement) dataUrl = node.toDataURL("image/png");
        if (dataUrl) charts.push({ title: node.dataset.pdfTitle || node.getAttribute("aria-label") || "Gráfico", dataUrl });
      } catch (error) { console.warn("[GeoEVA PDF] No fue posible exportar un gráfico", error); }
    }
    return charts;
  }
  function drawImageGrid(doc, section, context) {
    const images = section.data?.images || [];
    if (!images.length) return;
    drawSectionTitle(doc, section.title, context);
    images.forEach(image => { const h = Math.min(70, context.contentWidth * 0.52); ensurePdfSpace(doc, context, h + 8); doc.setFont("helvetica", "bold"); doc.setFontSize(8.4); setColor(doc, "ink"); doc.text(image.title || "Gráfico", context.contentLeft, context.y + 4); doc.addImage(image.dataUrl, "PNG", context.contentLeft, context.y + 7, context.contentWidth, h, undefined, "FAST"); context.y += h + 10; });
  }

  function addGeoEvaPdfHeader(doc, context, pageNumber, totalPages) { doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...COLORS.accent); doc.text("GeoEVA | Reporte del punto consultado", PDF_LAYOUT.marginLeft, PDF_LAYOUT.marginTop); doc.setDrawColor(...COLORS.line); doc.line(PDF_LAYOUT.marginLeft, PDF_LAYOUT.marginTop + 3, context.pageWidth - PDF_LAYOUT.marginRight, PDF_LAYOUT.marginTop + 3); }
  function addGeoEvaPdfFooter(doc, context, pageNumber, totalPages) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setColor(doc, "muted"); doc.text(`Fecha de generación: ${fmtDateCL(context.model.identity?.generatedAt || new Date())}`, PDF_LAYOUT.marginLeft, context.pageHeight - PDF_LAYOUT.marginBottom + 2); doc.text(`Página ${pageNumber} de ${totalPages}`, context.pageWidth - PDF_LAYOUT.marginRight - 25, context.pageHeight - PDF_LAYOUT.marginBottom + 2); }
  function addPdfHeaderFooterToAllPages(doc, context) { const total = doc.getNumberOfPages(); for (let p = 1; p <= total; p += 1) { doc.setPage(p); addGeoEvaPdfHeader(doc, context, p, total); addGeoEvaPdfFooter(doc, context, p, total); } }



  const GEOEVA_HTML_PDF_COVERAGE = [
    { htmlId: "geoquery-related-features-panel", pdfSectionId: "related-projects" },
    { htmlId: "geoquery-related-features-panel", pdfSectionId: "cluster-base" },
    { htmlId: "geoquery-related-features-panel", pdfSectionId: "dominant-sector" },
    { htmlId: "geoquery-metadata-panel", pdfSectionId: "project-cards" },
    { htmlId: "geoquery-metadata-panel", pdfSectionId: "project-metadata" },
    { htmlId: "geoquery-geometry-panel", pdfSectionId: "geometry-descriptors" },
    { htmlId: "geoquery-relation-indicators-panel", pdfSectionId: "spatial-indicators" }
  ];

  function deduplicateLabelValueRows(rows) {
    const seen = new Set();
    return (rows || []).filter(row => {
      const label = String(row?.label ?? row?.[0] ?? "").trim();
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }
  function normalizeStatusLabel(value) { const raw = String(value ?? "").trim().toLowerCase(); if (/aprob/.test(raw) || raw === "approved") return "Aprobado"; if (/rechaz/.test(raw) || raw === "rejected") return "Rechazado"; if (/calific/.test(raw)) return "En calificación"; return present(value) || "Sin información"; }
  function isApprovedStatus(value) { return normalizeStatusLabel(value) === "Aprobado"; }
  function kmToMeters(value) { const n = Number(value); return Number.isFinite(n) ? n * 1000 : null; }
  function fmtMeters(value) { const n = Number(value); return Number.isFinite(n) ? fmtKm(n / 1000) : "N/D"; }
  function percentText(value) { const n = Number(value); return Number.isFinite(n) ? `${n.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %` : "N/D"; }
  function firstPresent(...values) { for (const value of values) { const text = present(value); if (text) return text; } return ""; }

  function projectToPdfRow(item, index) {
    const props = item?.feature?.properties || item?.properties || {};
    const investment = Number(props.inversion_mmusd);
    return {
      order: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : index + 1,
      id: firstPresent(props.id, props.expediente, props.codigo, props.objectid, props.fid, props.web),
      name: firstPresent(props.nombre_proyecto, props.nombre_busq, props.nombre, "Proyecto sin nombre"),
      owner: firstPresent(props.titular, props.razon_social, "Sin información"),
      sector: firstPresent(props.sector, "Sin sector informado"),
      status: normalizeStatusLabel(props.estado),
      investment: Number.isFinite(investment) ? investment : null,
      investmentFormatted: Number.isFinite(investment) ? `US$ ${investment.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MM` : "No informada",
      region: firstPresent(props.region),
      commune: firstPresent(props.comuna),
      typology: firstPresent(props.tipo_presentacion, props.tipologia, props.tipo),
      distanceMeters: kmToMeters(item?.distance_km),
      distanceFormatted: fmtKm(item?.distance_km),
      sourceUrl: normalizePdfUrl(props.web),
      properties: props
    };
  }

  function buildGeoEvaPdfModel(reportModel) {
    if (reportModel?.relatedProjects || reportModel?.cluster) return reportModel;
    const state = reportModel?.state || window.geoQueryState || {};
    const qp = state.queryContext?.queryPoint || {};
    const clusterItems = Array.isArray(state.base_approved_cluster) ? state.base_approved_cluster : (state.groupResults?.[0]?.selectedFeatures || []);
    const relatedProjects = clusterItems.map(projectToPdfRow);
    const territorial = state.territorial_group || state.groupResults?.[0]?.normalizedProperties || {};
    const limiting = relatedProjects.length ? relatedProjects[relatedProjects.length - 1] : null;
    const radiusMeters = Number.isFinite(Number(state.analysis_radius_m)) ? Number(state.analysis_radius_m) : limiting?.distanceMeters;
    const domCount = Number(territorial.dominantSectorCount ?? territorial.dominantSectorProjects?.length);
    const dominantSector = { name: firstPresent(territorial.dominantSector, relatedProjects.length ? "Sin sector informado" : "Sin proyectos aprobados disponibles"), count: Number.isFinite(domCount) ? domCount : 0, participationPercent: Number.isFinite(Number(territorial.dominantSectorShare)) ? Number(territorial.dominantSectorShare) : null, participationFormatted: percentText(territorial.dominantSectorShare) };
    const query = { lat: qp.lat ?? state.lat ?? state.lat_decimal, lon: qp.lon ?? state.lon ?? state.lon_decimal, latDms: state.lat_dms, lonDms: state.lon_dms, crs: state.crs || "WGS84 / EPSG:4326", source: state.source || "Parámetro URL", originSite: state.site || state.queryContext?.site || "geoeva", state: state.status === "resolved" ? "Análisis del clúster resuelto." : state.status === "empty" ? "Sin proyectos aprobados disponibles." : state.status || "N/D", basemap: state.basemap || state.mapState?.basemap, region: state.region, commune: state.commune };
    const pointItems = deduplicateLabelValueRows([
      { label: "Latitud decimal", value: fmtNumber(query.lat) }, { label: "Longitud decimal", value: fmtNumber(query.lon) }, { label: "Latitud GMS", value: query.latDms }, { label: "Longitud GMS", value: query.lonDms }, { label: "CRS", value: query.crs }, { label: "Región", value: query.region || "No informada" }, { label: "Comuna", value: query.commune || "No informada" }, { label: "Fuente", value: query.source === "url_params" ? "Parámetro URL" : query.source }, { label: "Estado", value: query.state }
    ]);
    const projectMetadata = { columns: ["#", "Proyecto", "Titular", "Sector", "Estado", "Inversión", "Comuna", "Distancia"], rows: relatedProjects.map(p => [p.order, p.name, p.owner, p.sector, p.status, p.investmentFormatted, p.commune || "No informada", p.distanceFormatted]) };
    const model = {
      identity: { site: "GeoEVA", title: "Reporte del punto consultado", generatedAt: state.timestamp || new Date().toISOString(), version: window.geoEvaPdfConfig?.title || "GeoEVA PDF directo" }, query, relation: { type: "nearest", label: "Cercanía al punto consultado" },
      cluster: { definition: "10 proyectos aprobados más cercanos", requestedCount: 10, selectedCount: relatedProjects.length, radiusMeters, radiusFormatted: fmtMeters(radiusMeters), limitingProjectId: limiting?.id || "", limitingProjectName: limiting?.name || "", limitingProjectDistanceMeters: limiting?.distanceMeters },
      dominantSector, relatedProjects,
      geometryDescriptors: { clusterRadiusMeters: radiusMeters, clusterRadiusFormatted: fmtMeters(radiusMeters), allApproved: { count: relatedProjects.length, meanInterprojectDistanceMeters: kmToMeters(territorial.approvedPairStats?.meanKm), meanInterprojectDistanceFormatted: fmtKm(territorial.approvedPairStats?.meanKm), minimumInterprojectDistanceMeters: kmToMeters(territorial.approvedPairStats?.minKm), minimumInterprojectDistanceFormatted: fmtKm(territorial.approvedPairStats?.minKm) }, dominantSectorApproved: { sector: dominantSector.name, count: dominantSector.count, meanInterprojectDistanceMeters: kmToMeters(territorial.dominantSectorPairStats?.meanKm), meanInterprojectDistanceFormatted: fmtKm(territorial.dominantSectorPairStats?.meanKm), minimumInterprojectDistanceMeters: kmToMeters(territorial.dominantSectorPairStats?.minKm), minimumInterprojectDistanceFormatted: fmtKm(territorial.dominantSectorPairStats?.minKm) } },
      spatialIndicators: { relationLabel: "Cercanía al punto consultado", allApproved: { count: relatedProjects.length, meanDistanceFromPointMeters: kmToMeters(territorial.approvedPointRelationStats?.meanKm), meanDistanceFromPointFormatted: fmtKm(territorial.approvedPointRelationStats?.meanKm), minimumDistanceFromPointMeters: kmToMeters(territorial.approvedPointRelationStats?.minKm), minimumDistanceFromPointFormatted: fmtKm(territorial.approvedPointRelationStats?.minKm) }, dominantSectorApproved: { sector: dominantSector.name, count: dominantSector.count, meanDistanceFromPointMeters: kmToMeters(territorial.dominantSectorPointRelationStats?.meanKm), meanDistanceFromPointFormatted: fmtKm(territorial.dominantSectorPointRelationStats?.meanKm) } },
      projectMetadata, pointItems,
      technicalMetadata: deduplicateLabelValueRows([...pointItems, { label: "Fecha de consulta", value: fmtDateCL(state.timestamp || new Date()) }, { label: "Mapa base", value: query.basemap }, { label: "Regla del clúster", value: "10 proyectos aprobados más cercanos" }, { label: "Cantidad solicitada", value: "10" }, { label: "Cantidad seleccionada", value: String(relatedProjects.length) }, { label: "Radio del clúster", value: fmtMeters(radiusMeters) }, { label: "Sector dominante", value: dominantSector.name }, { label: "Fuente de proyectos", value: "GeoJSON de proyectos GeoEVA" }, { label: "Archivo GeoJSON", value: state.source_geojson }, { label: "Método espacial", value: "Cercanía al punto consultado" }, { label: "Viewport original", value: state.queryContext?.originalViewport ? JSON.stringify(state.queryContext.originalViewport) : "No informado" }, { label: "Versión del reporte", value: window.geoEvaPdfConfig?.title }, { label: "Estado de carga", value: query.state }]),
      sources: ["Archivo de proyectos: GeoJSON de proyectos GeoEVA", state.source_geojson, "Fuente de mapa base: OpenStreetMap / Esri World Imagery según mapa activo", "Configuración de capas cargada por GeoQuery"].filter(present),
      methodology: ["Se seleccionan los 10 proyectos aprobados más cercanos al punto consultado.", "El radio corresponde a la distancia del último proyecto aprobado seleccionado.", "El sector dominante se determina dentro del grupo seleccionado.", "Los descriptores geométricos miden distancias entre proyectos.", "Los indicadores espaciales miden distancias desde el punto consultado.", "El análisis se limita al conjunto de datos cargado por GeoQuery."],
      disclaimer: "Reporte documental generado automáticamente desde GeoQuery. La información mantiene carácter referencial y debe contrastarse con las fuentes oficiales correspondientes.", state
    };
    const invalidProjects = model.relatedProjects.filter(project => !isApprovedStatus(project.status));
    if (invalidProjects.length) console.error("[GeoEVA PDF] El clúster contiene proyectos no aprobados", invalidProjects);
    window.__geoevaReportModel = model;
    return model;
  }

  function buildExecutiveSummary(model) {
    const n = model.relatedProjects?.length || 0;
    if (!n) return "No se identificaron proyectos aprobados disponibles para construir el clúster base.";
    const nearest = model.relatedProjects[0];
    return `Se analizaron los ${n} proyectos aprobados más cercanos al punto consultado. El radio del clúster es de ${model.cluster.radiusFormatted}. El sector dominante es ${model.dominantSector.name}, con ${model.dominantSector.count} proyectos y una participación del ${model.dominantSector.participationFormatted}. El proyecto aprobado más cercano es ${nearest.name}, ubicado a ${nearest.distanceFormatted} del punto consultado.`;
  }

  function auditGeoEvaPdfCoverage(model, sections) {
    const sectionIds = new Set(sections.map(section => section.id));
    GEOEVA_HTML_PDF_COVERAGE.forEach(({ htmlId, pdfSectionId }) => {
      const node = document.getElementById(htmlId);
      const resolved = node && !/pendiente|cargando/i.test(node.textContent || "");
      if (resolved && !sectionIds.has(pdfSectionId)) console.error("[GeoEVA PDF] Sección informativa omitida", { htmlId, expectedPdfSection: pdfSectionId });
    });
    const invalidProjects = (model.relatedProjects || []).filter(project => !isApprovedStatus(project.status));
    if (invalidProjects.length) console.error("[GeoEVA PDF] El clúster contiene proyectos no aprobados", invalidProjects);
    if ((model.projectMetadata?.rows || []).length !== (model.relatedProjects || []).length) console.error("[GeoEVA PDF] Metadata de proyectos no coincide con el modelo", { rows: model.projectMetadata?.rows?.length, projects: model.relatedProjects?.length });
  }

  const PDF_SECTION_RENDERERS = { "kpi-grid": drawKpiGrid, "point-map": drawPointAndMapBlock, "text-panel": drawTextPanel, "metric-grid": drawMetricGrid, "card-list": drawCardGrid, "table": drawMetadataTable, "metadata": drawLabelValueGrid, "notice": drawNoticePanel, "image-grid": drawImageGrid };
  async function renderGeoEvaPdfSection(doc, section, context) { const renderer = PDF_SECTION_RENDERERS[section.type]; if (!renderer) return console.warn("[GeoEVA PDF] Renderizador no disponible", section.type); await renderer(doc, section, context); }
  async function exportGeoEvaPDFDirect({ reportModel, map, mapElement, filename } = {}) {
    let currentPdfStep = "initialization";
    try {
      currentPdfStep = "dependencies"; assertGeoEvaPDFDependencies();
      currentPdfStep = "building_model"; const model = buildGeoEvaPdfModel(reportModel || window.__geoevaReportModel || { state: window.geoQueryState || {} });
      currentPdfStep = "document"; const doc = createGeoEvaPdfDocument(); const context = createContext(doc, model, map || window.geoQueryLeafletMap, mapElement || document.getElementById("geoquery-map"));
      currentPdfStep = "capturing_charts"; context.capturedCharts = await captureGeoEvaCharts();
      currentPdfStep = "drawing_sections"; drawDocumentIntro(doc, context); const sections = collectGeoEvaPdfSections(model, context); auditGeoEvaPdfCoverage(model, sections); for (const section of sections) await renderGeoEvaPdfSection(doc, section, context);
      currentPdfStep = "adding_footer"; addPdfHeaderFooterToAllPages(doc, context);
      currentPdfStep = "saving"; const safeFilename = buildFilename(model, filename); doc.save(safeFilename); console.info("[GeoEVA PDF] Descarga solicitada:", safeFilename, { pages: doc.getNumberOfPages() }); return { filename: safeFilename, pages: doc.getNumberOfPages() };
    } catch (error) { console.error("[GeoEVA PDF]", { step: currentPdfStep, message: error?.message, stack: error?.stack, error }); throw error; }
  }

  function detailItemsFromPanel(selector) { return [...document.querySelectorAll(`${selector} .detail-row`)].map(row => ({ label: row.querySelector("dt")?.textContent, value: row.querySelector("dd")?.textContent })); }

  function collectGeoEvaPdfSections(rawModel, context) {
    const model = buildGeoEvaPdfModel(rawModel);
    const pointItems = deduplicateLabelValueRows(model.pointItems || []);
    const selectedText = model.cluster.selectedCount
      ? `${model.cluster.selectedCount} aprobados`
      : "Sin aprobados";
    const relatedIntro = model.cluster.selectedCount
      ? `El clúster base está conformado por los ${model.cluster.selectedCount} proyectos aprobados más cercanos al punto consultado. Badge documental: ${model.cluster.selectedCount} proyectos aprobados más cercanos.`
      : "No se identificaron proyectos aprobados disponibles para construir el clúster base.";
    const dominantProjects = (model.relatedProjects || []).filter(project => project.sector === model.dominantSector.name).map(project => `${project.order}. ${project.name}`).join("; ");
    const sections = [
      { id: "query-summary", type: "kpi-grid", title: "Resumen de consulta", order: 10, data: { columns: 4, items: [{ label: "Latitud", value: fmtNumber(model.query?.lat) || "N/D" }, { label: "Longitud", value: fmtNumber(model.query?.lon) || "N/D" }, { label: "Proyectos aprobados analizados", value: selectedText }, { label: "Estado", value: model.cluster.selectedCount ? "Resuelto" : "Sin aprobados" }] } },
      { id: "point-map", type: "point-map", title: "Punto consultado y mapa de ubicación", order: 20, data: { pointItems } },
      { id: "executive-summary", type: "text-panel", title: "Resumen ejecutivo", order: 30, data: { text: buildExecutiveSummary(model) } },
      { id: "related-projects", type: "notice", title: "Proyectos relacionados", order: 40, data: { text: relatedIntro } },
      { id: "cluster-base", type: "metadata", title: "Clúster base", order: 50, data: { columns: 2, items: [
        { label: "Regla", value: model.cluster.definition }, { label: "Cantidad seleccionada", value: String(model.cluster.selectedCount) }, { label: "Radio del clúster", value: model.cluster.radiusFormatted }, { label: "Proyecto que define el radio", value: model.cluster.limitingProjectName || "N/D" }, { label: "Distancia del proyecto limitante", value: fmtMeters(model.cluster.limitingProjectDistanceMeters) }, { label: "Estado considerado", value: "Aprobados" }, { label: "Sector dominante", value: model.dominantSector.name }, { label: "Participación del sector dominante", value: model.dominantSector.participationFormatted }
      ] } },
      { id: "dominant-sector", type: "metadata", title: "Sector dominante", order: 60, data: { columns: 2, items: [
        { label: "Sector", value: model.dominantSector.name }, { label: "Proyectos del sector", value: String(model.dominantSector.count) }, { label: "Total de aprobados analizados", value: String(model.cluster.selectedCount) }, { label: "Participación", value: model.dominantSector.participationFormatted }, { label: "Proyectos", value: dominantProjects || "N/D" }
      ] } }
    ];
    if ((model.relatedProjects || []).length) sections.push({ id: "project-cards", type: "card-list", title: "10 proyectos aprobados más cercanos", order: 70, data: { columns: 2, items: model.relatedProjects.map(project => ({ title: `${project.order}. ${project.name}`, fields: [
      { label: "Titular", value: project.owner }, { label: "Sector", value: project.sector }, { label: "Estado", value: project.status }, { label: "Inversión", value: project.investmentFormatted }, { label: "Comuna", value: project.commune }, { label: "Región", value: project.region }, { label: "Tipología", value: project.typology }, { label: "Distancia al punto", value: project.distanceFormatted }, { label: "ID / expediente", value: project.id }, { label: "Enlace oficial", value: project.sourceUrl }
    ].filter(field => present(field.value)) })) } });
    sections.push(
      { id: "geometry-descriptors", type: "metric-grid", title: "Descriptores geométricos", order: 80, data: { groups: [
        { title: "Proyectos aprobados — total", items: [{ label: "Radio del clúster", value: model.geometryDescriptors.clusterRadiusFormatted }, { label: "Proyectos analizados", value: String(model.geometryDescriptors.allApproved.count) }, { label: "Distancia media entre proyectos aprobados", value: model.geometryDescriptors.allApproved.meanInterprojectDistanceFormatted }, { label: "Distancia mínima entre proyectos aprobados", value: model.geometryDescriptors.allApproved.minimumInterprojectDistanceFormatted }] },
        { title: `Proyectos aprobados — sector dominante: ${model.geometryDescriptors.dominantSectorApproved.sector}`, items: [{ label: "Cantidad de proyectos del sector", value: String(model.geometryDescriptors.dominantSectorApproved.count) }, { label: "Distancia media entre proyectos aprobados del sector dominante", value: model.geometryDescriptors.dominantSectorApproved.meanInterprojectDistanceFormatted }, { label: "Distancia mínima entre proyectos aprobados del sector dominante", value: model.geometryDescriptors.dominantSectorApproved.minimumInterprojectDistanceFormatted }] }
      ] } },
      { id: "spatial-indicators", type: "metric-grid", title: "Indicadores de relación espacial", order: 90, data: { groups: [
        { title: "Tipo de relación", items: [{ label: "Relación", value: model.spatialIndicators.relationLabel }] },
        { title: "Proyectos aprobados — total", items: [{ label: "Cantidad analizada", value: String(model.spatialIndicators.allApproved.count) }, { label: "Distancia media desde el punto consultado", value: model.spatialIndicators.allApproved.meanDistanceFromPointFormatted }, { label: "Distancia mínima al punto consultado", value: model.spatialIndicators.allApproved.minimumDistanceFromPointFormatted }] },
        { title: `Proyectos aprobados — sector dominante: ${model.spatialIndicators.dominantSectorApproved.sector}`, items: [{ label: "Cantidad de proyectos del sector", value: String(model.spatialIndicators.dominantSectorApproved.count) }, { label: "Distancia media desde el punto consultado", value: model.spatialIndicators.dominantSectorApproved.meanDistanceFromPointFormatted }] }
      ] } }
    );
    if ((model.projectMetadata?.rows || []).length) sections.push({ id: "project-metadata", type: "table", title: "Metadata de proyectos", order: 100, data: { head: model.projectMetadata.columns, rows: model.projectMetadata.rows } });
    sections.push(
      { id: "technical-metadata", type: "table", title: "Metadata técnica", order: 900, data: { head: ["Campo", "Valor"], rows: deduplicateLabelValueRows(model.technicalMetadata || []).map(i => [i.label, i.value]) } },
      { id: "methodology", type: "notice", title: "Metodología", order: 950, data: { text: (model.methodology || []).join(" ") } },
      { id: "sources", type: "notice", title: "Fuentes", order: 990, data: { text: (model.sources || []).join(". ") } },
      { id: "disclaimer", type: "notice", title: "Descargo", order: 1000, data: { text: model.disclaimer } }
    );
    sections.push(...collectGeoEvaDomPdfSections(new Set(sections.map(section => section.id))));
    model.sections = sections.map(section => section.id);
    return sections.filter(section => section.type === "notice" || section.type === "point-map" || section.type === "kpi-grid" || (section.data && Object.keys(section.data).length)).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function collectGeoEvaDomPdfSections(excludedIds = new Set()) {
    return [...document.querySelectorAll("[data-pdf-section]")]
      .map((node, index) => {
        const id = present(node.dataset.pdfSection) || `dom-section-${index + 1}`;
        if (excludedIds.has(id) || node.hidden || node.matches('[data-pdf-export="false"], .pdf-no-export') || /descargas|download|exportar pdf|descargar pdf|descargar kml/i.test(node.textContent || "")) return null;
        const type = present(node.dataset.pdfType) || "text-panel";
        const order = Number(node.dataset.pdfOrder || 9000 + index);
        const title = present(node.dataset.pdfTitle) || present(node.querySelector("h1,h2,h3,h4")?.textContent) || null;
        const text = present(node.dataset.pdfText) || present(node.textContent);
        return text ? { id, type, title, order, data: { text } } : null;
      })
      .filter(Boolean);
  }


  let isGeneratingGeoEvaPDF = false;
  function getGeoEvaPdfButtons() { return [...document.querySelectorAll("button.download-button, [data-pdf-button='true']")].filter(button => /PDF/i.test(button.textContent || button.title || "")); }
  function setGeoEvaPdfButtonsReady() { const ready = Boolean(window.geoQueryState?.exportState?.pdfEnabled || window.geoQueryState?.status === "resolved"); getGeoEvaPdfButtons().forEach(button => { button.disabled = !ready || isGeneratingGeoEvaPDF; button.title = ready ? "Descargar PDF" : "Disponible cuando exista análisis territorial."; button.dataset.pdfButton = "true"; }); }
  function bindGeoEvaPdfButtonOnce() { getGeoEvaPdfButtons().forEach(button => { if (button.dataset.pdfBound === "1") return; button.dataset.pdfBound = "1"; button.addEventListener("click", async event => { event.preventDefault(); if (isGeneratingGeoEvaPDF) return; isGeneratingGeoEvaPDF = true; const buttons = getGeoEvaPdfButtons(); const original = new Map(buttons.map(b => [b, b.textContent])); buttons.forEach(b => { b.disabled = true; b.textContent = "Generando PDF…"; }); try { await exportGeoEvaPDFDirect(); } finally { isGeneratingGeoEvaPDF = false; buttons.forEach(b => b.textContent = original.get(b) || "Exportar PDF"); setGeoEvaPdfButtonsReady(); } }); }); setGeoEvaPdfButtonsReady(); }
  document.addEventListener("DOMContentLoaded", bindGeoEvaPdfButtonOnce); const geoEvaPdfReadyTimer = window.setInterval(() => { bindGeoEvaPdfButtonOnce(); if (window.geoQueryState?.exportState?.pdfEnabled) window.clearInterval(geoEvaPdfReadyTimer); }, 500);
  window.GeoEvaPdfExport = { exportGeoEvaPDFDirect, bindGeoEvaPdfButtonOnce, assertGeoEvaPDFDependencies, createGeoEvaPdfDocument, collectGeoEvaPdfSections, captureGeoEvaMapPng, captureGeoEvaCharts, waitForGeoEvaMapTiles, collectGeoEvaDomPdfSections, buildGeoEvaPdfModel, deduplicateLabelValueRows, auditGeoEvaPdfCoverage, GEOEVA_HTML_PDF_COVERAGE, sanitizePdfFilenamePart, normalizePdfUrl, PDF_LAYOUT };
})();
