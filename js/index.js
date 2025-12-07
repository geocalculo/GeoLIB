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
// Carga del Excel
// ===============================

async function loadExcelData() {
  const resp = await fetch(DATA_XLSX_URL);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!json.length) return [];

  const headersRaw = json[0];
  const rows = json.slice(1);
  const headersNorm = headersRaw.map((h) => normalizeHeader(h));

  console.log("Encabezados normalizados:", headersNorm);

  const idxNombre = headersNorm.indexOf("nombre_del_proyecto");
  const idxRegion = headersNorm.indexOf("region");
  const idxEstado = headersNorm.indexOf("estado_del_proyecto");
  const idxSectorBase = headersNorm.indexOf("sector_productivo");
  const idxLat = headersNorm.indexOf("latitud_punto_representativo");
  const idxLon = headersNorm.indexOf("longitud_punto_representativo");

  const data = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    const lat = idxLat >= 0 ? parseCoord(row[idxLat]) : null;
    const lon = idxLon >= 0 ? parseCoord(row[idxLon]) : null;
    if (lat === null || lon === null) continue;

    const nombre = idxNombre >= 0 ? String(row[idxNombre] || "") : "";
    const region = idxRegion >= 0 ? String(row[idxRegion] || "") : "";
    const estado = idxEstado >= 0 ? String(row[idxEstado] || "") : "";
    const sector = idxSectorBase >= 0 ? String(row[idxSectorBase] || "") : "";

    data.push({ lat, lon, region, estado, sector, nombre });
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

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

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

  // Guardar selección previa
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

    const checked = prevSelected.size ? prevSelected.has(sec) : true;

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

  // Listeners: si se toca algún sector, se apaga "Todos"
  const todosCb = document.getElementById("sectorTodos");
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

  const bboxInfo = document.getElementById("bboxInfo");
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

  bboxInfo.textContent =
    `Proyectos en pantalla (total BBOX): ${totalEnPantalla} ` +
    `| Dibujados (filtro): ${filtradosEnPantalla} ` +
    `(${detalleSectores})`;

  renderSummaryTable(resumen);
}

function renderSummaryTable(resumen) {
  const container = document.getElementById("summaryTableContainer");
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
  const coordsDisplay = document.getElementById("coordsDisplay");
  coordsDisplay.textContent = `Coordenadas clic: ${lat.toFixed(
    5
  )}, ${lng.toFixed(5)}`;

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
// Panel plegable + controles
// ===============================

function initPanelToggle() {
  const btn = document.getElementById("togglePanelBtn");
  const panel = document.getElementById("configPanel");
  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    panel.classList.toggle("is-open");
  });
}

function initControls() {
  // Botón seleccionar todos
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
}

// ===============================
// Main
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  initMaps();
  initPanelToggle();
  initControls();

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
