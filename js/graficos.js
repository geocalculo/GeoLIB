// =======================================
// graficos.js – GeoEVA (Plotly) – 4 gráficos esenciales
// 1) Sector vs Inversión (horizontal, Top 6)
// 2) Inversión vs Año (vertical)
// 3) Estado vs Inversión (horizontal)
// 4) Sector vs Plazo promedio en MESES (horizontal, Top 6, SOLO Aprobados)
//
// Mobile-first: valores visibles en barras
// Filtros por click (excepto sector)
// =======================================

// ---------- Colores por estado ----------
function getEstadoColor(label) {
  const txt = (label || "").toString().toLowerCase();
  if (txt.includes("aprob")) return "rgba(34,197,94,0.9)";
  if (txt.includes("rech")) return "rgba(239,68,68,0.9)";
  if (txt.includes("calif") || txt.includes("eval")) return "rgba(234,179,8,0.9)";
  return "rgba(148,163,184,0.9)";
}

// ---------- Helpers de formato ----------
function fmtNumber(val, decimals = 1) {
  if (!Number.isFinite(val)) return (0).toFixed(decimals);
  const p = Math.max(0, Math.min(3, decimals));
  return (Math.round(val * Math.pow(10, p)) / Math.pow(10, p)).toFixed(p);
}

function fmtCompactMMUSD(val) {
  if (!Number.isFinite(val)) return "0.0";
  const abs = Math.abs(val);
  if (abs >= 1000) return (val / 1000).toFixed(1) + "k";
  return (Math.round(val * 10) / 10).toFixed(1);
}

// ---------- Normalización de keys ----------
function normalizeKey(raw, dimension) {
  if (dimension === "anio") {
    if (raw == null || raw === "") return null;
    const anioNum = parseInt(raw, 10);
    if (!Number.isFinite(anioNum)) return null;
    return String(anioNum);
  }
  if (raw === undefined || raw === null || String(raw).trim() === "") return "Sin dato";
  return raw.toString().trim();
}

// ---------- Agrupación por suma de inversión ----------
function buildGroupsSum(rows, dimension) {
  const groups = new Map();
  
  rows.forEach((row) => {
    const key = normalizeKey(row[dimension], dimension);
    if (key === null) return;
    
    const inversion = Number(row.inversionMm ?? row.inversion ?? 0);
    if (!Number.isFinite(inversion)) return;
    
    groups.set(key, (groups.get(key) || 0) + inversion);
  });
  
  return groups;
}

// ---------- Agrupación por promedio (para plazo en meses) ----------
function buildGroupsAvg(rows, dimension, valueField) {
  const acc = new Map(); // key -> {sum, count}
  
  rows.forEach((row) => {
    const key = normalizeKey(row[dimension], dimension);
    if (key === null || key === "Sin dato") return;
    
    // Leer campo meses/plazoMeses de forma robusta
    const value = Number(row[valueField] ?? row.meses ?? row.plazoMeses);
    if (!Number.isFinite(value) || value <= 0) return;
    
    const prev = acc.get(key) || { sum: 0, count: 0 };
    prev.sum += value;
    prev.count += 1;
    acc.set(key, prev);
  });
  
  const out = new Map();
  for (const [k, v] of acc.entries()) {
    if (v.count > 0) {
      out.set(k, v.sum / v.count);
    }
  }
  return out;
}

// =======================================
// CONFIGURACIÓN DE LOS 4 GRÁFICOS
// =======================================
const CHARTS_CONFIG = [
  {
    id: "sector_inv_h",
    title: "Inversión por sector (MMU$)",
    dimension: "sector",
    orientation: "h",
    metric: "sum",
    topN: 6
  },
  {
    id: "inv_anio_v",
    title: "Inversión por año (MMU$)",
    dimension: "anio",
    orientation: "v",
    metric: "sum"
  },
  {
    id: "estado_inv_h",
    title: "Inversión por estado (MMU$)",
    dimension: "estado",
    orientation: "h",
    metric: "sum"
  },
  {
    id: "sector_plazo_h",
    title: "Plazo promedio por sector (meses) – Solo Aprobados",
    dimension: "sector",
    orientation: "h",
    metric: "avg",
    valueField: "meses",
    topN: 6,
    sortAsc: true // Ordenar ascendente (más rápidos arriba)
  }
];

// =======================================
// ESTADO GLOBAL
// =======================================
let fullData = [];
let activeFilters = {};

// ---------- API pública ----------
window.initCharts = function initCharts(data) {
  fullData = Array.isArray(data) ? data : [];
  activeFilters = {};
  buildChartCards();
  renderAllCharts();
  updateFilterIndicators();
  
  // Debug: ver cuántos proyectos aprobados con meses válidos hay
  const aprobados = fullData.filter(r => {
    const est = (r.estado || "").toLowerCase();
    const mes = Number(r.meses ?? r.plazoMeses);
    return est.includes("aprob") && Number.isFinite(mes) && mes > 0;
  });
  console.log(`[graficos] Proyectos aprobados con meses válidos: ${aprobados.length}`);
};

window.clearAllFilters = function clearAllFilters() {
  activeFilters = {};
  renderAllCharts();
  updateFilterIndicators();
};

// ========================================
// Filtrado de datos
// ========================================
function getFilteredRows() {
  return fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue;
      
      const rowVal = normalizeKey(row[dim], dim);
      if (rowVal === null || rowVal !== val) return false;
    }
    return true;
  });
}

// ========================================
// Resumen KMZ (Top 3)
// ========================================
function topNFromGroups(groupsMap, n = 3) {
  return Array.from(groupsMap.entries())
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, n);
}

window.getKmlBalloonSummaryText = function getKmlBalloonSummaryText(opts = {}) {
  const rows = Array.isArray(opts.data) ? opts.data : fullData;
  const radiusM = opts.radiusM;
  const center = opts.center;

  const countEstado = new Map();
  const countSector = new Map();
  rows.forEach((row) => {
    const est = normalizeKey(row.estado, "estado");
    const sec = normalizeKey(row.sector, "sector");
    if (est !== null) countEstado.set(est, (countEstado.get(est) || 0) + 1);
    if (sec !== null) countSector.set(sec, (countSector.get(sec) || 0) + 1);
  });

  const invEstado = buildGroupsSum(rows, "estado");
  const invSector = buildGroupsSum(rows, "sector");

  const topEstadoCount = topNFromGroups(countEstado, 3);
  const topSectorCount = topNFromGroups(countSector, 3);
  const topEstadoInv = topNFromGroups(invEstado, 3);
  const topSectorInv = topNFromGroups(invSector, 3);

  const lines = [];
  lines.push("RESUMEN");
  lines.push(`• Proyectos en radio: ${rows.length}`);
  if (Number.isFinite(radiusM)) lines.push(`• Radio: ${Math.round(radiusM)} m`);
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
    lines.push(`• Centro: ${center.lat.toFixed(6)}, ${center.lon.toFixed(6)}`);
  }

  lines.push("");
  lines.push("TOP 3 ESTADO (por # proyectos)");
  if (!topEstadoCount.length) lines.push("• Sin datos");
  topEstadoCount.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${Math.round(v)}`));

  lines.push("");
  lines.push("TOP 3 SECTOR (por # proyectos)");
  if (!topSectorCount.length) lines.push("• Sin datos");
  topSectorCount.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${Math.round(v)}`));

  lines.push("");
  lines.push("TOP 3 ESTADO (por inversión MMU$)");
  if (!topEstadoInv.length) lines.push("• Sin datos");
  topEstadoInv.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtCompactMMUSD(v)} MMU$`));

  lines.push("");
  lines.push("TOP 3 SECTOR (por inversión MMU$)");
  if (!topSectorInv.length) lines.push("• Sin datos");
  topSectorInv.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtCompactMMUSD(v)} MMU$`));

  if (opts.links && (opts.links.geoeva || opts.links.geoipt)) {
    lines.push("");
    lines.push("LINKS");
    if (opts.links.geoeva) lines.push(`• GeoEVA: ${opts.links.geoeva}`);
    if (opts.links.geoipt) lines.push(`• GeoIPT: ${opts.links.geoipt}`);
  }

  return lines.join("\n");
};

// ========================================
// Construcción de tarjetas
// ========================================
function buildChartCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  CHARTS_CONFIG.forEach((cfg, index) => {
    const card = document.createElement("div");
    card.className = "chart-card";
    card.id = `card_${cfg.id}`;
    card.style.cssText = `
      position: relative;
      transition: all 0.3s ease;
      cursor: pointer;
      animation: fadeInUp 0.4s ease forwards;
      animation-delay: ${0.05 * (index + 1)}s;
      opacity: 0;
    `;

    const h3 = document.createElement("h3");
    h3.textContent = cfg.title;
    h3.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 1rem;
    `;

    const div = document.createElement("div");
    div.id = `chart_${cfg.id}`;
    div.className = "plotly-chart";

    card.appendChild(h3);
    card.appendChild(div);
    grid.appendChild(card);

    cfg.containerId = div.id;
    cfg.cardId = card.id;
  });

  if (!document.getElementById("chart-animations-style")) {
    const style = document.createElement("style");
    style.id = "chart-animations-style";
    style.textContent = `
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .chart-card:hover {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        transform: translateY(-2px);
      }
      .chart-card.filtered {
        border: 2px solid #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
      .filter-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.2rem 0.5rem;
        background: #3b82f6;
        color: white;
        font-size: 0.7rem;
        border-radius: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .filter-badge:hover {
        background: #2563eb;
        transform: scale(1.05);
      }
      .filter-badge::after {
        content: '×';
        font-size: 0.9rem;
        font-weight: bold;
        margin-left: 0.2rem;
      }
      .chart-card::before {
        content: '👆 Clic para filtrar';
        position: absolute;
        top: -8px;
        right: 10px;
        background: #fbbf24;
        color: #78350f;
        padding: 0.2rem 0.5rem;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 600;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
        z-index: 10;
      }
      .chart-card:hover::before {
        opacity: 1;
      }
      .chart-card.filtered::before {
        display: none;
      }
      @media (max-width: 768px) {
        .chart-card::before {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// ---------- Indicadores visuales de filtros ----------
function updateFilterIndicators() {
  CHARTS_CONFIG.forEach((cfg) => {
    const card = document.getElementById(cfg.cardId);
    if (!card) return;

    const hasFilter = activeFilters[cfg.dimension];

    if (hasFilter) {
      card.classList.add("filtered");

      const h3 = card.querySelector("h3");
      let badge = h3.querySelector(".filter-badge");

      if (!badge) {
        badge = document.createElement("span");
        badge.className = "filter-badge";
        badge.textContent = "Filtrado";
        badge.onclick = (e) => {
          e.stopPropagation();
          clearChartFilter(cfg.dimension);
        };
        h3.appendChild(badge);
      }
    } else {
      card.classList.remove("filtered");
      const badge = card.querySelector(".filter-badge");
      if (badge) badge.remove();
    }
  });
}

function clearChartFilter(dimension) {
  delete activeFilters[dimension];
  renderAllCharts();
  updateFilterIndicators();
}

// ========================================
// Renderizado de gráficos
// ========================================
function renderAllCharts() {
  CHARTS_CONFIG.forEach((cfg) => renderChart(cfg));
}

function renderChart(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  // Aplicar filtros activos
  let filtered = getFilteredRows();

  // FILTRO ESPECIAL para gráfico de plazo: SOLO proyectos Aprobados
  if (cfg.metric === "avg" && cfg.valueField === "meses") {
    filtered = filtered.filter((row) => {
      const estado = (row.estado || "").toString().toLowerCase();
      const meses = Number(row.meses ?? row.plazoMeses);
      // Debe ser aprobado Y tener meses válidos
      return estado.includes("aprob") && Number.isFinite(meses) && meses > 0;
    });
    
    // Debug
    console.log(`[${cfg.id}] Proyectos aprobados con meses válidos después de filtros: ${filtered.length}`);
  }

  // Agrupar según métrica
  let groups;
  if (cfg.metric === "avg") {
    groups = buildGroupsAvg(filtered, cfg.dimension, cfg.valueField);
  } else {
    groups = buildGroupsSum(filtered, cfg.dimension);
  }

  // Extraer labels con datos válidos
  let labels = Array.from(groups.keys()).filter((k) => {
    const val = groups.get(k);
    return Number.isFinite(val) && val > 0;
  });

  // Ordenar labels
  if (cfg.dimension === "anio") {
    labels = labels
      .filter((v) => /^\d{4}$/.test(v))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  } else {
    labels = labels.sort();
  }

  // Aplicar TOP N si está configurado
  if (Number.isFinite(cfg.topN) && cfg.topN > 0) {
    const pairs = labels.map((lab) => [lab, groups.get(lab) || 0]);
    
    // Ordenar según configuración
    if (cfg.sortAsc) {
      // Ascendente: menores valores primero (más rápidos arriba)
      pairs.sort((a, b) => (a[1] || 0) - (b[1] || 0));
    } else {
      // Descendente: mayores valores primero (por defecto)
      pairs.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    }
    
    labels = pairs.slice(0, cfg.topN).map((p) => p[0]);
  }

  // Valores correspondientes
  const values = labels.map((cat) => groups.get(cat) || 0);
  const hasData = labels.length > 0 && values.some((v) => v > 0);

  const isPlazo = cfg.metric === "avg" && cfg.valueField === "meses";

  // Layout base
  let layout = {
    margin: { t: 20, b: 60, l: 60, r: 20 },
    showlegend: false
  };

  // Mensaje si no hay datos
  if (!hasData) {
    const message = isPlazo 
      ? "Sin proyectos aprobados<br>con datos de plazo"
      : "Sin datos para<br>los filtros seleccionados";
      
    layout.annotations = [
      {
        text: message,
        xref: "paper",
        yref: "paper",
        x: 0.5,
        y: 0.5,
        xanchor: "center",
        yanchor: "middle",
        showarrow: false,
        font: { size: 14, color: "#9ca3af" }
      }
    ];
  }

  // Configurar colores
  let colors;
  if (cfg.dimension === "estado") {
    colors = labels.map((cat) => {
      const selected = activeFilters[cfg.dimension] || null;
      const base = getEstadoColor(cat);
      if (selected && selected !== cat) return base.replace("0.9", "0.2");
      return base;
    });
  } else {
    colors = labels.map((cat) => {
      const selected = activeFilters[cfg.dimension] || null;
      const strong = "rgba(59,130,246,0.9)";
      const soft = "rgba(59,130,246,0.2)";
      if (selected && selected !== cat) return soft;
      return strong;
    });
  }

  // Formatear valores para texto
  const textVals = values.map((v) => {
    if (isPlazo) return fmtNumber(v, 0); // 0 decimales para meses
    return fmtNumber(v, 1);
  });

  let dataTraces;

  // BARRAS HORIZONTALES
  if (cfg.orientation === "h") {
    dataTraces = [
      {
        type: "bar",
        orientation: "h",
        x: values,
        y: labels,
        marker: { color: colors },
        text: textVals,
        textposition: "auto",
        cliponaxis: false,
        hovertemplate: isPlazo
          ? "%{y}<br>%{x:.0f} meses<extra></extra>"
          : "%{y}<br>%{x:.1f} MMU$<extra></extra>"
      }
    ];

    layout = {
      ...layout,
      margin: { t: 20, b: 60, l: 160, r: 20 },
      xaxis: {
        title: isPlazo ? "Meses" : "Inversión (MMU$)",
        automargin: true,
        rangemode: "tozero"
      },
      yaxis: {
        automargin: true,
        autorange: "reversed"
      }
    };
  }
  // BARRAS VERTICALES
  else {
    dataTraces = [
      {
        type: "bar",
        x: labels,
        y: values,
        marker: { color: colors },
        text: textVals,
        textposition: "auto",
        cliponaxis: false,
        hovertemplate: isPlazo
          ? "%{x}<br>%{y:.0f} meses<extra></extra>"
          : "%{x}<br>%{y:.1f} MMU$<extra></extra>"
      }
    ];

    layout = {
      ...layout,
      xaxis: {
        title: cfg.dimension === "anio" ? "Año" : cfg.dimension.charAt(0).toUpperCase() + cfg.dimension.slice(1),
        automargin: true,
        tickangle: cfg.dimension === "anio" ? 0 : -45,
        type: cfg.dimension === "anio" ? "category" : undefined
      },
      yaxis: {
        title: isPlazo ? "Meses" : "Inversión (MMU$)",
        automargin: true,
        rangemode: "tozero"
      }
    };
  }

  // ---- Bloquear interacción: que se comporte como "foto" ----
  layout.dragmode = false;      // sin pan/zoom/selección
  layout.hovermode = false;     // sin hover que captura mouse/touch
  layout.uirevision = "locked"; // estado estable entre renders


  Plotly.newPlot(container, dataTraces, layout, {
    responsive: true,
    displaylogo: false,
    displayModeBar: false, // sin barra
    scrollZoom: false,     // sin zoom con scroll/trackpad
    doubleClick: false,    // sin reset/zoom con doble click
    editable: false,       // no editable
    staticPlot: true       // 🔒 CLAVE: se comporta como imagen
  });


 
}