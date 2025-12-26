/************************************************************
 * SEA Mining - index-fullheight.js
 * 
 * CAMBIOS EN ESTA VERSIÓN:
 * - Layout full-height (100vh)
 * - Panel fijo en desktop (≥768px)
 * - Panel overlay colapsable en móvil (<768px)
 * - Backdrop con blur en móvil
 * - Sin tirador lateral (solo botón en header para móvil)
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

// ===============================
// Lectura de controles
// ===============================

function getSelectedSectors() {
  const todosCb = document.getElementById("sectorTodos");
  const todosOn = todosCb ? todosCb.checked : true;
  if (todosOn) return [];

  const cbs = document.querySelectorAll(
    '#sectorDynamic input[name="sector"]:checked'
  );
  return Array.from(cbs).map((cb) => cb.value);
}

function getModoSeleccion() {
  const rb = document.querySelector('input[name="modoSeleccion"]:checked');
  return rb ? rb.value : "radio";
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
    map.setView(region.centro, region.zoom+2);
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
    zoomControl: true
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
// Sectores dinámicos
// ===============================

function cargarSectoresDinamicos(proyectosEnBBox) {
  const sectoresUnicos = new Set();
  proyectosEnBBox.forEach((p) => {
    const sec = String(p.sector || "").trim();
    if (sec && sec !== "null" && sec !== "undefined") {
      sectoresUnicos.add(sec);
    }
  });

  const sectoresArray = Array.from(sectoresUnicos).sort();

  const dynamicContainer = document.getElementById("sectorDynamic");
  if (!dynamicContainer) return;

  const existentes = new Set(
    Array.from(
      dynamicContainer.querySelectorAll('input[name="sector"]')
    ).map((inp) => inp.value)
  );

  sectoresArray.forEach((sec) => {
    if (existentes.has(sec)) return;

    const label = document.createElement("label");
    label.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "sector";
    checkbox.value = sec;
    checkbox.checked = true;

    checkbox.addEventListener("change", () => {
      actualizarResumenYCapas();
    });

    const span = document.createElement("span");
    span.textContent = sec;

    label.appendChild(checkbox);
    label.appendChild(span);

    dynamicContainer.appendChild(label);
  });
}

// ===============================
// Dibujar marcadores
// ===============================

function dibujarMarcadores(proyectosVisibles) {
  markersLayer.clearLayers();

  const colores = {
    Aprob: "#10b981",
    Calif: "#f59e0b",
    Rech: "#ef4444"
  };

  proyectosVisibles.forEach((p) => {
    const estadoKey =
      p.estado.toLowerCase().includes("aprob") ? "Aprob" :
      p.estado.toLowerCase().includes("calif") ? "Calif" :
      "Rech";

    const color = colores[estadoKey] || "#6b7280";

    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 6,
      fillColor: color,
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    });

    marker.bindPopup(`
      <strong>${p.nombre}</strong><br/>
      Estado: ${p.estado}<br/>
      Sector: ${p.sector}<br/>
      Región: ${p.region}
    `);

    markersLayer.addLayer(marker);
  });
}

// ===============================
// Actualizar resumen y capas
// ===============================

function actualizarResumenYCapas() {
  if (!map || !proyectos.length) return;

  const bounds = map.getBounds();
  const proyectosEnBBox = proyectos.filter(
    (p) => bounds.contains([p.lat, p.lon])
  );

  cargarSectoresDinamicos(proyectosEnBBox);

  const sectoresSel = getSelectedSectors();
  let proyectosFiltrados = proyectosEnBBox;

  if (sectoresSel.length > 0) {
    proyectosFiltrados = proyectosEnBBox.filter((p) =>
      sectoresSel.includes(p.sector)
    );
  }

  dibujarMarcadores(proyectosFiltrados);

  const bboxInfo = document.getElementById("bboxInfo");
  if (bboxInfo) {
    bboxInfo.textContent = `Proyectos en pantalla: ${proyectosFiltrados.length} proyectos`;
  }

  const resumen = calcularResumenRegionEstado(proyectosFiltrados);
  renderSummaryTable(resumen);
}

function calcularResumenRegionEstado(proyectos) {
  const resumen = {};

  proyectos.forEach((p) => {
    const region = p.region || "Sin región";
    if (!resumen[region]) {
      resumen[region] = { Aprob: 0, Calif: 0, Rech: 0 };
    }

    const estadoKey =
      p.estado.toLowerCase().includes("aprob") ? "Aprob" :
      p.estado.toLowerCase().includes("calif") ? "Calif" :
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
  if (coordsDisplay) {
    coordsDisplay.textContent = `Coordenadas clic: ${lat.toFixed(
      5
    )}, ${lng.toFixed(5)}`;
  }

  const modo = getModoSeleccion();
  const radioKm = getRadioAnalisisKm();
  const n = getNProximos();
  const sectores = getSelectedSectors();

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
// ✨ NUEVO: Panel Responsive Simplificado
// Desktop (≥768px): Panel siempre visible
// Móvil (<768px): Panel overlay colapsable
// ===============================

function initPanelResponsive() {
  const panel = document.getElementById("configPanel");
  const backdrop = document.getElementById("panelBackdrop");
  const headerBtn = document.getElementById("togglePanelBtn");
  
  if (!panel) return;

  // Detectar si es móvil
  const isMobile = () => window.innerWidth < 768;

  // Estado del panel (solo importa en móvil)
  let isOpen = false;

  function updateUI() {
    if (isMobile()) {
      // MÓVIL: Panel colapsable con overlay
      if (isOpen) {
        panel.classList.add("is-open");
        if (backdrop) backdrop.classList.add("active");
        if (headerBtn) headerBtn.textContent = "✕ Cerrar";
        
        // Prevenir scroll del body cuando panel está abierto
        document.body.style.overflow = "hidden";
      } else {
        panel.classList.remove("is-open");
        if (backdrop) backdrop.classList.remove("active");
        if (headerBtn) headerBtn.textContent = "☰ Configuración";
        
        // Restaurar scroll del body
        document.body.style.overflow = "";
      }
    } else {
      // DESKTOP: Panel siempre visible
      panel.classList.remove("is-open");
      if (backdrop) backdrop.classList.remove("active");
      document.body.style.overflow = "";
      
      // El botón de toggle no es visible en desktop, pero por si acaso
      if (headerBtn) headerBtn.textContent = "☰ Configuración";
    }

    // Invalidar tamaño del mapa después de cambios
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
    // En desktop no hace nada porque el panel siempre está visible
  }

  function closePanel() {
    if (isMobile()) {
      isOpen = false;
      updateUI();
    }
  }

  // Estado inicial
  updateUI();

  // Eventos: botón del header
  if (headerBtn) {
    headerBtn.addEventListener("click", togglePanel);
  }

  // Eventos: click en backdrop cierra el panel
  if (backdrop) {
    backdrop.addEventListener("click", closePanel);
  }

  // Eventos: resize window - actualizar UI
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Si pasamos de móvil a desktop, cerrar overlay
      if (!isMobile() && isOpen) {
        isOpen = false;
      }
      updateUI();
    }, 150);
  });

  // Prevenir que clicks dentro del panel lo cierren
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
  
  console.log("✅ GeoEVA Full-Height listo!");
});