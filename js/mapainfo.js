// ===========================
// GeoEVA - mapainfo.js
// Detalle de proximidad + panel + gráficos + Export PNG-KMZ
// (con punto consulta + círculo + puntos + estilos + popups tipo tabla + 2 links)
// + Balloon del círculo: 2 gráficos (PNG) + resumen % Aprobados + sector dominante
// + Sanitización XML/KML (evita "not well-formed (invalid token)" en Google Earth)
// ===========================
//
// Requisitos en mapainfo.html (orden recomendado):
// 1) Leaflet
// 2) XLSX
// 3) Plotly
// 4) JSZip  (para KMZ)
// 5) graficos.js (initCharts)
// 6) mapainfo.js (este)
//
// Botón:
// <button onclick="downloadProximityKMZ()">⬇ Descargar proyectos en KMZ</button>
//
// ===========================

const DATA_XLSX_URL = "capas/nacional.xlsx";

// ---------------------------
// Estado global (para export)
// ---------------------------
let globalParams = null;
let proyectosDentroDelRadio = [];
let markersMap = new Map(); // id -> marker
let currentHighlightedId = null;

let isLoadingData = false;
let map = null;
let clickTimeout = null;
let isHighlighting = false;

// Export helpers
let queryPoint = null; // {lat,lng}
let exportCircleKm = null; // radioKm
let exportModo = null; // "radio"|"proximidad"
let exportNParam = null;
let exportSectoresFiltro = [];
let exportResumen = null; // {resumenAprob,... invAprob,...}

// ---------------------------
// Utils
// ---------------------------
function parseCoord(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.indexOf(",") >= 0) {
    s = s.replace(",", ".");
  }
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatMMU(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return (
    value.toLocaleString("es-CL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " MMU$"
  );
}

// ---- XML/KML hardening: evita "invalid token" por caracteres de control ----
function stripInvalidXmlChars(s) {
  // Remueve controles inválidos en XML 1.0 (frecuentes al venir desde XLSX)
  // Permitidos: \t \n \r
  return String(s ?? "").replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    ""
  );
}

function xmlEscape(s) {
  const clean = stripInvalidXmlChars(s);
  return clean
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeCdata(html) {
  // evita romper CDATA y limpia chars inválidos
  return stripInvalidXmlChars(html).replaceAll("]]>", "]]&gt;");
}

async function loadExcelData() {
  if (isLoadingData) {
    console.warn("⚠️ Carga de datos ya en progreso, esperando...");
    return null;
  }
  isLoadingData = true;

  try {
    const resp = await fetch(DATA_XLSX_URL);
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status} al cargar ${DATA_XLSX_URL}`);
    const buf = await resp.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!json.length) return [];

    const rows = json.slice(1);

    // columnas (según tu nacional.xlsx)
    const COL_NOMBRE = 0;
    const COL_WEB = 1;
    const COL_TIPO = 2;
    const COL_REGION = 3;
    const COL_INV = 9;
    const COL_FECHA = 10;
    const COL_ESTADO = 11;
    const COL_SECTOR = 13;
    const COL_LAT = 14;
    const COL_LON = 15;
    const COL_ANEXOS = 16;
    const COL_ANIO = 17;

    const data = [];

    for (const row of rows) {
      if (!row || row.length === 0) continue;

      const lat = parseCoord(row[COL_LAT]);
      const lon = parseCoord(row[COL_LON]);
      if (lat === null || lon === null) continue;

      const invNum = parseCoord(row[COL_INV]);
      const anioVal = row[COL_ANIO];
      const anioNum =
        anioVal !== null && anioVal !== undefined && anioVal !== ""
          ? parseInt(anioVal, 10)
          : null;

      data.push({
        lat,
        lon,
        nombre: stripInvalidXmlChars(row[COL_NOMBRE] || ""),
        web: stripInvalidXmlChars(row[COL_WEB] || ""),
        tipo: stripInvalidXmlChars(row[COL_TIPO] || ""),
        region: stripInvalidXmlChars(row[COL_REGION] || ""),
        inversion: invNum,
        fechaIngreso: stripInvalidXmlChars(row[COL_FECHA] || ""),
        estado: stripInvalidXmlChars(row[COL_ESTADO] || ""),
        sector: stripInvalidXmlChars(row[COL_SECTOR] || ""),
        anexos: stripInvalidXmlChars(row[COL_ANEXOS] || ""),
        anio: anioNum,
      });
    }

    return data;
  } finally {
    isLoadingData = false;
  }
}

function ajustarZoomCirculo(map, circle) {
  const size = map.getSize();
  const minSide = Math.min(size.x, size.y);
  const paddingPx = minSide * 0.2;
  map.fitBounds(circle.getBounds(), { padding: [paddingPx, paddingPx] });
}

// ---------------------------
// Panel lateral
// ---------------------------
function togglePanel() {
  const panel = document.getElementById("projectsPanel");
  panel.classList.toggle("collapsed");
}

function renderProjectsList(proyectos) {
  if (proyectos.length > 500) {
    console.warn(
      `⚠️ ${proyectos.length} proyectos en el panel. El rendimiento puede degradarse.`
    );
  }

  const panelContent = document.getElementById("panelContent");
  const panelCount = document.getElementById("panelCount");
  if (!panelContent || !panelCount) return;

  panelContent.innerHTML = "";
  panelCount.textContent = proyectos.length;

  proyectos.forEach((proyecto) => {
    const item = document.createElement("div");
    item.className = "project-item";
    item.dataset.projectId = proyecto.id;

    let dotColor = "#6b7280";
    if (proyecto.bucket === "Aprob") dotColor = "#16a34a";
    else if (proyecto.bucket === "Calif") dotColor = "#ea580c";
    else if (proyecto.bucket === "Rech") dotColor = "#dc2626";

    const nombre = proyecto.nombre || "";
    const nombreDisplay =
      nombre.length > 60 ? nombre.substring(0, 57) + "..." : nombre;

    item.innerHTML = `
      <div class="project-id">#${proyecto.id}</div>
      <div class="project-name" title="${xmlEscape(nombre)}">${xmlEscape(
      nombreDisplay
    )}</div>
      <div class="project-status-dot" style="background:${dotColor}"></div>
    `;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      highlightProject(proyecto.id);
    });

    panelContent.appendChild(item);
  });
}

function clearHighlight() {
  if (currentHighlightedId === null) return;

  const highlightedItem = document.querySelector(".project-item.highlighted");
  if (highlightedItem) highlightedItem.classList.remove("highlighted");

  const marker = markersMap.get(currentHighlightedId);
  if (marker) {
    const el = marker.getElement();
    if (el) el.classList.remove("marker-highlighted");
    marker.closePopup();
  }

  currentHighlightedId = null;
}

function highlightProject(projectId) {
  if (isHighlighting) return;
  if (currentHighlightedId === projectId) return;

  isHighlighting = true;
  try {
    clearHighlight();

    // Resaltar item lista
    const listItem = document.querySelector(
      `[data-project-id="${projectId}"]`
    );
    if (listItem) {
      listItem.classList.add("highlighted");
      listItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Resaltar marker + abrir popup
    const marker = markersMap.get(projectId);
    if (marker) {
      const el = marker.getElement();
      if (el) el.classList.add("marker-highlighted");
      marker.openPopup();
    }

    currentHighlightedId = projectId;
  } finally {
    isHighlighting = false;
  }
}

// ---------------------------
// Popup tipo tabla (GeoIPT-like)
// ---------------------------
function getPopupTableHTML(p) {
  const latDisplay = Number.isFinite(p.lat) ? p.lat.toFixed(6) : "—";
  const lonDisplay = Number.isFinite(p.lon) ? p.lon.toFixed(6) : "—";
  const distDisplay = Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—";

  return `
    <table border="1" cellpadding="4" cellspacing="0"
           style="border-collapse:collapse; font-family:Arial; font-size:13px; width:100%;">
      <tr><th align="left">Proyecto</th><td>#${xmlEscape(p.id)} - ${xmlEscape(
    p.nombre || "—"
  )}</td></tr>
      <tr><th align="left">Tipo</th><td>${xmlEscape(p.tipo || "—")}</td></tr>
      <tr><th align="left">Sector</th><td>${xmlEscape(
        p.sector || "—"
      )}</td></tr>
      <tr><th align="left">Estado</th><td>${xmlEscape(
        p.estado || "—"
      )}</td></tr>
      <tr><th align="left">Año</th><td>${xmlEscape(p.anio ?? "—")}</td></tr>
      <tr><th align="left">Inversión</th><td>${xmlEscape(
        formatMMU(p.inversion)
      )}</td></tr>
      <tr><th align="left">Latitud</th><td>${xmlEscape(
        latDisplay
      )}</td></tr>
      <tr><th align="left">Longitud</th><td>${xmlEscape(
        lonDisplay
      )}</td></tr>
      <tr><th align="left">Distancia (km)</th><td>${xmlEscape(
        distDisplay
      )}</td></tr>
      <tr><th align="left">Expediente</th>
          <td>${
            p.web
              ? `<a href="${xmlEscape(p.web)}" target="_blank">Abrir expediente</a>`
              : "—"
          }</td></tr>
      <tr><th align="left">Anexos</th>
          <td>${
            p.anexos
              ? `<a href="${xmlEscape(p.anexos)}" target="_blank">Abrir anexos</a>`
              : "—"
          }</td></tr>
    </table>
  `;
}

// ---------------------------
// KMZ (PNG-KMZ)
// ---------------------------
function kmlColorFromHex(hex, alphaFF = "ff") {
  // KML usa aabbggrr
  const h = (hex || "#000000").replace("#", "");
  const rr = h.substring(0, 2);
  const gg = h.substring(2, 4);
  const bb = h.substring(4, 6);
  return `${alphaFF}${bb}${gg}${rr}`.toLowerCase();
}

function circlePolygonCoords(lng, lat, radiusKm, steps = 96) {
  // Aproximación: polígono WGS84 alrededor del punto
  const R = 6371; // km
  const rad = Math.PI / 180;
  const latRad = lat * rad;
  const lngRad = lng * rad;
  const d = radiusKm / R;

  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
        Math.cos(latRad) * Math.sin(d) * Math.cos(brng)
    );
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2)
      );

    const latDeg = lat2 / rad;
    const lngDeg = lng2 / rad;
    coords.push(`${lngDeg},${latDeg},0`);
  }
  return coords.join(" ");
}

async function plotlyDivToPngBytes(divId, width = 900, height = 320) {
  // Devuelve base64 (sin prefix) o null
  try {
    const div = document.getElementById(divId);
    if (!div || !window.Plotly) return null;

    const dataUrl = await Plotly.toImage(div, {
      format: "png",
      width,
      height,
      scale: 2,
    });

    if (!dataUrl || typeof dataUrl !== "string") return null;
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return base64;
  } catch (e) {
    console.warn("⚠️ No se pudo exportar PNG de chart", divId, e);
    return null;
  }
}

function buildConsultaHtmlForKml() {
  const lat = queryPoint?.lat;
  const lng = queryPoint?.lng;
  const radioKm = exportCircleKm ?? null;

  const modo = exportModo || "radio";
  const n = exportNParam ?? null;
  const sectores = Array.isArray(exportSectoresFiltro) ? exportSectoresFiltro : [];

  const snap = new Date().toLocaleString("es-CL");

  return `
    <div style="line-height:1.35;">
      <div><b>Punto:</b> ${
        Number.isFinite(lat) ? lat.toFixed(5) : "—"
      }, ${Number.isFinite(lng) ? lng.toFixed(5) : "—"}</div>
      <div><b>Modo:</b> ${xmlEscape(modo)} ${
        modo === "proximidad" ? `(N=${xmlEscape(n)})` : ""
      }</div>
      <div><b>Radio:</b> ${
        Number.isFinite(radioKm) ? radioKm.toFixed(1) : "—"
      } km</div>
      ${
        sectores.length
          ? `<div><b>Sectores filtro:</b> ${xmlEscape(sectores.join(", "))}</div>`
          : ""
      }
      <div style="color:#555; font-size:12px; margin-top:6px;">Snapshot: ${xmlEscape(
        snap
      )}</div>
    </div>
  `;
}

function chooseBucketFromProyecto(p) {
  const b = (p.bucket || "").toLowerCase();
  if (b.includes("aprob")) return "Aprob";
  if (b.includes("calif")) return "Calif";
  if (b.includes("rech")) return "Rech";
  return "Otros";
}

// ✅ Balloon del círculo: KPIs + 2 PNG + resumen final (% aprobados + sector dominante)
function buildCircleBalloonHTML(consultaHtml, exportResumen, chartImgs, proyectos) {
  const proyEstado = chartImgs.find((c) =>
    (c.filename || "").includes("proyectos_estado.png")
  );
  const invSector = chartImgs.find((c) =>
    (c.filename || "").includes("inversion_sector.png")
  );

  const totalProy =
    (exportResumen?.resumenAprob || 0) +
    (exportResumen?.resumenCalif || 0) +
    (exportResumen?.resumenRech || 0) +
    (exportResumen?.resumenOtros || 0);

  const invTotal =
    (exportResumen?.invAprob || 0) +
    (exportResumen?.invCalif || 0) +
    (exportResumen?.invRech || 0) +
    (exportResumen?.invOtros || 0);

  // % Aprobados
  const pctAprob =
    totalProy > 0 ? ((exportResumen?.resumenAprob || 0) / totalProy) * 100 : 0;

  // Sector con mayor inversión (y su % del total)
  const invPorSector = new Map();
  for (const p of proyectos || []) {
    const sec = (p.sector || "Sin sector").trim() || "Sin sector";
    const inv = Number.isFinite(p.inversion) ? p.inversion : 0;
    invPorSector.set(sec, (invPorSector.get(sec) || 0) + inv);
  }

  let topSector = "—";
  let topInv = 0;
  for (const [sec, inv] of invPorSector.entries()) {
    if (inv > topInv) {
      topInv = inv;
      topSector = sec;
    }
  }
  const pctTopSector = invTotal > 0 ? (topInv / invTotal) * 100 : 0;

  const snap = new Date().toLocaleString("es-CL");

  return `
    <div style="font-family:Arial; font-size:13px; max-width:780px;">
      <div style="font-weight:800; font-size:14px; margin:0 0 8px 0;">
        GeoEVA – Resumen de proximidad
      </div>

      <div style="margin:0 0 10px 0;">
        ${safeCdata(consultaHtml)}
      </div>

      <div style="padding:8px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; margin-bottom:10px;">
        <div><b>Proyectos:</b> ${xmlEscape(totalProy)}</div>
        <div><b>Inversión total:</b> ${xmlEscape(formatMMU(invTotal))}</div>
        <div style="color:#555; font-size:12px; margin-top:6px;">
          Snapshot: ${xmlEscape(snap)}
        </div>
      </div>

      <div style="margin:10px 0;">
        <div style="font-weight:700; margin:0 0 6px 0;"># Proyectos vs Estado</div>
        ${
          proyEstado
            ? `<img src="${xmlEscape(proyEstado.filename)}"
                   style="width:100%; max-width:780px; border:1px solid #ddd; border-radius:8px; display:block;" />`
            : `<div style="color:#b91c1c;">(No disponible)</div>`
        }
      </div>

      <div style="margin:12px 0 0 0;">
        <div style="font-weight:700; margin:0 0 6px 0;">Inversión vs Sector</div>
        ${
          invSector
            ? `<img src="${xmlEscape(invSector.filename)}"
                   style="width:100%; max-width:780px; border:1px solid #ddd; border-radius:8px; display:block;" />`
            : `<div style="color:#b91c1c;">(No disponible)</div>`
        }
      </div>

      <div style="margin-top:12px; padding-top:10px; border-top:1px solid #e5e7eb;">
        <div><b>% Aprobados:</b> ${pctAprob.toFixed(1)}%</div>
        <div><b>Sector dominante:</b> ${xmlEscape(topSector)} (${pctTopSector.toFixed(
    1
  )}% inversión)</div>
      </div>
    </div>
  `;
}

// ---------------------------
// ✅ Export principal: PNG + KMZ
// ---------------------------
window.downloadProximityKMZ = async function downloadProximityKMZ() {
  try {
    if (
      !queryPoint ||
      !Number.isFinite(queryPoint.lat) ||
      !Number.isFinite(queryPoint.lng)
    ) {
      alert("❌ No se pudo determinar el punto de consulta para exportar.");
      return;
    }

    if (
      !Array.isArray(proyectosDentroDelRadio) ||
      proyectosDentroDelRadio.length === 0
    ) {
      alert("No hay proyectos dentro del radio para exportar.");
      return;
    }

    if (!window.JSZip) {
      alert("❌ Falta JSZip. Asegúrate de cargarlo antes de mapainfo.js.");
      return;
    }

    // 1) Capturar SOLO 2 gráficos (Plotly) por título del card (H3)
    const chartImgs = [];
    const chartsGrid = document.getElementById("chartsGrid");
    const plotDivs = chartsGrid
      ? Array.from(chartsGrid.querySelectorAll(".plotly-chart"))
      : [];

    const TARGET_CHARTS = [
      {
        key: "proy_estado",
        titleRegex: /(proyectos).*?(estado)|(\#).*?(estado)/i,
        filename: "files/proyectos_estado.png",
        width: 780,
        height: 320,
      },
      {
        key: "inv_sector",
        titleRegex: /(inversi).*(sector)|(mmu).*(sector)/i,
        filename: "files/inversion_sector.png",
        width: 780,
        height: 320,
      },
    ];

    function getCardTitle(div) {
      const card = div.closest(".chart-card");
      const h3 = card ? card.querySelector("h3") : null;
      return h3 ? (h3.textContent || "").trim() : div.id || "";
    }

    const foundKeys = new Set();

    for (const div of plotDivs) {
      const id = div.id;
      if (!id) continue;

      const title = getCardTitle(div);
      const target = TARGET_CHARTS.find((t) => t.titleRegex.test(title));
      if (!target) continue;
      if (foundKeys.has(target.key)) continue;

      const base64 = await plotlyDivToPngBytes(id, target.width, target.height);
      if (!base64) continue;

      chartImgs.push({
        id,
        title,
        filename: target.filename,
        base64,
      });

      foundKeys.add(target.key);
      if (foundKeys.size === TARGET_CHARTS.length) break;
    }

    if (foundKeys.size !== TARGET_CHARTS.length) {
      console.warn(
        "⚠️ No se capturaron los 2 charts objetivo. Capturados:",
        [...foundKeys]
      );
    }

    // 2) Construir KML
    const lat = queryPoint.lat;
    const lng = queryPoint.lng;
    const radioKm = exportCircleKm ?? 0;

    // Colores GeoEVA
    const HEX = {
      Aprob: "#16a34a",
      Calif: "#ea580c",
      Rech: "#dc2626",
      Otros: "#6b7280",
      Consulta: "#1d4ed8",
      Circulo: "#1d4ed8",
    };

    const stylesKml = `
      <Style id="stConsulta">
        <IconStyle>
          <color>${kmlColorFromHex(HEX.Consulta, "ff")}</color>
          <scale>1.3</scale>
          <Icon>
            <href>http://maps.google.com/mapfiles/kml/pushpin/blue-pushpin.png</href>
          </Icon>
        </IconStyle>
        <LabelStyle><scale>1.0</scale></LabelStyle>
      </Style>

      <Style id="stCircle">
        <LineStyle><color>${kmlColorFromHex(HEX.Circulo, "ff")}</color><width>3</width></LineStyle>
        <PolyStyle><color>${kmlColorFromHex(HEX.Circulo, "15")}</color></PolyStyle>
      </Style>

      <Style id="stAprob">
        <IconStyle>
          <color>${kmlColorFromHex(HEX.Aprob, "ff")}</color>
          <scale>1.1</scale>
          <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png</href></Icon>
        </IconStyle>
      </Style>

      <Style id="stCalif">
        <IconStyle>
          <color>${kmlColorFromHex(HEX.Calif, "ff")}</color>
          <scale>1.1</scale>
          <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
        </IconStyle>
      </Style>

      <Style id="stRech">
        <IconStyle>
          <color>${kmlColorFromHex(HEX.Rech, "ff")}</color>
          <scale>1.1</scale>
          <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href></Icon>
        </IconStyle>
      </Style>

      <Style id="stOtros">
        <IconStyle>
          <color>${kmlColorFromHex(HEX.Otros, "ff")}</color>
          <scale>1.1</scale>
          <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href></Icon>
        </IconStyle>
      </Style>
    `;

    // Consulta HTML + Balloon círculo
    const consultaHtml = buildConsultaHtmlForKml();
    const circleBalloonHtml = buildCircleBalloonHTML(
      consultaHtml,
      exportResumen,
      chartImgs,
      proyectosDentroDelRadio
    );

    const consultaPlacemark = `
      <Placemark>
        <name>Punto de consulta</name>
        <styleUrl>#stConsulta</styleUrl>
        <description><![CDATA[
          <div style="font-family:Arial; font-size:13px;">
            ${safeCdata(consultaHtml)}
          </div>
        ]]></description>
        <Point><coordinates>${lng},${lat},0</coordinates></Point>
      </Placemark>
    `;

    // Círculo (polígono aproximado)
    const circlePoly =
      radioKm > 0
        ? `
        <Placemark>
          <name>Área de análisis (radio)</name>
          <styleUrl>#stCircle</styleUrl>
          <description><![CDATA[
            ${safeCdata(circleBalloonHtml)}
          ]]></description>

          <Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>${circlePolygonCoords(lng, lat, radioKm, 120)}</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>
        </Placemark>
      `
        : "";

    // Proyectos
    const proyectosValidos = proyectosDentroDelRadio.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)
    );

    const placemarksProyectos = proyectosValidos
      .map((p) => {
        const bucket = chooseBucketFromProyecto(p);
        const styleUrl =
          bucket === "Aprob"
            ? "#stAprob"
            : bucket === "Calif"
            ? "#stCalif"
            : bucket === "Rech"
            ? "#stRech"
            : "#stOtros";

        const html = getPopupTableHTML(p);

        return `
          <Placemark>
            <name>#${xmlEscape(p.id)} - ${xmlEscape(p.nombre || "Proyecto")}</name>
            <styleUrl>${styleUrl}</styleUrl>
            <description><![CDATA[${safeCdata(html)}]]></description>
            <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
          </Placemark>
        `;
      })
      .join("\n");

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>GeoEVA – Proximidad</name>
  <description><![CDATA[
    <div style="font-family:Arial; font-size:13px;">
      Exportación generada desde GeoEVA.<br/>
      Proyectos: ${xmlEscape(proyectosValidos.length)}
    </div>
  ]]></description>

  ${stylesKml}

  <Folder>
    <name>Consulta</name>
    ${consultaPlacemark}
    ${circlePoly}
  </Folder>

  <Folder>
    <name>Proyectos</name>
    ${placemarksProyectos}
  </Folder>

</Document>
</kml>`;

    // 3) Armar KMZ
    const zip = new JSZip();
    zip.file("doc.kml", kml);

    // Agregar PNG de charts (solo 2)
    for (const c of chartImgs) {
      zip.file(c.filename, c.base64, { base64: true });
    }

    // 4) Descargar KMZ
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geoeva_proximidad_png.kmz";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("❌ Error exportando KMZ:", err);
    alert("❌ Error exportando KMZ. Revisa consola.");
  }
};

// ---------------------------
// Init principal
// ---------------------------
document.addEventListener("DOMContentLoaded", async () => {
  // reset
  proyectosDentroDelRadio = [];
  markersMap.clear();
  currentHighlightedId = null;

  const params = new URLSearchParams(window.location.search);
  globalParams = params;

  const lat = parseFloat(params.get("lat"));
  const lng = parseFloat(params.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert(
      "❌ Error: Coordenadas inválidas en la URL.\n\nVerifica parámetros 'lat' y 'lng'."
    );
    console.error("Parámetros inválidos:", { lat, lng });
    return;
  }

  queryPoint = { lat, lng };

  const modo = params.get("modo") || "radio";
  const radioParam = parseFloat(params.get("radio")) || 10;
  const nParam = parseInt(params.get("n") || "10", 10);
  const sectoresParam = params.get("sectores") || "";
  const sectoresFiltro = sectoresParam
    ? sectoresParam.split("|").filter(Boolean)
    : [];

  exportModo = modo;
  exportNParam = nParam;
  exportSectoresFiltro = sectoresFiltro;

  const coordsLabel = document.getElementById("coordsLabel");
  const modoLabel = document.getElementById("modoLabel");
  const radioLabel = document.getElementById("radioLabel");
  const countLabel = document.getElementById("countLabel");
  const invLabel = document.getElementById("invLabel");

  if (coordsLabel)
    coordsLabel.textContent = `Punto: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (modoLabel) {
    modoLabel.textContent =
      modo === "proximidad"
        ? `Modo: Proximidad (N=${nParam} aprobados)`
        : `Modo: Radio (R=${radioParam} km)`;
  }

  const toggleEl = document.getElementById("panelToggle");
  if (toggleEl) toggleEl.addEventListener("click", togglePanel);

  // Mapa
  map = L.map("map", { center: [lat, lng], zoom: 10, minZoom: 4 });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1.0,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.1, maxZoom: 19 }
  ).addTo(map);

  L.control.scale().addTo(map);

  // Punto consulta (azul)
  L.circleMarker([lat, lng], {
    radius: 6,
    color: "#1d4ed8",
    weight: 2,
    fillColor: "#1d4ed8",
    fillOpacity: 1,
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  // Leyenda
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = `
      <div class="legend-item"><span class="legend-color" style="background:#16a34a;"></span> Aprobado</div>
      <div class="legend-item"><span class="legend-color" style="background:#ea580c;"></span> En calificación / evaluación</div>
      <div class="legend-item"><span class="legend-color" style="background:#dc2626;"></span> Rechazado</div>
      <div class="legend-item"><span class="legend-color" style="background:#6b7280;"></span> Otros estados</div>
    `;
    return div;
  };
  legend.addTo(map);

  // Cargar datos
  let proyectos;
  try {
    proyectos = await loadExcelData();
    if (!proyectos || proyectos.length === 0)
      throw new Error(
        "No se pudieron cargar proyectos (Excel vacío o error)."
      );
  } catch (err) {
    console.error("Error cargando nacional.xlsx:", err);
    if (radioLabel) radioLabel.textContent = "Radio: —";
    if (countLabel)
      countLabel.textContent = "Error al cargar datos de proyectos.";
    if (invLabel) invLabel.textContent = "Inversión: —";
    return;
  }

  // Filtro sectores (si viene)
  if (sectoresFiltro.length) {
    proyectos = proyectos.filter((p) => {
      const sectorLower = (p.sector || "").toLowerCase();
      return sectoresFiltro.some(
        (s) => sectorLower === s.trim().toLowerCase()
      );
    });
  }

  const todosConDist = proyectos.map((p) => ({
    ...p,
    distKm: distanceKm(lat, lng, p.lat, p.lon),
  }));

  let radioKm = radioParam;
  let topNSet = new Set();

  if (modo === "proximidad") {
    const aprobados = todosConDist.filter((p) =>
      (p.estado || "").toLowerCase().includes("aprob")
    );
    aprobados.sort((a, b) => a.distKm - b.distKm);
    const aprobTopN = aprobados.slice(0, nParam);

    if (aprobTopN.length) {
      radioKm = aprobTopN[aprobTopN.length - 1].distKm;
      topNSet = new Set(
        aprobTopN.map((p) => `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`)
      );
    } else {
      radioKm = radioParam;
    }
  }

  exportCircleKm = radioKm;

  // Círculo
  const circle = L.circle([lat, lng], {
    radius: radioKm * 1000,
    color: "#1d4ed8",
    weight: 3,
    fill: false,
    fillOpacity: 0,
    interactive: false,
  }).addTo(map);

  ajustarZoomCirculo(map, circle);
  map.on("resize", () => ajustarZoomCirculo(map, circle));

  // Dentro del radio
  const dentro = todosConDist.filter((p) => p.distKm <= radioKm);

  // Sort estable: distancia + nombre
  dentro.sort((a, b) => {
    if (a.distKm !== b.distKm) return a.distKm - b.distKm;
    return (a.nombre || "").localeCompare(b.nombre || "");
  });

  let resumenAprob = 0,
    resumenCalif = 0,
    resumenRech = 0,
    resumenOtros = 0;
  let invAprob = 0,
    invCalif = 0,
    invRech = 0,
    invOtros = 0;

  dentro.forEach((p, index) => {
    const estadoL = (p.estado || "").toLowerCase();
    const key = `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`;

    p.id = index + 1;

    let color = "#6b7280";
    let bucket = "Otros";

    if (modo === "proximidad" && topNSet.has(key)) {
      color = "#16a34a";
      bucket = "Aprob";
    } else if (estadoL.includes("rech")) {
      color = "#dc2626";
      bucket = "Rech";
    } else if (estadoL.includes("calif") || estadoL.includes("eval")) {
      color = "#ea580c";
      bucket = "Calif";
    } else if (estadoL.includes("aprob")) {
      color = "#16a34a";
      bucket = "Aprob";
    }

    p.bucket = bucket;

    if (bucket === "Aprob") resumenAprob++;
    else if (bucket === "Calif") resumenCalif++;
    else if (bucket === "Rech") resumenRech++;
    else resumenOtros++;

    if (Number.isFinite(p.inversion)) {
      if (bucket === "Aprob") invAprob += p.inversion;
      else if (bucket === "Calif") invCalif += p.inversion;
      else if (bucket === "Rech") invRech += p.inversion;
      else invOtros += p.inversion;
    }

    const m = L.circleMarker([p.lat, p.lon], {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.8,
    });

    // Tooltip ID (anti-eventos)
    m.bindTooltip(`#${p.id}`, {
      permanent: true,
      direction: "top",
      className: "project-id-label",
      offset: [0, -10],
      interactive: false,
      opacity: 1,
      bubblingMouseEvents: false,
    });

    // Popup tipo tabla (incluye 2 links)
    m.bindPopup(getPopupTableHTML(p), { maxWidth: 420 });

    m.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (clickTimeout) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => highlightProject(p.id), 50);
    });

    m.on("popupclose", () => {
      if (!isHighlighting) clearHighlight();
    });

    m.addTo(markersLayer);
    markersMap.set(p.id, m);
  });

  proyectosDentroDelRadio = dentro;
  renderProjectsList(dentro);

  // Cinta superior
  if (radioLabel) radioLabel.textContent = `Radio: ${radioKm.toFixed(1)} km`;
  if (countLabel) {
    countLabel.textContent =
      `Resumen – Aprob: ${resumenAprob} | Calif: ${resumenCalif} | ` +
      `Rech: ${resumenRech} | Otros: ${resumenOtros}`;
  }
  if (invLabel) {
    invLabel.textContent =
      `Inversión – Aprob: ${formatMMU(invAprob)} | ` +
      `Calif: ${formatMMU(invCalif)} | ` +
      `Rech: ${formatMMU(invRech)} | ` +
      `Otros: ${formatMMU(invOtros)}`;
  }

  exportResumen = {
    resumenAprob,
    resumenCalif,
    resumenRech,
    resumenOtros,
    invAprob,
    invCalif,
    invRech,
    invOtros,
  };

  // Datos para charts (web)
  const chartData = dentro.map((p) => {
    const tipoRaw = (p.tipo || "").toUpperCase();
    let tipoNorm = "Otros";
    if (tipoRaw.includes("EIA")) tipoNorm = "EIA";
    else if (tipoRaw.includes("DIA")) tipoNorm = "DIA";

    return {
      tipo: tipoNorm,
      estado: p.estado || "Otros",
      sector: p.sector || "Sin sector",
      region: p.region || "Sin región",
      nombre: p.nombre || "Sin nombre",
      inversionMm: p.inversion || 0,
      anio: p.anio && Number.isFinite(p.anio) ? p.anio : null,
      distKm: Number.isFinite(p.distKm) ? p.distKm : 0,
    };
  });

  const chartDataValid = chartData.filter(
    (d) => Number.isFinite(d.inversionMm) && Number.isFinite(d.distKm)
  );
  window.chartDataGlobal = chartDataValid;

  if (typeof window.initCharts === "function") {
    window.initCharts(chartDataValid);
  } else {
    console.warn("initCharts(chartData) no está definido. Revisa js/graficos.js");
  }
});

console.log("✅ mapainfo.js cargado: downloadProximityKMZ() disponible");
