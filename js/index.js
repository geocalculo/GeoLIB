/************************************************************
 * SEA Mining - index.js
 *  - Carga /capas/nacional.xlsx con proyectos
 *  - Dibuja puntos en Leaflet
 *  - Cuenta proyectos dentro del BBOX actual (total y filtrados)
 *  - Sectores dinámicos según BBOX + opción "Todos"
 *  - Modo de selección:
 *      • Por Radio (slider R 5–20 km)
 *      • Por Proximidad (slider N 5–20 aprobados)
 *  - Click → abre mapainfo.html con lat, lng, modo, R, N y sectores
 *  - Panel lateral plegable (desktop abierto / móvil cerrado)
 ************************************************************/

const DATA_XLSX_URL = "capas/nacional.xlsx";

let proyectos = [];
let map;
let markersLayer;

// ===============================
// Helpers generales
// ===============================

function normalizeHeader(h) {
  return String(h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ===============================
// Lectura de controles
// ===============================

function getSelectedSectors() {
  const todosCb = document.getElementById("sectorTodos");
  const todosOn = todosCb ? todosCb.checked : true;
  if (todosOn) return []; // sin filtro

  const cbs = document.querySelectorAll(
    '#sectorDynamic input[name="sector"]:checked'
  );
  return Array.from(cbs).map((cb) => cb.value);
}

function getModoSeleccion() {
  const rb = document.querySelector('input[name="modoSeleccion"]:checked');
  return rb ? rb.value : "radio"; // "radio" o "proximidad"
}

function getRadioAnalisisKm() {
  const slider = document.getElementById("radioSlider");
  if (!slider) return 10;
  const val = parseInt(slider.value, 10);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

function getNProximos() {
  const slider = document.getElementById("nSlider");
  if (!slider) return 10;
  const val = parseInt(slider.value, 10);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

// ===============================
// Carga del Excel (por letras de columna)
// ===============================

async function loadExcelData() {
  const resp = await fetch(DATA_XLSX_URL);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!json.length) return [];

  // Fila 0 = encabezados, la saltamos
  const rows = json.slice(1);

  // Índices FIJOS por letra de columna (según tu planilla nacional.xlsx)
  const COL_NOMBRE = 0;   // A - Nombre del Proyecto
  const COL_REGION = 3;   // D - Región
  const COL_ESTADO = 11;  // L - Estado del Proyecto
  const COL_SECTOR = 13;  // N - Sector Productivo
  const COL_LAT = 14;     // O - Latitud Punto Representativo
  const COL_LON = 15;     // P - Longitud Punto Representativo

  const data = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    const lat = parseCoord(row[COL_LAT]);
    const lon = parseCoord(row[COL_LON]);
    if (lat === null || lon === null) continue;

    data.push({
      lat,
      lon,
      nombre: row[COL_NOMBRE] || "",
      region: row[COL_REGION] || "",
      estado: row[COL_ESTADO] || "",
      sector: row[COL_SECTOR] || ""
    });
  }

  return data;
}

// ===============================
// Inicialización de mapa
// ===============================

function initMaps() {
  map = L.map("map", {
    center: [-33.45, -70.65],
    zoom: 10,
    minZoom: 4,
  });

  // 🌎 Capa base OSM (abajo, sin transparencia)
  const capaOSM = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      opacity: 1.0,
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }
  ).addTo(map);

  // 🛰️ Capa Satelital ESRI (arriba, 80% transparente)
  const capaSatelite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.20,
      maxZoom: 19,
    }
  ).addTo(map);

  L.control.scale().addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on("moveend", () => {
    actualizarResumenYCapas();
  });

  map.on("click", onMapClick);
}

// ===============================
// Sectores dinámicos
// ===============================

function updateSectorCheckboxes(sectorSet) {
  const dynamic = document.getElementById("sectorDynamic");
  if (!dynamic) return;

  const todosCb = document.getElementById("sectorTodos");

  // Guardar selección previa de sectores dinámicos
  const prevSelected = new Set(
    Array.from(
      document.querySelectorAll('#sectorDynamic input[name="sector"]:checked')
    ).map((cb) => cb.value)
  );

  dynamic.innerHTML = "";

  const sectores = Array.from(sectorSet)
    .filter((s) => s && s.trim() !== "")
    .sort((a, b) => a.localeCompare(b, "es"));

  if (!sectores.length) {
    dynamic.innerHTML = '<p class="hint">No hay proyectos visibles en el mapa.</p>';
    return;
  }

  sectores.forEach((sec) => {
    const safeId =
      "sector_" +
      sec
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_");

    const checked =
      (todosCb && todosCb.checked) ||
      (prevSelected.size ? prevSelected.has(sec) : true);

    const label = document.createElement("label");
    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" id="${safeId}" name="sector" value="${sec}" ${
      checked ? "checked" : ""
    } />
      <span>${sec}</span>
    `;
    dynamic.appendChild(label);
  });

  // Listeners: si se toca algún sector, se apaga "Todos" y se refresca el mapa
  dynamic
    .querySelectorAll('input[name="sector"]')
    .forEach((cb) =>
      cb.addEventListener("change", () => {
        const anyChecked = dynamic.querySelector(
          'input[name="sector"]:checked'
        );
        if (todosCb && anyChecked) {
          todosCb.checked = false;
        } else if (todosCb && !anyChecked) {
          // si desmarcan todos, volvemos a "Todos"
          todosCb.checked = true;
        }
        actualizarResumenYCapas();
      })
    );
}

// ===============================
// Render de proyectos y resumen
// ===============================

function actualizarResumenYCapas() {
  if (!map || !proyectos.length) return;

  const bboxInfo = document.getElementById("bboxInfo"); // 👀 puede no existir
  const bounds = map.getBounds();

  const selectedSectors = getSelectedSectors();
  const resumen = {};
  const sectorSetBbox = new Set();

  markersLayer.clearLayers();

  let totalEnPantalla = 0;
  let filtradosEnPantalla = 0;

  for (const p of proyectos) {
    const latlng = [p.lat, p.lon];

    if (!bounds.contains(latlng)) continue;
    totalEnPantalla++;

    const sectorProyectoRaw = (p.sector || "").trim();
    if (sectorProyectoRaw) {
      sectorSetBbox.add(sectorProyectoRaw);
    }

    // Filtro por sector (si hay)
    if (selectedSectors.length > 0) {
      const sectorLower = sectorProyectoRaw.toLowerCase();
      const match = selectedSectors.some(
        (s) => sectorLower === s.trim().toLowerCase()
      );
      if (!match) continue;
    }

    filtradosEnPantalla++;

    const marker = L.circleMarker(latlng, {
      radius: 4,
      opacity: 0.9,
      weight: 1,
      fillOpacity: 0.7,
    });
    marker.bindPopup(
      `<strong>${p.nombre || "Proyecto sin nombre"}</strong><br/>` +
        `Sector: ${p.sector || "—"}<br/>` +
        `Estado: ${p.estado || "—"}<br/>` +
        `Región: ${p.region || "—"}`
    );
    marker.addTo(markersLayer);

    const region = p.region || "Sin región";
    const estadoRaw = (p.estado || "").toLowerCase();

    if (!resumen[region]) {
      resumen[region] = { Aprob: 0, Calif: 0, Rech: 0, Otros: 0 };
    }

    let key = "Otros";
    if (estadoRaw.includes("aprob")) key = "Aprob";
    else if (estadoRaw.includes("calif") || estadoRaw.includes("eval"))
      key = "Calif";
    else if (estadoRaw.includes("rech")) key = "Rech";

    resumen[region][key] += 1;
  }

  // Actualizar checkboxes de sector según el BBOX
  updateSectorCheckboxes(sectorSetBbox);

  let detalleSectores = "sin filtro de sector";
  if (selectedSectors.length) {
    detalleSectores = "filtro: " + selectedSectors.join(", ");
  } else {
    const todosCb = document.getElementById("sectorTodos");
    if (todosCb && todosCb.checked) detalleSectores = "Todos los sectores";
  }

  const texto =
    `Proyectos en pantalla (total BBOX): ${totalEnPantalla} ` +
    `| Dibujados (filtro): ${filtradosEnPantalla} ` +
    `(${detalleSectores})`;

  if (bboxInfo) {
    bboxInfo.textContent = texto;
  } else {
    console.warn("bboxInfo no encontrado en el DOM"); // 👀 ayuda debug
  }

  renderSummaryTable(resumen);
}

function renderSummaryTable(resumen) {
  const container = document.getElementById("summaryTableContainer");
  if (!container) {                           // 👀 protección
    console.warn("summaryTableContainer no encontrado en el DOM");
    return;
  }

  const regiones = Object.keys(resumen);

  if (!regiones.length) {
    container.innerHTML =
      "<p>No hay proyectos visibles para los filtros seleccionados.</p>";
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Región / Estado</th>
          <th>Aprob</th>
          <th>Calif</th>
          <th>Rech</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const region of regiones) {
    const r = resumen[region];
    html += `
      <tr>
        <td>${region}</td>
        <td>${r.Aprob}</td>
        <td>${r.Calif}</td>
        <td>${r.Rech}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  container.innerHTML = html;
}

// ===============================
// Click en el mapa
// ===============================

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  const coordsDisplay = document.getElementById("coordsDisplay"); // 👀 puede no existir
  if (coordsDisplay) {
    coordsDisplay.textContent = `Coordenadas clic: ${lat.toFixed(
      5
    )}, ${lng.toFixed(5)}`;
  }

  const modo = getModoSeleccion(); // "radio" o "proximidad"
  const radioKm = getRadioAnalisisKm();
  const n = getNProximos();
  const sectores = getSelectedSectors(); // [] => sin filtro

  console.log(
    `Clic en: ${lat}, ${lng} | modo=${modo} | R=${radioKm} km | N=${n} | sectores=`,
    sectores
  );

  const url = new URL("mapainfo.html", window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lng", lng.toFixed(6));
  url.searchParams.set("modo", modo);
  url.searchParams.set("radio", radioKm.toString());
  url.searchParams.set("n", n.toString());
  if (sectores.length) {
    url.searchParams.set("sectores", sectores.join("|"));
  }

  window.open(url.toString(), "_blank");
}

// ===============================
// Controles (filtros, sliders, modo)
// ===============================

function updateModeUI() {
  const modo = getModoSeleccion();
  const radioSlider = document.getElementById("radioSlider");
  const nSlider = document.getElementById("nSlider");

  if (modo === "radio") {
    if (radioSlider) radioSlider.disabled = false;
    if (nSlider) nSlider.disabled = true;
  } else {
    if (radioSlider) radioSlider.disabled = true;
    if (nSlider) nSlider.disabled = false;
  }
}

function initControls() {
  // Botones seleccionar todos / limpiar
  const selectAllBtn = document.getElementById("sectorSelectAllBtn");
  const clearBtn = document.getElementById("sectorClearBtn");
  const todosCb = document.getElementById("sectorTodos");

  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      if (todosCb) todosCb.checked = true;
      document
        .querySelectorAll('#sectorDynamic input[name="sector"]')
        .forEach((cb) => (cb.checked = true));
      actualizarResumenYCapas();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (todosCb) todosCb.checked = false;
      document
        .querySelectorAll('#sectorDynamic input[name="sector"]')
        .forEach((cb) => (cb.checked = false));
      actualizarResumenYCapas();
    });
  }

  if (todosCb) {
    todosCb.addEventListener("change", () => {
      const dynamic = document.getElementById("sectorDynamic");
      if (todosCb.checked && dynamic) {
        dynamic
          .querySelectorAll('input[name="sector"]')
          .forEach((cb) => (cb.checked = true));
      }
      actualizarResumenYCapas();
    });
  }

  // Sliders R y N
  const radioSlider = document.getElementById("radioSlider");
  const radioValueSpan = document.getElementById("radioValue");
  if (radioSlider && radioValueSpan) {
    radioValueSpan.textContent = radioSlider.value;
    radioSlider.addEventListener("input", () => {
      radioValueSpan.textContent = radioSlider.value;
    });
  }

  const nSlider = document.getElementById("nSlider");
  const nValueSpan = document.getElementById("nValue");
  if (nSlider && nValueSpan) {
    nValueSpan.textContent = nSlider.value;
    nSlider.addEventListener("input", () => {
      nValueSpan.textContent = nSlider.value;
    });
  }

  // Radios de modo de selección → habilitar/deshabilitar sliders
  document
    .querySelectorAll('input[name="modoSeleccion"]')
    .forEach((rb) =>
      rb.addEventListener("change", () => {
        updateModeUI();
      })
    );

  // Estado inicial de sliders según modo por defecto
  updateModeUI();
}

// ===============================
// Panel plegable (desktop + móvil)
// ===============================

function initPanelResponsive() {
  const panel = document.getElementById("configPanel");          // panel lateral
  const sideHandle = document.getElementById("panelToggle");     // tirador lateral
  const headerBtn = document.getElementById("togglePanelBtn");   // botón en el header (móvil)
  if (!panel) return;

  // Estado inicial: desktop abierto, móvil cerrado
  let isOpen = window.innerWidth > 768;

  function updateUI() {
    panel.classList.toggle("hidden", !isOpen);

    // Tirador lateral: « cuando está abierto, » cuando está cerrado
    if (sideHandle) {
      sideHandle.innerHTML = isOpen ? "«" : "»";
    }

    // Botón del header: cambia texto según estado
    if (headerBtn) {
      headerBtn.textContent = isOpen ? "Ocultar configuración" : "☰ Configuración";
    }

    // Avisar a Leaflet que cambió el tamaño disponible
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    }
  }

  function togglePanel() {
    isOpen = !isOpen;
    updateUI();
  }

  // Estado inicial según ancho de pantalla
  if (!isOpen) {
    panel.classList.add("hidden");
  }
  updateUI();

  // Eventos: tirador lateral
  if (sideHandle) {
    sideHandle.addEventListener("click", togglePanel);
  }

  // Eventos: botón del header (móvil)
  if (headerBtn) {
    headerBtn.addEventListener("click", togglePanel);
  }

  /*
  // Si quieres que se reajuste solo al cambiar el ancho
  window.addEventListener("resize", () => {
    const shouldBeOpen = window.innerWidth > 768;
    if (shouldBeOpen !== isOpen) {
      isOpen = shouldBeOpen;
      updateUI();
    }
  });
  */
}

// ===============================
// Main
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  initMaps();
  initControls();
  initPanelResponsive();

  try {
    proyectos = await loadExcelData();
    console.log(
      "✔ Proyectos cargados desde /capas/nacional.xlsx:",
      proyectos.length
    );
    console.log("Ejemplo primer proyecto:", proyectos[0]);
  } catch (err) {
    console.error("Error cargando Excel:", err);
    return;
  }

  actualizarResumenYCapas();
});
