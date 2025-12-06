// ===============================
// Configuración de datos
// ===============================
const DATA_XLSX_URL = "capas/nacional.xlsx"; 
// 👉 Si en tu repo el archivo se llama distinto (por ej. nacional_corregido.xlsx),
// cambia SOLO esta línea.

// Aquí guardaremos todos los proyectos con lat/lon
let proyectos = [];
let datosCargados = false;

// ===============================
// Helpers para lectura del Excel
// ===============================
function normalizeHeader(h) {
  return String(h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseCoord(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;

  // limpia espacios y formatos raros
  s = s.replace(/\s/g, "");

  // manejo de coma y punto
  if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) {
    // ejemplo: "-23.456,78" → "-23456.78" (no suele pasar aquí, pero por si acaso)
    s = s.replace(".", "").replace(",", ".");
  } else {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return isNaN(n) ? null : n;
}

// ===============================
// Inicializar mapa
// ===============================
const map = L.map("map", {
  zoomControl: true,
}).setView([-27.5, -70.5], 5);

// Capa base
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const coordsDisplay = document.getElementById("coordsDisplay");
const sectorSelect = document.getElementById("sectorSelect");
const bboxInfo = document.getElementById("bboxInfo");

function getRadioKm() {
  const radios = document.querySelectorAll('input[name="radio"]');
  for (const r of radios) {
    if (r.checked) return parseInt(r.value, 10);
  }
  return 100;
}

function actualizarCoords(lat, lng) {
  coordsDisplay.textContent =
    "Coordenadas clic: lat " +
    lat.toFixed(6) +
    ", lng " +
    lng.toFixed(6) +
    ". Zoom: " +
    map.getZoom();
}

// ===============================
// Carga del Excel nacional
// ===============================
async function cargarProyectosNacionales() {
  try {
    if (bboxInfo) {
      bboxInfo.textContent = "Proyectos en pantalla: cargando…";
    }

    const resp = await fetch(DATA_XLSX_URL);
    if (!resp.ok) {
      console.error("No se pudo leer el Excel nacional:", DATA_XLSX_URL, resp.status, resp.statusText);
      if (bboxInfo) {
        bboxInfo.textContent = "Proyectos en pantalla: error al leer Excel";
      }
      return;
    }

    const arrayBuffer = await resp.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: "array" });

    // hoja "Proyectos" si existe, si no la primera
    let sheetName = workbook.SheetNames[0];
    const hojaProyectos = workbook.SheetNames.find(
      (n) => n.toLowerCase() === "proyectos"
    );
    if (hojaProyectos) sheetName = hojaProyectos;

    console.log("index.js → usando hoja:", sheetName);

    const sheet = workbook.Sheets[sheetName];
    const arr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (!arr.length) {
      console.warn("index.js → la hoja está vacía.");
      if (bboxInfo) {
        bboxInfo.textContent = "Proyectos en pantalla: 0 (hoja vacía)";
      }
      return;
    }

    const headers = arr[0];
    const filas = arr.slice(1);

    console.log("index.js → headers:", headers);

    let idxLat = -1;
    let idxLon = -1;

    headers.forEach((h, i) => {
      const n = normalizeHeader(h);
      // muy flexible: lat / latitud / punto lat / latitud punto representativo
      if (/(lat|latitud)/.test(n) && idxLat === -1) idxLat = i;
      // lon / lng / longitud / punto lon / longitud punto representativo
      if (/(lon|lng|longitud)/.test(n) && idxLon === -1) idxLon = i;
    });

    console.log("index.js → idxLat, idxLon:", idxLat, idxLon);

    if (idxLat === -1 || idxLon === -1) {
      console.warn("No se detectaron columnas de lat/lon en el Excel nacional.");
      if (bboxInfo) {
        bboxInfo.textContent = "Proyectos en pantalla: error en columnas lat/lon";
      }
      return;
    }

    proyectos = filas
      .map((row, filaIdx) => {
        const lat = parseCoord(row[idxLat]);
        const lon = parseCoord(row[idxLon]);
        if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
          return null;
        }
        return { lat, lon };
      })
      .filter((p) => p !== null);

    datosCargados = true;

    console.log("index.js → total proyectos cargados en index:", proyectos.length);

    if (!proyectos.length && bboxInfo) {
      bboxInfo.textContent = "Proyectos en pantalla: 0 (sin coordenadas válidas)";
      return;
    }

    // una vez cargados, actualizamos el conteo para el BBOX actual
    actualizarConteoBbox();
  } catch (err) {
    console.error("Error cargando proyectos nacionales en index:", err);
    if (bboxInfo) {
      bboxInfo.textContent = "Proyectos en pantalla: error inesperado";
    }
  }
}

// ===============================
// Conteo de proyectos en el BBOX visible
// ===============================
function actualizarConteoBbox() {
  if (!datosCargados || !proyectos.length || !bboxInfo) return;

  const bounds = map.getBounds();
  let count = 0;

  for (const p of proyectos) {
    if (bounds.contains([p.lat, p.lon])) {
      count++;
    }
  }

  bboxInfo.textContent =
    "Proyectos en pantalla: " + count.toLocaleString("es-CL");
}

// Actualizar al terminar movimiento / cambio de zoom
map.on("moveend", actualizarConteoBbox);
map.on("zoomend", actualizarConteoBbox);

// ===============================
// Evento de clic en el mapa
// ===============================
map.on("click", (e) => {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  const zoom = map.getZoom();

  actualizarCoords(lat, lng);

  const sector = encodeURIComponent(sectorSelect.value || "Todos");
  const radioKm = getRadioKm();

  const url =
    "info.html" +
    "?lat=" +
    lat.toFixed(6) +
    "&lng=" +
    lng.toFixed(6) +
    "&z=" +
    zoom +
    "&radio_km=" +
    radioKm +
    "&sector=" +
    sector;

  window.location.href = url;
});

// ===============================
// Inicio: cargar datos
// ===============================
cargarProyectosNacionales();
