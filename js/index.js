// js/index.js
// =======================================
// Configuración general
// =======================================
const DATA_XLSX_URL = "capas/nacional.xlsx";

let map;
let proyectos = [];         // { lat, lon, sector, region, estado, raw }
let proyectosLayer = null;  // capa para los puntos
let datosCargados = false;

// =======================================
// Helpers
// =======================================
function normalizeHeader(h) {
  return String(h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCoord(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;

  // limpia espacios
  s = s.replace(/\s/g, "");

  // elimina sufijos tipo "S", "N", "E", "O"
  s = s.replace(/[sSneEoO]$/g, "");

  // manejo de coma y punto
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Asumimos "." como separador de miles y "," como decimal
    s = s.replace(/\./g, "");
    s = s.replace(",", ".");
  } else if (hasComma && !hasDot) {
    // solo coma, usamos como decimal
    s = s.replace(",", ".");
  }
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function getSelectedRadioKm() {
  const radios = document.querySelectorAll('input[name="radio"]');
  for (const r of radios) {
    if (r.checked) return Number(r.value);
  }
  return 100; // default
}

function getSelectedSector() {
  const sel = document.getElementById("sectorSelect");
  return sel ? sel.value : "Todos";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =======================================
// Carga del Excel nacional
// =======================================
async function cargarExcelNacional() {
  console.log("Cargando Excel:", DATA_XLSX_URL);
  const bboxInfo = document.getElementById("bboxInfo");
  if (bboxInfo) {
    bboxInfo.textContent = "Cargando proyectos…";
  }

  try {
    const resp = await fetch(DATA_XLSX_URL);
    if (!resp.ok) {
      throw new Error("No se pudo descargar el archivo Excel");
    }

    const arrayBuffer = await resp.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    // Tomamos la primera hoja
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Leemos como matriz [ [header1, header2, ...], [fila1...], ... ]
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null
    });

    if (!rows.length) {
      throw new Error("La hoja está vacía");
    }

    const headerRow = rows[0];
    const dataRows = rows.slice(1);

    const indexToHeader = headerRow.map((h) => String(h || ""));
    const normToHeader = {};
    indexToHeader.forEach((h) => {
      const norm = normalizeHeader(h);
      if (norm) normToHeader[norm] = h;
    });

    // Buscar columnas lat/lon/sector/region/estado
    function findHeader(candidates) {
      for (const c of candidates) {
        if (normToHeader[c]) return normToHeader[c];
      }
      return null;
    }

    const latHeader = findHeader(["lat", "latitud", "latitude"]);
    const lonHeader = findHeader(["lon", "longitud", "longitude", "long"]);
    const sectorHeader = findHeader([
      "sectorproductivo",
      "sector",
      "sectoreconomico"
    ]);
    const regionHeader = findHeader([
      "region",
      "regionproyecto",
      "region_evaluacion"
    ]);
    const estadoHeader = findHeader([
      "estado",
      "estadoproyecto",
      "estado_proyecto",
      "estadoevaluacion",
      "etapa",
      "etapaproyecto"
    ]);

    console.log("Cabeceras detectadas:", {
      latHeader,
      lonHeader,
      sectorHeader,
      regionHeader,
      estadoHeader
    });

    if (!latHeader || !lonHeader) {
      throw new Error(
        "No se encontraron columnas de LAT/LON en el Excel (revisa nombres)."
      );
    }

    const latIndex = indexToHeader.indexOf(latHeader);
    const lonIndex = indexToHeader.indexOf(lonHeader);
    const sectorIndex =
      sectorHeader !== null ? indexToHeader.indexOf(sectorHeader) : -1;
    const regionIndex =
      regionHeader !== null ? indexToHeader.indexOf(regionHeader) : -1;
    const estadoIndex =
      estadoHeader !== null ? indexToHeader.indexOf(estadoHeader) : -1;

    const tmpProyectos = [];

    for (const row of dataRows) {
      const latVal = row[latIndex];
      const lonVal = row[lonIndex];

      const lat = parseCoord(latVal);
      const lon = parseCoord(lonVal);

      if (lat === null || lon === null) continue;

      let sector = "Otros";
      if (sectorIndex >= 0) {
        const sVal = row[sectorIndex];
        if (sVal !== null && sVal !== undefined && String(sVal).trim() !== "") {
          sector = String(sVal).trim();
        }
      }

      let region = "Sin región";
      if (regionIndex >= 0) {
        const rVal = row[regionIndex];
        if (rVal !== null && rVal !== undefined && String(rVal).trim() !== "") {
          region = String(rVal).trim();
        }
      }

      let estado = "Sin estado";
      if (estadoIndex >= 0) {
        const eVal = row[estadoIndex];
        if (eVal !== null && eVal !== undefined && String(eVal).trim() !== "") {
          estado = String(eVal).trim();
        }
      }

      const raw = {};
      indexToHeader.forEach((h, idx) => {
        raw[h] = row[idx];
      });

      tmpProyectos.push({ lat, lon, sector, region, estado, raw });
    }

    proyectos = tmpProyectos;
    datosCargados = true;
    console.log("Proyectos cargados:", proyectos.length);

    if (bboxInfo) {
      bboxInfo.textContent = `Proyectos en pantalla: — (mueve el mapa para actualizar)`;
    }

    // Dibujamos los puntos
    dibujarProyectos();
    // Actualizamos el conteo inicial
    actualizarConteoBbox();
  } catch (err) {
    console.error(err);
    const bboxInfo = document.getElementById("bboxInfo");
    if (bboxInfo) {
      bboxInfo.textContent =
        "Error cargando proyectos. Revisa la consola (F12 → Console).";
    }
    const summaryContainer = document.getElementById("summaryTableContainer");
    if (summaryContainer) {
      summaryContainer.innerHTML =
        "<p>Error al cargar los proyectos. No se pudo generar el resumen.</p>";
    }
  }
}

// =======================================
// Mapa y puntos
// =======================================
function initMap() {
  map = L.map("map").setView([-27, -70], 5); // Vista general sobre Chile

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 15,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  proyectosLayer = L.layerGroup().addTo(map);

  map.on("moveend", () => {
    if (datosCargados) {
      actualizarConteoBbox();
    }
  });

  map.on("click", onMapClick);
}

function dibujarProyectos() {
  if (!map || !proyectosLayer) return;
  proyectosLayer.clearLayers();

  proyectos.forEach((p) => {
    L.circleMarker([p.lat, p.lon], {
      radius: 3,
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.7
    }).addTo(proyectosLayer);
  });
}

// =======================================
// Conteo de proyectos en el BBOX visible
// + Cuadro Región vs Estado
// =======================================
function actualizarConteoBbox() {
  if (!map || !datosCargados) return;

  const bounds = map.getBounds();
  const sectorFiltro = getSelectedSector();

  let count = 0;
  const summaryByRegion = {}; // { region: { estado: count } }
  const estadosSet = new Set();

  for (const p of proyectos) {
    // filtro por sector
    if (sectorFiltro !== "Todos" && String(p.sector) !== sectorFiltro) {
      continue;
    }

    if (!bounds.contains([p.lat, p.lon])) {
      continue;
    }

    count++;

    const region = p.region || "Sin región";
    const estado = p.estado || "Sin estado";

    if (!summaryByRegion[region]) {
      summaryByRegion[region] = {};
    }
    summaryByRegion[region][estado] =
      (summaryByRegion[region][estado] || 0) + 1;

    estadosSet.add(estado);
  }

  const bboxInfo = document.getElementById("bboxInfo");
  if (bboxInfo) {
    const sectorText =
      sectorFiltro === "Todos" ? "todos los sectores" : `sector: ${sectorFiltro}`;
    bboxInfo.textContent = `Proyectos en pantalla: ${count} (${sectorText})`;
  }

  const estadosList = Array.from(estadosSet).sort();
  renderSummaryTable(summaryByRegion, estadosList);

  console.log("Conteo BBOX:", { count, sectorFiltro, summaryByRegion });
}

function renderSummaryTable(summaryByRegion, estadosList) {
  const container = document.getElementById("summaryTableContainer");
  if (!container) return;

  const regiones = Object.keys(summaryByRegion).sort();
  if (regiones.length === 0) {
    container.innerHTML =
      "<p>No hay proyectos en el área visible para el filtro seleccionado.</p>";
    return;
  }

  let html = '<table class="summary-table">';
  html += "<thead><tr>";
  html += "<th>Región / Estado</th>";

  estadosList.forEach((estado) => {
    html += `<th>${escapeHtml(estado)}</th>`;
  });

  html += "</tr></thead><tbody>";

  regiones.forEach((region) => {
    html += `<tr><th>${escapeHtml(region)}</th>`;
    estadosList.forEach((estado) => {
      const val = summaryByRegion[region][estado] || 0;
      html += `<td>${val > 0 ? val : ""}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

// =======================================
// Click en el mapa → solo debug (NO abre info.html)
// =======================================
let lastClickMarker = null;

function onMapClick(e) {
  const { lat, lng } = e.latlng;

  if (lastClickMarker) {
    lastClickMarker.remove();
  }
  lastClickMarker = L.marker([lat, lng]).addTo(map);

  const coordsDisplay = document.getElementById("coordsDisplay");
  if (coordsDisplay) {
    coordsDisplay.textContent = `Coordenadas clic: ${lat.toFixed(
      5
    )}, ${lng.toFixed(5)}`;
  }

  const radioKm = getSelectedRadioKm();
  const sector = getSelectedSector();
  const b = map.getBounds();

  // Construimos igualmente la URL, pero NO la abrimos (modo debug)
  const url = new URL("info.html", window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lng.toFixed(6));
  url.searchParams.set("radio_km", String(radioKm));
  url.searchParams.set("sector", sector);
  url.searchParams.set("bbox_min_lat", b.getSouth().toFixed(6));
  url.searchParams.set("bbox_min_lon", b.getWest().toFixed(6));
  url.searchParams.set("bbox_max_lat", b.getNorth().toFixed(6));
  url.searchParams.set("bbox_max_lon", b.getEast().toFixed(6));

  console.log("Click debug:", {
    lat,
    lng,
    radioKm,
    sector,
    bbox: {
      min_lat: b.getSouth(),
      min_lon: b.getWest(),
      max_lat: b.getNorth(),
      max_lon: b.getEast()
    },
    urlInfo: url.toString()
  });

  // ⚠️ Modo debug: NO abrimos info.html
  // window.open(url.toString(), "_blank");
}

// =======================================
// Listeners UI
// =======================================
function initUI() {
  const sectorSelect = document.getElementById("sectorSelect");
  if (sectorSelect) {
    sectorSelect.addEventListener("change", () => {
      if (datosCargados) {
        actualizarConteoBbox();
      }
    });
  }

  const radios = document.querySelectorAll('input[name="radio"]');
  radios.forEach((r) => {
    r.addEventListener("change", () => {
      console.log("Radio de análisis (km):", getSelectedRadioKm());
    });
  });
}

// =======================================
// Init
// =======================================
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initUI();
  cargarExcelNacional();
});
