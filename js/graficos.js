// =======================================
// graficos.js – Sistema genérico de gráficos Plotly
// VERSIÓN MEJORADA + Mobile-first (valores visibles) + Salida texto para KMZ
// =======================================
//
// Espera que mapainfo.html llame a:
//   initCharts(chartData)
//
// chartData: array de objetos como:
//   { sector, estado, inversionMm, anio, tipo, ... }
//
// =======================================

// ---------- Colores por estado ----------
function getEstadoColor(label) {
  const txt = (label || "").toString().toLowerCase();

  if (txt.includes("aprob")) return "rgba(34,197,94,0.9)";     // verde
  if (txt.includes("rech"))  return "rgba(239,68,68,0.9)";     // rojo
  if (txt.includes("calif") || txt.includes("eval")) return "rgba(234,179,8,0.9)"; // amarillo

  return "rgba(148,163,184,0.9)"; // slate
}

// ---------- Helpers números (mobile-friendly) ----------
function fmtNumber(val, isCount) {
  if (!Number.isFinite(val)) return isCount ? "0" : "0.0";
  if (isCount) return Math.round(val).toString();

  // inversión (MMU$) con 1 decimal
  return (Math.round(val * 10) / 10).toFixed(1);
}

// abreviación para textos si se quiere (por ahora conservador)
function fmtCompact(val, isCount) {
  if (!Number.isFinite(val)) return isCount ? "0" : "0.0";
  if (isCount) return Math.round(val).toString();

  // compact en MMU$: 1200.0 -> 1.2k (opcional)
  const abs = Math.abs(val);
  if (abs >= 1000) return (val / 1000).toFixed(1) + "k";
  return (Math.round(val * 10) / 10).toFixed(1);
}

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

function getMetricDelta(row, metric) {
  if ((metric || "sum") === "count") return 1;

  const inv = Number(row.inversionMm ?? row.inversion ?? row.inversion_mmus ?? 0);
  if (!Number.isFinite(inv)) return 0;
  return inv;
}

// ---------- CONFIGURACIÓN DE GRÁFICOS ----------
const CHARTS_CONFIG = [
  // FILA 1: Sector
  { id: "inv_sector_bar",   title: "Inversión vs sector productivo",   dimension: "sector", chartType: "bar", orientation: "h", metric: "sum" },
  { id: "count_sector_bar", title: "# Proyectos vs sector productivo", dimension: "sector", chartType: "bar", orientation: "h", metric: "count" },

  // FILA 2: Estado
  { id: "inv_estado_bar",   title: "Inversión vs estado",   dimension: "estado", chartType: "bar", orientation: "h", metric: "sum" },
  { id: "count_estado_bar", title: "# Proyectos vs estado", dimension: "estado", chartType: "bar", orientation: "h", metric: "count" },

  // FILA 3: Tipo DIA/EIA
  { id: "inv_tipo_bar",   title: "Inversión vs tipo (DIA/EIA)",   dimension: "tipo", chartType: "bar", orientation: "h", metric: "sum" },
  { id: "count_tipo_bar", title: "# Proyectos vs tipo (DIA/EIA)", dimension: "tipo", chartType: "bar", orientation: "h", metric: "count" },

  // FILA 4: Año
  { id: "inv_anio_bar",   title: "Inversión vs año",   dimension: "anio", chartType: "bar", orientation: "v", metric: "sum",   xTickAngle: 0 },
  { id: "count_anio_bar", title: "# Proyectos vs año", dimension: "anio", chartType: "bar", orientation: "v", metric: "count", xTickAngle: 0 },

  // FILA 5: Estado (torta)
  { id: "inv_estado_pie",   title: "Inversión vs estado (torta)",   dimension: "estado", chartType: "pie", metric: "sum" },
  { id: "count_estado_pie", title: "# Proyectos vs estado (torta)", dimension: "estado", chartType: "pie", metric: "count" }
];

// ---------- ESTADO GLOBAL ----------
let fullData = [];
let activeFilters = {}; // { dimension: valorSeleccionado | null }

// Expuesto globalmente
window.initCharts = function initCharts(data) {
  fullData = Array.isArray(data) ? data : [];
  activeFilters = {};
  buildChartCards();
  renderAllCharts();
  updateFilterIndicators();
};

// Limpiar todos los filtros
window.clearAllFilters = function clearAllFilters() {
  activeFilters = {};
  renderAllCharts();
  updateFilterIndicators();
};

// ========================================
// ✅ Salida texto simple para KMZ (Top 3 + resumen)
// ========================================

// devuelve data ya filtrada según activeFilters (ojo: sector no debería filtrar, pero lo respetamos si existiera)
function getFilteredRows() {
  return fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue;

      let rowVal = normalizeKey(row[dim], dim);
      if (rowVal === null) return false;
      if (rowVal !== val) return false;
    }
    return true;
  });
}

function buildGroups(rows, dimension, metric) {
  const g = new Map();
  rows.forEach((row) => {
    const key = normalizeKey(row[dimension], dimension);
    if (key === null) return;

    const delta = getMetricDelta(row, metric);
    if (!Number.isFinite(delta)) return;

    g.set(key, (g.get(key) || 0) + delta);
  });
  return g;
}

function topNFromGroups(groupsMap, n = 3) {
  return Array.from(groupsMap.entries())
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, n);
}

// 👉 Función principal para balloon
window.getKmlBalloonSummaryText = function getKmlBalloonSummaryText(opts = {}) {
  const rows = Array.isArray(opts.data) ? opts.data : fullData;
  const radiusM = opts.radiusM;
  const center = opts.center; // {lat, lon}

  // Top3 Estado (count) + Top3 Sector (count) + opcional inversión top
  const gEstadoCount = buildGroups(rows, "estado", "count");
  const gSectorCount = buildGroups(rows, "sector", "count");
  const gEstadoInv   = buildGroups(rows, "estado", "sum");
  const gSectorInv   = buildGroups(rows, "sector", "sum");

  const topEstadoCount = topNFromGroups(gEstadoCount, 3);
  const topSectorCount = topNFromGroups(gSectorCount, 3);
  const topEstadoInv   = topNFromGroups(gEstadoInv, 3);
  const topSectorInv   = topNFromGroups(gSectorInv, 3);

  const total = rows.length;

  const lines = [];
  lines.push("RESUMEN");
  lines.push(`• Proyectos en radio: ${total}`);
  if (Number.isFinite(radiusM)) lines.push(`• Radio: ${Math.round(radiusM)} m`);
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
    lines.push(`• Centro: ${center.lat.toFixed(6)}, ${center.lon.toFixed(6)}`);
  }

  lines.push("");
  lines.push("TOP 3 ESTADO (por # proyectos)");
  if (topEstadoCount.length === 0) lines.push("• Sin datos");
  topEstadoCount.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtNumber(v, true)}`));

  lines.push("");
  lines.push("TOP 3 SECTOR (por # proyectos)");
  if (topSectorCount.length === 0) lines.push("• Sin datos");
  topSectorCount.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtNumber(v, true)}`));

  // Si quieres incluir inversión, queda ultra legible:
  lines.push("");
  lines.push("TOP 3 ESTADO (por inversión MMU$)");
  if (topEstadoInv.length === 0) lines.push("• Sin datos");
  topEstadoInv.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtCompact(v, false)} MMU$`));

  lines.push("");
  lines.push("TOP 3 SECTOR (por inversión MMU$)");
  if (topSectorInv.length === 0) lines.push("• Sin datos");
  topSectorInv.forEach(([k, v], i) => lines.push(`• ${i + 1}) ${k}: ${fmtCompact(v, false)} MMU$`));

  // Links opcionales (si mapainfo.js los pasa)
  if (opts.links && (opts.links.geoeva || opts.links.geoipt)) {
    lines.push("");
    lines.push("LINKS");
    if (opts.links.geoeva) lines.push(`• GeoEVA: ${opts.links.geoeva}`);
    if (opts.links.geoipt) lines.push(`• GeoIPT: ${opts.links.geoipt}`);
  }

  return lines.join("\n");
};

// ========================================
// Construcción dinámica de tarjetas
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
        to   { opacity: 1; transform: translateY(0); }
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

      .filter-badge:hover { background: #2563eb; transform: scale(1.05); }
      .filter-badge::after { content: '×'; font-size: 0.9rem; font-weight: bold; margin-left: 0.2rem; }

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

      .chart-card:hover::before { opacity: 1; }
      .chart-card.filtered::before { display: none; }

      @media (max-width: 768px) { .chart-card::before { display: none; } }
    `;
    document.head.appendChild(style);
  }
}

// Indicadores visuales
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

// Render
function renderAllCharts() {
  CHARTS_CONFIG.forEach((cfg) => renderChart(cfg));
}

function renderChart(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  // 0) Categorías globales (estructura estable)
  const allCategories = Array.from(
    new Set(
      fullData
        .map((row) => normalizeKey(row[cfg.dimension], cfg.dimension))
        .filter((v) => v !== null)
    )
  );

  // 1) Aplicar filtros activos (múltiples)
  const filtered = getFilteredRows();
  const hasData = filtered.length > 0;

  // 2) Agrupar
  const groups = buildGroups(filtered, cfg.dimension, cfg.metric);

  // 3) Labels
  let labels;
  if (cfg.dimension === "anio") {
    labels = allCategories
      .filter((v) => /^\d{4}$/.test(v))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  } else {
    labels = allCategories.slice().sort();
  }

  const values = labels.map((cat) => groups.get(cat) || 0);

  const isCount = (cfg.metric || "sum") === "count";
  const xTitleDefault = isCount ? "# Proyectos" : "Inversión (MMU$)";
  const yTitleDefault = isCount ? "# Proyectos" : "Inversión (MMU$)";

  // 4) Layout base
  let layout = {
    margin: { t: 20, b: 60, l: 60, r: 20 }
  };

  if (!hasData) {
    layout.annotations = [{
      text: "Sin datos para<br>los filtros seleccionados",
      xref: "paper", yref: "paper",
      x: 0.5, y: 0.5,
      xanchor: "center", yanchor: "middle",
      showarrow: false,
      font: { size: 14, color: "#9ca3af" }
    }];
  }

  let dataTraces;

  if (cfg.chartType === "pie") {
    const pieLabels = Array.from(groups.keys());
    const pieValues = pieLabels.map((k) => groups.get(k));

    const pieColors =
      cfg.dimension === "estado"
        ? pieLabels.map((cat) => getEstadoColor(cat))
        : undefined;

    if (pieLabels.length === 0) {
      dataTraces = [{
        type: "pie",
        labels: ["Sin datos"],
        values: [1],
        textinfo: "none",
        hoverinfo: "none",
        marker: { colors: ["#f3f4f6"], line: { color: "#ffffff", width: 1 } }
      }];
    } else {
      dataTraces = [{
        type: "pie",
        labels: pieLabels,
        values: pieValues,
        // Mobile: mostrar % pero el valor queda en tooltip (siempre útil en desktop)
        textinfo: "percent",
        hovertemplate: isCount
          ? "%{label}<br>%{value:.0f} proyectos (%{percent})<extra></extra>"
          : "%{label}<br>%{value:.1f} MMU$ (%{percent})<extra></extra>",
        sort: false,
        marker: { colors: pieColors, line: { color: "#ffffff", width: 1 } }
      }];
    }

    layout = { ...layout, showlegend: true };
  } else {
    // ---------- BARRAS ----------
    // Colores con atenuación si la dimensión está filtrada
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

    // ✅ NUEVO: textos visibles (sin hover)
    const textVals = values.map((v) => (isCount ? fmtNumber(v, true) : fmtNumber(v, false)));

    if (cfg.orientation === "h") {
      dataTraces = [{
        type: "bar",
        orientation: "h",
        x: values,
        y: labels,
        marker: { color: colors },
        text: textVals,
        textposition: "auto",
        cliponaxis: false,
        hovertemplate: isCount
          ? "%{y}<br>%{x:.0f} proyectos<extra></extra>"
          : "%{y}<br>%{x:.1f} MMU$<extra></extra>"
      }];

      layout = {
        ...layout,
        margin: { t: 20, b: 60, l: 160, r: 20 },
        xaxis: { title: xTitleDefault, automargin: true },
        yaxis: { automargin: true }
      };
    } else {
      const tickAngle = typeof cfg.xTickAngle === "number" ? cfg.xTickAngle : 0;

      dataTraces = [{
        type: "bar",
        x: labels,
        y: values,
        marker: { color: colors },
        text: textVals,
        textposition: "auto",
        cliponaxis: false,
        hovertemplate: isCount
          ? "%{x}<br>%{y:.0f} proyectos<extra></extra>"
          : "%{x}<br>%{y:.1f} MMU$<extra></extra>"
      }];

      layout = {
        ...layout,
        xaxis: {
          title: cfg.dimension === "anio" ? "Año" : cfg.dimension,
          automargin: true,
          tickangle: tickAngle,
          type: cfg.dimension === "anio" ? "category" : undefined
        },
        yaxis: { title: yTitleDefault, automargin: true }
      };
    }
  }

  Plotly.newPlot(container, dataTraces, layout, {
    responsive: true,
    displaylogo: false
  });

  // 5) Click → toggle filtro
  container.removeAllListeners?.("plotly_click"); // por si se re-renderiza (evita duplicación)

  container.on("plotly_click", (ev) => {
    if (!ev.points || !ev.points.length) return;

    // ✅ REQ: quitar filtro por sector
    if (cfg.dimension === "sector") return;

    const pt = ev.points[0];
    let category;

    if (cfg.chartType === "pie") {
      category = pt.label?.toString();
      if (!category || category === "Sin datos") return;
    } else if (cfg.orientation === "h") {
      category = pt.y?.toString();
    } else {
      category = pt.x?.toString();
    }

    if (!category) return;

    const current = activeFilters[cfg.dimension] || null;

    if (current === category) delete activeFilters[cfg.dimension];
    else activeFilters[cfg.dimension] = category;

    renderAllCharts();
    updateFilterIndicators();
  });
}
