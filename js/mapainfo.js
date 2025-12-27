// ===========================
// GeoEVA - mapainfo.js (COMPLETO)
// Sistema de análisis de proximidad con:
// - Mapa Leaflet + círculo + puntos enumerados
// - Panel lateral sincronizado (lista ↔ mapa)
// - Dashboard Plotly (initCharts desde graficos.js)
// - Exportación KML (punto consulta + círculo + proyectos)
//   * Proyectos con íconos/colores heredados de GeoEVA (Aprob/Calif/Rech/Otros)
//   * Cada punto KML incluye cuadro HTML (tipo GeoIPT) con 2 links (Expediente + Anexos)
// ===========================

const DATA_XLSX_URL = "capas/nacional.xlsx";
let globalParams = null;

// Variables globales para el panel y sincronización
let proyectosDentroDelRadio = [];
let markersMap = new Map(); // Map: projectId -> marker
let currentHighlightedId = null;
let isLoadingData = false;
let map = null;
let clickTimeout = null;
let isHighlighting = false;

// ------------------------------------------------------------
// Helpers numéricos / formato
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Carga Excel (con guard contra race conditions)
// ------------------------------------------------------------
async function loadExcelData() {
  if (isLoadingData) {
    console.warn("⚠️ Carga de datos ya en progreso, esperando...");
    return null;
  }
  isLoadingData = true;

  try {
    const resp = await fetch(DATA_XLSX_URL);
    const buf = await resp.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!json.length) return [];

    const rows = json.slice(1);

    // columnas (según tu nacional.xlsx)
    const COL_NOMBRE = 0;
    const COL_WEB    = 1;
    const COL_TIPO   = 2;
    const COL_REGION = 3;
    const COL_INV    = 9;
    const COL_FECHA  = 10;
    const COL_ESTADO = 11;
    const COL_SECTOR = 13;
    const COL_LAT    = 14;
    const COL_LON    = 15;
    const COL_ANEXOS = 16;
    const COL_ANIO   = 17;

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
        nombre: row[COL_NOMBRE] || "",
        web: row[COL_WEB] || "",
        tipo: row[COL_TIPO] || "",
        region: row[COL_REGION] || "",
        inversion: invNum,
        fechaIngreso: row[COL_FECHA] || null,
        estado: row[COL_ESTADO] || "",
        sector: row[COL_SECTOR] || "",
        anexos: row[COL_ANEXOS] || "",
        anio: anioNum,
      });
    }

    return data;
  } finally {
    isLoadingData = false;
  }
}

// ------------------------------------------------------------
// Ajuste zoom al círculo
// ------------------------------------------------------------
function ajustarZoomCirculo(mapRef, circle) {
  const size = mapRef.getSize();
  const minSide = Math.min(size.x, size.y);
  const paddingPx = minSide * 0.20;

  mapRef.fitBounds(circle.getBounds(), {
    padding: [paddingPx, paddingPx],
  });
}

// ------------------------------------------------------------
// Panel lateral (lista)
// ------------------------------------------------------------
function togglePanel() {
  const panel = document.getElementById("projectsPanel");
  panel.classList.toggle("collapsed");
}

function renderProjectsList(proyectos) {
  if (proyectos.length > 500) {
    console.warn(`⚠️ ${proyectos.length} proyectos en el panel. El rendimiento puede degradarse.`);
  }

  const panelContent = document.getElementById("panelContent");
  const panelCount = document.getElementById("panelCount");

  panelContent.innerHTML = "";
  panelCount.textContent = proyectos.length;

  proyectos.forEach((proyecto) => {
    const item = document.createElement("div");
    item.className = "project-item";
    item.dataset.projectId = proyecto.id;

    // color estado (dot)
    let dotColor = "#6b7280"; // Otros
    if (proyecto.bucket === "Aprob") dotColor = "#16a34a";
    else if (proyecto.bucket === "Calif") dotColor = "#ea580c";
    else if (proyecto.bucket === "Rech") dotColor = "#dc2626";

    const nombreDisplay =
      (proyecto.nombre || "").length > 60
        ? proyecto.nombre.substring(0, 57) + "..."
        : (proyecto.nombre || "");

    item.innerHTML = `
      <div class="project-id">#${proyecto.id}</div>
      <div class="project-name" title="${(proyecto.nombre || "").replace(/"/g, "&quot;")}">${nombreDisplay}</div>
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

function highlightProject(projectId) {
  if (isHighlighting) return;
  if (currentHighlightedId === projectId) return;

  isHighlighting = true;
  try {
    clearHighlight();

    // resaltar en lista
    const listItem = document.querySelector(`[data-project-id="${projectId}"]`);
    if (listItem) {
      listItem.classList.add("highlighted");
      listItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // resaltar marker
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

// ------------------------------------------------------------
// ✅ EXPORTACIÓN KML (GeoEVA style)
// ------------------------------------------------------------

// Tabla HTML (tipo GeoIPT) en description
function getPopupTableHTML(p) {
  const latDisplay = Number.isFinite(p.lat) ? p.lat.toFixed(6) : "—";
  const lonDisplay = Number.isFinite(p.lon) ? p.lon.toFixed(6) : "—";
  const distDisplay = Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—";

  return `
    <table border="1" cellpadding="4" cellspacing="0"
           style="border-collapse:collapse; font-family:Arial; font-size:13px;">
      <tr><th align="left">Proyecto</th><td>#${p.id} - ${p.nombre || "—"}</td></tr>
      <tr><th align="left">Tipo</th><td>${p.tipo || "—"}</td></tr>
      <tr><th align="left">Sector</th><td>${p.sector || "—"}</td></tr>
      <tr><th align="left">Estado</th><td>${p.estado || "—"}</td></tr>
      <tr><th align="left">Año</th><td>${p.anio || "—"}</td></tr>
      <tr><th align="left">Inversión</th><td>${formatMMU(p.inversion)}</td></tr>
      <tr><th align="left">Latitud</th><td>${latDisplay}</td></tr>
      <tr><th align="left">Longitud</th><td>${lonDisplay}</td></tr>
      <tr><th align="left">Distancia (km)</th><td>${distDisplay}</td></tr>
      <tr><th align="left">Expediente</th>
        <td>${p.web ? `<a href="${p.web}" target="_blank">Abrir expediente</a>` : "—"}</td>
      </tr>
      <tr><th align="left">Anexos</th>
        <td>${p.anexos ? `<a href="${p.anexos}" target="_blank">Abrir anexos</a>` : "—"}</td>
      </tr>
    </table>
  `;
}

function safeCdata(html) {
  return String(html ?? "").replaceAll("]]>", "]]&gt;");
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// KML color aabbggrr desde alphaHex + rgbHex
function kmlColor(alphaHex, rgbHex) {
  const rr = rgbHex.slice(0, 2);
  const gg = rgbHex.slice(2, 4);
  const bb = rgbHex.slice(4, 6);
  return `${alphaHex}${bb}${gg}${rr}`; // aabbggrr
}

// Polígono que aproxima círculo (compatibilidad)
function kmlCirclePolygon(lat, lon, radiusKm, steps = 96) {
  const R = 6371; // km
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const lat1 = lat * rad;
  const lon1 = lon * rad;
  const d = radiusKm / R;

  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
    );

    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    coords.push(`${(lon2 * deg)},${(lat2 * deg)},0`);
  }
  return coords.join(" ");
}

// Determina estilo por estado (heredado de GeoEVA)
function getGeoEVAStyleKey(p) {
  const b = (p.bucket || "").toLowerCase();
  if (b === "aprob") return "APROB";
  if (b === "calif") return "CALIF";
  if (b === "rech") return "RECH";
  if (b) return "OTROS";

  const e = (p.estado || "").toLowerCase();
  if (e.includes("aprob")) return "APROB";
  if (e.includes("calif") || e.includes("eval")) return "CALIF";
  if (e.includes("rech")) return "RECH";
  return "OTROS";
}

// ✅ FUNCIÓN GLOBAL DE DESCARGA KML (llamar desde botón)
window.downloadProximityKML = function () {
  console.log("🔵 downloadProximityKML() llamada");

  const lista = window.proyectosDentroDelRadio || proyectosDentroDelRadio;
  if (!Array.isArray(lista)) {
    alert("❌ Error: Los proyectos aún no están disponibles. Espera que cargue la página.");
    console.error("Lista inválida:", lista);
    return;
  }
  if (lista.length === 0) {
    alert("No hay proyectos dentro del radio para exportar.");
    return;
  }

  const qp = window.queryPoint || null;         // {lat, lon}
  const rKm = window.queryRadiusKm || null;     // number

  const proyectosValidos = lista.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (proyectosValidos.length === 0) {
    alert("❌ Error: Ningún proyecto tiene coordenadas válidas para exportar.");
    return;
  }

  // --- KML styles (GeoEVA palette) ---
  // Colores base (RGB hex)
  const RGB_APROB = "16a34a"; // verde
  const RGB_CALIF = "ea580c"; // naranjo
  const RGB_RECH  = "dc2626"; // rojo
  const RGB_OTROS = "6b7280"; // gris
  const RGB_AZUL  = "1d4ed8"; // azul GeoEVA

  // KML colors aabbggrr
  const KML_LINE_AZUL = kmlColor("ff", RGB_AZUL);
  const KML_FILL_AZUL = kmlColor("22", RGB_AZUL); // semitransparente

  // Íconos KML (google)
  // Puedes cambiar a otros si quieres.
  const ICON_APROB = "http://maps.google.com/mapfiles/kml/paddle/grn-circle.png";
  const ICON_CALIF = "http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png";
  const ICON_RECH  = "http://maps.google.com/mapfiles/kml/paddle/red-circle.png";
  const ICON_OTROS = "http://maps.google.com/mapfiles/kml/paddle/wht-circle.png";
  const ICON_QUERY = "http://maps.google.com/mapfiles/kml/paddle/blu-circle.png";

  const stylesKml = `
  <Style id="st_query">
    <IconStyle>
      <scale>1.3</scale>
      <Icon><href>${ICON_QUERY}</href></Icon>
    </IconStyle>
  </Style>

  <Style id="st_aprob">
    <IconStyle>
      <scale>1.05</scale>
      <Icon><href>${ICON_APROB}</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle>
  </Style>

  <Style id="st_calif">
    <IconStyle>
      <scale>1.05</scale>
      <Icon><href>${ICON_CALIF}</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle>
  </Style>

  <Style id="st_rech">
    <IconStyle>
      <scale>1.05</scale>
      <Icon><href>${ICON_RECH}</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle>
  </Style>

  <Style id="st_otros">
    <IconStyle>
      <scale>1.00</scale>
      <Icon><href>${ICON_OTROS}</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle>
  </Style>

  <Style id="st_circle">
    <LineStyle>
      <color>${KML_LINE_AZUL}</color>
      <width>3</width>
    </LineStyle>
    <PolyStyle>
      <color>${KML_FILL_AZUL}</color>
    </PolyStyle>
  </Style>
  `;

  // --- Punto de consulta ---
  const placemarkConsulta =
    (qp && Number.isFinite(qp.lat) && Number.isFinite(qp.lon))
      ? `
  <Placemark>
    <name>Punto de consulta</name>
    <styleUrl>#st_query</styleUrl>
    <description><![CDATA[
      <b>GeoEVA – Punto consultado</b><br/>
      Lat: ${qp.lat.toFixed(6)}<br/>
      Lon: ${qp.lon.toFixed(6)}
    ]]></description>
    <Point><coordinates>${qp.lon},${qp.lat},0</coordinates></Point>
  </Placemark>`
      : "";

  // --- Círculo (polígono) ---
  const placemarkCirculo =
    (qp && Number.isFinite(qp.lat) && Number.isFinite(qp.lon) && Number.isFinite(rKm) && rKm > 0)
      ? `
  <Placemark>
    <name>Área de consulta (radio ${rKm.toFixed(2)} km)</name>
    <styleUrl>#st_circle</styleUrl>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            ${kmlCirclePolygon(qp.lat, qp.lon, rKm, 96)}
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>`
      : "";

  // --- Proyectos (con estilo heredado) ---
  const placemarksProyectos = proyectosValidos.map((p) => {
    const key = getGeoEVAStyleKey(p);
    let styleUrl = "#st_otros";
    if (key === "APROB") styleUrl = "#st_aprob";
    else if (key === "CALIF") styleUrl = "#st_calif";
    else if (key === "RECH") styleUrl = "#st_rech";

    return `
  <Placemark>
    <name>#${p.id} - ${p.nombre || "Proyecto"}</name>
    <styleUrl>${styleUrl}</styleUrl>
    <description><![CDATA[${safeCdata(getPopupTableHTML(p))}]]></description>
    <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
  </Placemark>`;
  }).join("");

  // --- Documento KML final ---
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>GeoEVA – Proximidad</name>
  <description><![CDATA[
    Exportación GeoEVA<br/>
    Proyectos: ${proyectosValidos.length}<br/>
    Incluye: punto de consulta + círculo + proyectos
  ]]></description>

  ${stylesKml}

  <Folder>
    <name>Punto y radio</name>
    ${placemarkConsulta}
    ${placemarkCirculo}
  </Folder>

  <Folder>
    <name>Proyectos</name>
    ${placemarksProyectos}
  </Folder>

</Document>
</kml>`;

  downloadTextFile(
    kml,
    "geoeva_proximidad_con_radio_estilos.kml",
    "application/vnd.google-earth.kml+xml"
  );

  console.log("✅ KML descargado (con estilos e íconos GeoEVA)");
};

console.log("✅ mapainfo.js cargado | downloadProximityKML:", typeof window.downloadProximityKML);

// ------------------------------------------------------------
// ✅ INICIALIZACIÓN PRINCIPAL
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 DOMContentLoaded...");

  // reset estado
  proyectosDentroDelRadio = [];
  window.proyectosDentroDelRadio = []; // blindado
  markersMap.clear();
  currentHighlightedId = null;

  const params = new URLSearchParams(window.location.search);
  globalParams = params;

  const lat = parseFloat(params.get("lat"));
  const lng = parseFloat(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert("❌ Error: Coordenadas inválidas en la URL. Revisa 'lat' y 'lng'.");
    console.error("Parámetros inválidos:", { lat, lng });
    return;
  }

  const modo = params.get("modo") || "radio";
  const radioParam = parseFloat(params.get("radio")) || 10;
  const nParam = parseInt(params.get("n") || "10", 10);

  const sectoresParam = params.get("sectores") || "";
  const sectoresFiltro = sectoresParam ? sectoresParam.split("|").filter(Boolean) : [];

  // labels
  const coordsLabel = document.getElementById("coordsLabel");
  const modoLabel   = document.getElementById("modoLabel");
  const radioLabel  = document.getElementById("radioLabel");
  const countLabel  = document.getElementById("countLabel");
  const invLabel    = document.getElementById("invLabel");

  coordsLabel.textContent = `Punto: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  modoLabel.textContent =
    modo === "proximidad"
      ? `Modo: Proximidad (N=${nParam} aprobados)`
      : `Modo: Radio (R=${radioParam} km)`;

  // toggle panel
  const panelToggle = document.getElementById("panelToggle");
  if (panelToggle) panelToggle.addEventListener("click", togglePanel);

  // mapa
  map = L.map("map", {
    center: [lat, lng],
    zoom: 10,
    minZoom: 4,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    opacity: 1.0,
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.10, maxZoom: 19 }
  ).addTo(map);

  L.control.scale().addTo(map);

  // punto azul consulta
  L.circleMarker([lat, lng], {
    radius: 6,
    color: "#1d4ed8",
    weight: 2,
    fillColor: "#1d4ed8",
    fillOpacity: 1,
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  // leyenda
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

  // cargar excel
  let proyectos;
  try {
    proyectos = await loadExcelData();
    if (!proyectos || proyectos.length === 0) throw new Error("No se pudieron cargar proyectos del Excel");
  } catch (err) {
    console.error("Error cargando nacional.xlsx:", err);
    radioLabel.textContent = "Radio: —";
    countLabel.textContent = "Error al cargar datos de proyectos.";
    invLabel.textContent = "Inversión: —";
    return;
  }

  // filtro por sectores (si viene)
  if (sectoresFiltro.length) {
    proyectos = proyectos.filter((p) => {
      const sectorLower = (p.sector || "").toLowerCase();
      return sectoresFiltro.some((s) => sectorLower === s.trim().toLowerCase());
    });
  }

  // distancias
  const todosConDist = proyectos.map((p) => ({
    ...p,
    distKm: distanceKm(lat, lng, p.lat, p.lon),
  }));

  // modo proximidad
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
      topNSet = new Set(aprobTopN.map((p) => `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`));
    } else {
      radioKm = radioParam;
    }
  }

  // ✅ Guardar punto/radio para KML (IMPORTANTE)
  window.queryPoint = { lat, lon: lng };
  window.queryRadiusKm = radioKm;

  // círculo Leaflet
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

  // dentro del radio
  const dentro = todosConDist.filter((p) => p.distKm <= radioKm);

  // sort estable
  dentro.sort((a, b) => {
    if (a.distKm !== b.distKm) return a.distKm - b.distKm;
    return (a.nombre || "").localeCompare(b.nombre || "");
  });

  // resumen
  let resumenAprob = 0, resumenCalif = 0, resumenRech = 0, resumenOtros = 0;
  let invAprob = 0, invCalif = 0, invRech = 0, invOtros = 0;

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

    // tooltip ID (anti eventos)
    m.bindTooltip(`#${p.id}`, {
      permanent: true,
      direction: "top",
      className: "project-id-label",
      offset: [0, -10],
      interactive: false,
      opacity: 1,
      bubblingMouseEvents: false,
    });

    // popup
    m.bindPopup(`
      <strong>#${p.id} - ${p.nombre || "Proyecto sin nombre"}</strong><br/>
      <b>Tipo:</b> ${p.tipo || "—"}<br/>
      <b>Sector:</b> ${p.sector || "—"}<br/>
      <b>Inversión:</b> ${formatMMU(p.inversion)}<br/>
      <b>Estado:</b> ${p.estado || "—"}<br/>
      <b>Distancia:</b> ${Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—"} km<br/><br/>
      <b>Expediente:</b> ${
        p.web ? `<a href="${p.web}" target="_blank">Abrir expediente</a>` : "—"
      }<br/>
      <b>Anexos:</b> ${
        p.anexos ? `<a href="${p.anexos}" target="_blank">Abrir anexos</a>` : "—"
      }
    `);

    // click marker → resaltar lista
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

  // guardar global (blindado)
  proyectosDentroDelRadio = dentro;
  window.proyectosDentroDelRadio = dentro;

  // lista
  renderProjectsList(dentro);

  // cinta
  radioLabel.textContent = `Radio: ${radioKm.toFixed(1)} km`;
  countLabel.textContent =
    `Resumen – Aprob: ${resumenAprob} | Calif: ${resumenCalif} | ` +
    `Rech: ${resumenRech} | Otros: ${resumenOtros}`;
  invLabel.textContent =
    `Inversión – Aprob: ${formatMMU(invAprob)} | ` +
    `Calif: ${formatMMU(invCalif)} | ` +
    `Rech: ${formatMMU(invRech)} | ` +
    `Otros: ${formatMMU(invOtros)}`;

  // datos para gráficos
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
      anio: (p.anio && Number.isFinite(p.anio)) ? p.anio : null,
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

  console.log("✅ DOMContentLoaded completado.");
});
