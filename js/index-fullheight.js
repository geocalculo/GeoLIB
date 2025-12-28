/************************************************************
 * SEA Mining - index-fullheight.js
 *
 * VERSIÓN FINAL (ajustada a requerimiento):
 * - Sector: ya NO es filtro (se elimina filtrado y checkboxes)
 * - Sector: se muestra como CUADRO RESUMEN (tipo tabla), dinámico por BBOX
 * - Resumen Región/Estado: se mantiene y se actualiza por BBOX
 * - Click mapa abre mapainfo.html (modo proximidad) sin sectores
 * - Guarda geoeva_basemap en localStorage (para heredar en mapainfo.html)
 ************************************************************/

const DATA_XLSX_URL = "capas/nacional.xlsx";
const REGIONES_JSON_URL = "capas/regiones.json";

let proyectos = [];
let map;
let markersLayer;
let regionesData = [];

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

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===============================
// Lectura de controles
// ===============================

function getModoSeleccion() {
  const rb = document.querySelector('input[name="modoSeleccion"]:checked');
  return rb ? rb.value : "proximidad";
}

// Nota: tu index no tiene radioSlider en el HTML que pegaste (solo proximidad)
// Mantengo la función por compatibilidad, pero no se usa si no existe.
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
// Carga de regiones
// ===============================

async function loadRegionesData() {
  try {
    const resp = await fetch(REGIONES_JSON_URL);

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error("⚠️ El archivo no es JSON. Content-Type:", contentType);
      throw new Error("El archivo regiones.json no se encuentra o no es válido");
    }

    regionesData = await resp.json();
    console.log("✔ Regiones cargadas:", regionesData.length);
    populateRegionSelect();
  } catch (err) {
    console.error("❌ Error cargando regiones.json:", err);
    regionesData = [];

    const select = document.getElementById("region-select");
    if (select) {
      select.innerHTML = '<option value="">❌ Error cargando regiones</option>';
    }
  }
}

function populateRegionSelect() {
  const select = document.getElementById("region-select");
  if (!select) return;

  select.innerHTML = '<option value="">Selecciona una región</option>';

  regionesData.forEach((region) => {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.nombre;
    select.appendChild(option);
  });

  select.addEventListener("change", onRegionChange);
}

function onRegionChange(e) {
  const regionId = e.target.value;
  if (!regionId || !map) return;

  const region = regionesData.find((r) => r.id === regionId);
  if (!region) return;

  console.log(`📍 Navegando a región: ${region.nombre}`);

  if (region.centro && region.zoom) {
    map.setView(region.centro, region.zoom);
  }

  setTimeout(() => {
    actualizarResumenYCapas();
  }, 300);
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

  const rows = json.slice(1);

  const COL_NOMBRE = 0;
  const COL_REGION = 3;
  const COL_ESTADO = 11;
  const COL_SECTOR = 13;
  const COL_LAT = 14;
  const COL_LON = 15;

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
      sector: row[COL_SECTOR] || "",
    });
  }

  return data;
}

// ===============================
// Basemap prefs (herencia a mapainfo.html)
// ===============================

function saveBasemapPrefs({ addOSM = true, osmOpacity = 1.0, addIMG = true, imgOpacity = 0.2 } = {}) {
  try {
    localStorage.setItem(
      "geoeva_basemap",
      JSON.stringify({ addOSM, osmOpacity, addIMG, imgOpacity })
    );
  } catch (e) {
    console.warn("No se pudo guardar geoeva_basemap:", e);
  }
}

// ===============================
// Inicialización de mapa
// ===============================

function initMaps() {
  map = L.map("map", {
    center: [-33.45, -70.65],
    zoom: 10,
    minZoom: 4,
    zoomControl: true,
  });

  const capaOSM = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      opacity: 1.0,
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }
  ).addTo(map);

  const capaSatelite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.20,
      maxZoom: 19,
    }
  ).addTo(map);

  // ✅ Guardar receta actual (para que mapainfo herede igual)
  saveBasemapPrefs({
    addOSM: true,
    osmOpacity: 1.0,
    addIMG: true,
    imgOpacity: 0.20,
  });

  L.control.scale().addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on("moveend", () => {
    actualizarResumenYCapas();
  });

  map.on("click", onMapClick);

  // ✨ Invalidar tamaño después de que el mapa se renderice
  setTimeout(() => {
    map.invalidateSize();
  }, 100);
}

// ===============================
// Dibujar marcadores
// ===============================

function dibujarMarcadores(proyectosVisibles) {
  markersLayer.clearLayers();

  const colores = {
    Aprob: "#10b981",
    Calif: "#f59e0b",
    Rech: "#ef4444",
    Otros: "#6b7280",
  };

  proyectosVisibles.forEach((p) => {
    const estadoLower = String(p.estado || "").toLowerCase();
    const estadoKey =
      estadoLower.includes("aprob") ? "Aprob" :
      (estadoLower.includes("calif") || estadoLower.includes("eval")) ? "Calif" :
      estadoLower.includes("rech") ? "Rech" :
      "Otros";

    const color = colores[estadoKey] || "#6b7280";

    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      fillColor: color,
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8,
    });

    marker.bindPopup(`
      <strong>${escapeHtml(p.nombre)}</strong><br/>
      Estado: ${escapeHtml(p.estado)}<br/>
      Sector: ${escapeHtml(p.sector)}<br/>
      Región: ${escapeHtml(p.region)}
    `);

    markersLayer.addLayer(marker);
  });
}

// ===============================
// Resúmenes dinámicos (por BBOX)
// ===============================

function calcularResumenRegionEstado(proyectosInView) {
  const resumen = {};

  proyectosInView.forEach((p) => {
    const region = p.region || "Sin región";
    if (!resumen[region]) {
      resumen[region] = { Aprob: 0, Calif: 0, Rech: 0 };
    }

    const estadoLower = String(p.estado || "").toLowerCase();
    const estadoKey =
      estadoLower.includes("aprob") ? "Aprob" :
      (estadoLower.includes("calif") || estadoLower.includes("eval")) ? "Calif" :
      "Rech";

    resumen[region][estadoKey]++;
  });

  return resumen;
}

function renderSummaryTable(resumen) {
  const container = document.getElementById("summaryTableContainer");
  if (!container) {
    console.warn("summaryTableContainer no encontrado en el DOM");
    return;
  }

  const regiones = Object.keys(resumen);

  if (!regiones.length) {
    container.innerHTML =
      "<p>No hay proyectos visibles para la vista actual.</p>";
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
        <td>${escapeHtml(region)}</td>
        <td>${r.Aprob}</td>
        <td>${r.Calif}</td>
        <td>${r.Rech}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  container.innerHTML = html;
}

// ✅ NUEVO: Resumen por SECTOR (cuadro igual a tabla)
function calcularResumenSector(proyectosInView) {
  const counts = new Map();

  proyectosInView.forEach((p) => {
    const sector = String(p.sector || "").trim() || "Sin sector";
    counts.set(sector, (counts.get(sector) || 0) + 1);
  });

  // Orden descendente por conteo
  return Array.from(counts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count);
}

function renderSectorTable(rows) {
  const container = document.getElementById("sectorTableContainer");
  if (!container) {
    // si aún no existe en el HTML, no bloqueamos
    console.warn("sectorTableContainer no encontrado en el DOM");
    return;
  }

  if (!rows.length) {
    container.innerHTML = "<p>No hay proyectos visibles para la vista actual.</p>";
    return;
  }

  const total = rows.reduce((acc, r) => acc + r.count, 0);

  let html = `
    <table>
      <thead>
        <tr>
          <th>Sector</th>
          <th style="text-align:right;">#</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of rows) {
    html += `
      <tr>
        <td>${escapeHtml(r.sector)}</td>
        <td style="text-align:right; font-weight:800;">${r.count}</td>
      </tr>
    `;
  }

  html += `
      </tbody>
      <tfoot>
        <tr>
          <td style="font-weight:900;">TOTAL</td>
          <td style="text-align:right; font-weight:900;">${total}</td>
        </tr>
      </tfoot>
    </table>
  `;

  container.innerHTML = html;
}

// ===============================
// Actualizar resumen y capas (BBOX)
// ===============================

function actualizarResumenYCapas() {
  if (!map || !proyectos.length) return;

  const bounds = map.getBounds();

  // 1) Proyectos en BBOX (vista)
  const proyectosEnBBox = proyectos.filter((p) =>
    bounds.contains([p.lat, p.lon])
  );

  // 2) Ya NO hay filtro por sector: todo lo visible se dibuja
  dibujarMarcadores(proyectosEnBBox);

  // 3) Info “Proyectos en pantalla”
  const bboxInfo = document.getElementById("bboxInfo");
  if (bboxInfo) {
    bboxInfo.textContent = `Proyectos en pantalla: ${proyectosEnBBox.length} proyectos`;
  }

  // 4) Resumen Región/Estado (igual que antes)
  const resumen = calcularResumenRegionEstado(proyectosEnBBox);
  renderSummaryTable(resumen);

  // 5) ✅ Resumen por Sector (nuevo cuadro dinámico)
  const sectorRows = calcularResumenSector(proyectosEnBBox);
  renderSectorTable(sectorRows);
}

// ===============================
// Click en el mapa
// ===============================

function onMapClick(e) {
  const { lat, lng } = e.latlng;

  const modo = getModoSeleccion();   // debería ser "proximidad" según tu UI
  const radioKm = getRadioAnalisisKm(); // no se usa si no existe slider, pero lo pasamos igual
  const n = getNProximos();

  console.log(
    `Clic en: ${lat}, ${lng} | modo=${modo} | R=${radioKm} km | N=${n}`
  );

  const url = new URL("mapainfo.html", window.location.href);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lng", lng.toFixed(6));
  url.searchParams.set("modo", modo);
  url.searchParams.set("radio", radioKm.toString());
  url.searchParams.set("n", n.toString());

  // ✅ Sin sectores: ya no existe filtro por sector
  window.open(url.toString(), "_blank");
}

// ===============================
// Controles
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
  // ✅ Ya no hay UI ni botones de sectores (select all / clear / todos)
  // Dejo los sliders y modo.

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

  document
    .querySelectorAll('input[name="modoSeleccion"]')
    .forEach((rb) =>
      rb.addEventListener("change", () => {
        updateModeUI();
      })
    );

  updateModeUI();
}

// ===============================
// Panel Responsive Simplificado
// ===============================

function initPanelResponsive() {
  const panel = document.getElementById("configPanel");
  const backdrop = document.getElementById("panelBackdrop");
  const headerBtn = document.getElementById("togglePanelBtn");

  if (!panel) return;

  const isMobile = () => window.innerWidth < 768;
  let isOpen = false;

  function updateUI() {
    if (isMobile()) {
      if (isOpen) {
        panel.classList.add("is-open");
        if (backdrop) backdrop.classList.add("active");
        if (headerBtn) headerBtn.textContent = "✕ Cerrar";
        document.body.style.overflow = "hidden";
      } else {
        panel.classList.remove("is-open");
        if (backdrop) backdrop.classList.remove("active");
        if (headerBtn) headerBtn.textContent = "☰ Configuración";
        document.body.style.overflow = "";
      }
    } else {
      panel.classList.remove("is-open");
      if (backdrop) backdrop.classList.remove("active");
      document.body.style.overflow = "";
      if (headerBtn) headerBtn.textContent = "☰ Configuración";
    }

    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 400);
    }
  }

  function togglePanel() {
    if (isMobile()) {
      isOpen = !isOpen;
      updateUI();
    }
  }

  function closePanel() {
    if (isMobile()) {
      isOpen = false;
      updateUI();
    }
  }

  updateUI();

  if (headerBtn) {
    headerBtn.addEventListener("click", togglePanel);
  }

  if (backdrop) {
    backdrop.addEventListener("click", closePanel);
  }

  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!isMobile() && isOpen) {
        isOpen = false;
      }
      updateUI();
    }, 150);
  });

  panel.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

// ===============================
// Main
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Iniciando GeoEVA Full-Height...");

  initMaps();
  initControls();
  initPanelResponsive();

  await loadRegionesData();

  try {
    proyectos = await loadExcelData();
    console.log("✔ Proyectos cargados desde /capas/nacional.xlsx:", proyectos.length);
    console.log("Ejemplo primer proyecto:", proyectos[0]);
  } catch (err) {
    console.error("Error cargando Excel:", err);
    return;
  }

  actualizarResumenYCapas();

  console.log("✅ GeoEVA Full-Height listo!");
});
