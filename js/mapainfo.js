// ===========================
// GeoEVA - MapaInfo Logic
// Sistema de análisis de proximidad con panel lateral de proyectos
// VERSIÓN CORREGIDA - Todas las correcciones de seguridad aplicadas
// ===========================

const DATA_XLSX_URL = "capas/nacional.xlsx";
let globalParams = null;

// Variables globales para el panel y sincronización
let proyectosDentroDelRadio = [];
let markersMap = new Map(); // Map: projectId -> marker
let currentHighlightedId = null;
let isLoadingData = false; // CORRECCIÓN #2: Prevenir race conditions
let map = null; // CORRECCIÓN: Referencia global al mapa para acceso desde funciones
let clickTimeout = null;  // Debounce para clicks

// ✅ AGREGAR ESTE FLAG
let isHighlighting = false;  // Guard para evitar recursión

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

// CORRECCIÓN #2: Protección contra race conditions
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

function ajustarZoomCirculo(map, circle) {
  const size = map.getSize();
  const minSide = Math.min(size.x, size.y);
  const paddingPx = minSide * 0.20;

  map.fitBounds(circle.getBounds(), {
    padding: [paddingPx, paddingPx]
  });
}

// ========================================
// FUNCIONES DEL PANEL LATERAL
// ========================================

function togglePanel() {
  const panel = document.getElementById('projectsPanel');
  panel.classList.toggle('collapsed');
}

// CORRECCIÓN #7: Warning para listas grandes
// CORRECCIÓN A2: Truncar nombres largos
function renderProjectsList(proyectos) {
  if (proyectos.length > 500) {
    console.warn(`⚠️ ${proyectos.length} proyectos en el panel. El rendimiento puede degradarse.`);
  }
  
  const panelContent = document.getElementById('panelContent');
  const panelCount = document.getElementById('panelCount');
  
  panelContent.innerHTML = '';
  panelCount.textContent = proyectos.length;

  proyectos.forEach((proyecto) => {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.dataset.projectId = proyecto.id;
    
    // Determinar color del punto según estado
    let dotColor = '#6b7280'; // Otros
    if (proyecto.bucket === 'Aprob') dotColor = '#16a34a';
    else if (proyecto.bucket === 'Calif') dotColor = '#ea580c';
    else if (proyecto.bucket === 'Rech') dotColor = '#dc2626';
    
    // CORRECCIÓN A2: Truncar nombres largos
    const nombreDisplay = proyecto.nombre.length > 60 
      ? proyecto.nombre.substring(0, 57) + '...' 
      : proyecto.nombre;
    
    item.innerHTML = `
      <div class="project-id">#${proyecto.id}</div>
      <div class="project-name" title="${proyecto.nombre}">${nombreDisplay}</div>
      <div class="project-status-dot" style="background: ${dotColor}"></div>
    `;
    
    // Click en el item de la lista
    item.addEventListener('click', (e) => {
      // ✅ Prevenir propagación
      e.stopPropagation();
      e.preventDefault();
      
      // ✅ Llamar highlight (ya tiene guards internos)
      highlightProject(proyecto.id);
    });
    
    panelContent.appendChild(item);
  });
}

// CORRECCIÓN #5: Cerrar popup anterior explícitamente
function highlightProject(projectId) {
  // ✅ GUARD: Si ya está destacando, no hacer nada
  if (isHighlighting) {
    return;
  }
  
  // ✅ GUARD: Si es el mismo proyecto, no hacer nada
  if (currentHighlightedId === projectId) {
    return;
  }
  
  // ✅ Activar flag
  isHighlighting = true;
  
  try {
    // Limpiar resaltado anterior
    clearHighlight();
    
    // Cerrar todos los popups
    if (map) {
      map.eachLayer((layer) => {
        if (layer instanceof L.Popup && map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    }
    
    // Resaltar item en la lista
    const listItem = document.querySelector(`[data-project-id="${projectId}"]`);
    if (listItem) {
      listItem.classList.add('highlighted');
      listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Resaltar marker en el mapa
    const marker = markersMap.get(projectId);
    if (marker) {
      const el = marker.getElement();
      if (el) {
        el.classList.add('marker-highlighted');
      }
      
      // Abrir popup SIN disparar evento click
      marker.openPopup();
    }
    
    currentHighlightedId = projectId;
    
  } finally {
    // ✅ Siempre desactivar flag (incluso si hay error)
    isHighlighting = false;
  }
}

// CORRECCIÓN #1 y #3: Cerrar popup huérfano y proteger referencias
function clearHighlight() {
  // ✅ Solo limpiar si hay algo que limpiar
  if (currentHighlightedId === null) {
    return;
  }
  
  // Limpiar lista
  const highlightedItem = document.querySelector('.project-item.highlighted');
  if (highlightedItem) {
    highlightedItem.classList.remove('highlighted');
  }
  
  // Limpiar marker
  if (currentHighlightedId !== null) {
    const marker = markersMap.get(currentHighlightedId);
    if (marker) {
      const el = marker.getElement();
      if (el) {
        el.classList.remove('marker-highlighted');
      }
      // ✅ Cerrar popup sin disparar eventos
      marker.closePopup();
    }
  }
  
  currentHighlightedId = null;
}

// ========================================
// INICIALIZACIÓN PRINCIPAL
// ========================================

document.addEventListener("DOMContentLoaded", async () => {
  // CORRECCIÓN #7: Resetear estado global al inicio
  proyectosDentroDelRadio = [];
  markersMap.clear();
  currentHighlightedId = null;
  
  const params = new URLSearchParams(window.location.search);
  globalParams = params;

  const lat = parseFloat(params.get("lat"));
  const lng = parseFloat(params.get("lng"));
  
  // CORRECCIÓN A1: Validación de parámetros URL
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert("❌ Error: Coordenadas inválidas en la URL.\n\nPor favor, verifica los parámetros 'lat' y 'lng'.");
    console.error("Parámetros inválidos:", { lat, lng });
    return;
  }
  
  const modo = params.get("modo") || "radio";
  const radioParam = parseFloat(params.get("radio")) || 10;
  const nParam = parseInt(params.get("n") || "10", 10);
  const sectoresParam = params.get("sectores") || "";
  const sectoresFiltro = sectoresParam
    ? sectoresParam.split("|").filter(Boolean)
    : [];

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

  // Toggle del panel
  document.getElementById('panelToggle').addEventListener('click', togglePanel);

  // MAPA - Asignación a variable global
  map = L.map("map", {
    center: [lat, lng],
    zoom: 10,
    minZoom: 4,
  });

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      opacity: 1.0,
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.10,
      maxZoom: 19,
    }
  ).addTo(map);

  L.control.scale().addTo(map);

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
      <div class="legend-item">
        <span class="legend-color" style="background:#16a34a;"></span> Aprobado
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#ea580c;"></span> En calificación / evaluación
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#dc2626;"></span> Rechazado
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#6b7280;"></span> Otros estados
      </div>
    `;
    return div;
  };
  legend.addTo(map);

  let proyectos;
  try {
    proyectos = await loadExcelData();
    
    // CORRECCIÓN #2: Validar respuesta de carga
    if (!proyectos || proyectos.length === 0) {
      throw new Error("No se pudieron cargar proyectos del archivo Excel");
    }
  } catch (err) {
    console.error("Error cargando nacional.xlsx en mapainfo.html:", err);
    radioLabel.textContent = "Radio: —";
    countLabel.textContent = "Error al cargar datos de proyectos para este detalle.";
    invLabel.textContent = "Inversión: —";
    return;
  }

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
        aprobTopN.map(
          (p) => `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`
        )
      );
    } else {
      radioKm = radioParam;
    }
  }

  const circle = L.circle([lat, lng], {
    radius: radioKm * 1000,
    color: "#1d4ed8",
    weight: 3,
    fill: false,
    fillOpacity: 0,
    interactive: false,
  }).addTo(map);

  ajustarZoomCirculo(map, circle);

  map.on("resize", () => {
    ajustarZoomCirculo(map, circle);
  });

  // Proyectos dentro del radio
  const dentro = todosConDist.filter((p) => p.distKm <= radioKm);
  
  // CORRECCIÓN #4: Sort estable con desempate por nombre
  dentro.sort((a, b) => {
    if (a.distKm !== b.distKm) {
      return a.distKm - b.distKm;
    }
    // Desempate alfabético por nombre para IDs consistentes
    return (a.nombre || "").localeCompare(b.nombre || "");
  });

  let resumenAprob = 0;
  let resumenCalif = 0;
  let resumenRech  = 0;
  let resumenOtros = 0;

  let invAprob = 0;
  let invCalif = 0;
  let invRech  = 0;
  let invOtros = 0;

  dentro.forEach((p, index) => {
    const estadoL = (p.estado || "").toLowerCase();
    const key = `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`;

    // Asignar ID correlativo (empezando en 1)
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

    // ✅ Tooltip con configuración anti-eventos completa
    m.bindTooltip(`#${p.id}`, {
      permanent: true,
      direction: 'top',        // Arriba del punto, no a la derecha
      className: 'project-id-label',
      offset: [0, -10],        // Separación vertical
      interactive: false,      // No responde a hover/click
      opacity: 1,
      bubblingMouseEvents: false  // ✅ CRÍTICO: No propagar eventos de mouse
    });

    m.bindPopup(`
      <strong>#${p.id} - ${p.nombre || "Proyecto sin nombre"}</strong><br/>
      <b>Tipo:</b> ${p.tipo || "—"}<br/>
      <b>Sector:</b> ${p.sector || "—"}<br/>
      <b>Inversión:</b> ${formatMMU(p.inversion)}<br/>
      <b>Estado:</b> ${p.estado || "—"}<br/>
      <b>Distancia:</b> ${p.distKm.toFixed(2)} km<br/><br/>
      <b>Expediente:</b> ${
        p.web
          ? `<a href="${p.web}" target="_blank">Abrir expediente</a>`
          : "—"
      }<br/>
      <b>Anexos:</b> ${
        p.anexos
          ? `<a href="${p.anexos}" target="_blank">Abrir anexos</a>`
          : "—"
      }
    `);

    // Evento al hacer click en el marker

    // ✅ DESPUÉS (sin recursión)

    m.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    
    // ✅ Debounce: ignorar clicks múltiples en 300ms
    if (clickTimeout) clearTimeout(clickTimeout);
    clickTimeout = setTimeout(() => {
      highlightProject(p.id);
    }, 50);
  });

    // ✅ NO escuchar popupopen (causa loop)
    // Solo escuchar popupclose

    m.on('popupclose', () => {
      // Solo limpiar si no estamos en medio de un highlight
      if (!isHighlighting) {
        clearHighlight();
      }
    });

    m.addTo(markersLayer);

    // Guardar en el mapa de markers
    markersMap.set(p.id, m);
  });

  // Guardar proyectos para el panel
  proyectosDentroDelRadio = dentro;

  // Renderizar lista de proyectos
  renderProjectsList(dentro);

  // Actualizar cinta
  radioLabel.textContent = `Radio: ${radioKm.toFixed(1)} km`;
  countLabel.textContent =
    `Resumen – Aprob: ${resumenAprob} | Calif: ${resumenCalif} | ` +
    `Rech: ${resumenRech} | Otros: ${resumenOtros}`;
  invLabel.textContent =
    `Inversión – Aprob: ${formatMMU(invAprob)} | ` +
    `Calif: ${formatMMU(invCalif)} | ` +
    `Rech: ${formatMMU(invRech)} | ` +
    `Otros: ${formatMMU(invOtros)}`;

  // ==============================
  // Datos para los gráficos parametrizados
  // ==============================
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
      distKm: Number.isFinite(p.distKm) ? p.distKm : 0,  // CORRECCIÓN #6: Fallback seguro
    };
  });

  // CORRECCIÓN #6: Filtrar datos inválidos antes de enviar a gráficos
  const chartDataValid = chartData.filter(d => 
    Number.isFinite(d.inversionMm) && Number.isFinite(d.distKm)
  );

  if (chartDataValid.length < chartData.length) {
    console.warn(`⚠️ ${chartData.length - chartDataValid.length} proyectos filtrados por datos inválidos en gráficos`);
  }

  window.chartDataGlobal = chartDataValid;

  if (typeof window.initCharts === "function") {
    window.initCharts(chartDataValid);
  } else {
    console.warn("initCharts(chartData) no está definido. Revisa js/graficos.js");
  }
});