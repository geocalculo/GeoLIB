// =======================================
// graficos-enhanced.js – Sistema de gráficos con highlighting en mapa
// VERSIÓN A++ con comunicación bidireccional
// =======================================

// ---------- Colores por estado ----------

function getEstadoColor(label) {
  const txt = (label || "").toString().toLowerCase();

  if (txt.includes("aprob")) {
    return "rgba(34,197,94,0.9)";
  }
  if (txt.includes("rech")) {
    return "rgba(239,68,68,0.9)";
  }
  if (txt.includes("calif") || txt.includes("eval")) {
    return "rgba(234,179,8,0.9)";
  }

  return "rgba(148,163,184,0.9)";
}

// ---------- CONFIGURACIÓN DE GRÁFICOS ----------

const CHARTS_CONFIG = [
  {
    id: "sector",
    title: "Inversión por sector productivo",
    dimension: "sector",
    chartType: "bar",
    orientation: "h"
  },
  {
    id: "estado_bar",
    title: "Inversión por estado",
    dimension: "estado",
    chartType: "bar",
    orientation: "h"
  },
  {
    id: "estado_pie",
    title: "Participación porcentual por estado",
    dimension: "estado",
    chartType: "pie"
  },
  {
    id: "inv_por_anio",
    title: "Inversión por año",
    dimension: "anio",
    chartType: "bar",
    orientation: "v",
    xTickAngle: 0
  }
];

// ---------- ESTADO GLOBAL ----------

let fullData = [];
let activeFilters = {};

// ==============================
// ✨ COMUNICACIÓN CON EL MAPA
// ==============================

function notifyMapFilter(dimension, category) {
  // Verificar que window.highlightMapProjects existe
  if (typeof window.highlightMapProjects !== 'function') {
    console.warn('highlightMapProjects no disponible en el mapa');
    return;
  }

  if (!window.chartDataGlobal) {
    console.warn('chartDataGlobal no disponible');
    return;
  }

  // Filtrar proyectos según la dimensión clickeada
  let filteredProjects = [];
  let filterDescription = '';

  if (dimension === 'sector') {
    filteredProjects = window.chartDataGlobal.filter(p => {
      const sector = p.sector || 'Sin sector';
      return sector === category;
    });
    filterDescription = `Sector: ${category}`;
  } 
  else if (dimension === 'estado') {
    filteredProjects = window.chartDataGlobal.filter(p => {
      const estado = p.estado || 'Otros';
      return estado.toLowerCase().includes(category.toLowerCase());
    });
    filterDescription = `Estado: ${category}`;
  } 
  else if (dimension === 'region') {
    filteredProjects = window.chartDataGlobal.filter(p => {
      const region = p.region || 'Sin región';
      return region === category;
    });
    filterDescription = `Región: ${category}`;
  }
  else if (dimension === 'anio') {
    filteredProjects = window.chartDataGlobal.filter(p => {
      return String(p.anio) === String(category);
    });
    filterDescription = `Año: ${category}`;
  }

  // Convertir a claves únicas (nombre|sector|region)
  const projectKeys = filteredProjects.map(p => 
    `${p.nombre}|${p.sector}|${p.region}`
  );

  console.log(`📊 Filtro aplicado: ${filterDescription}, ${projectKeys.length} proyectos`);

  // Notificar al mapa
  window.highlightMapProjects(projectKeys, filterDescription);
}

// ==============================
// INICIALIZACIÓN
// ==============================

window.initCharts = function initCharts(data) {
  fullData = Array.isArray(data) ? data : [];
  activeFilters = {};
  buildChartCards();
  renderAllCharts();
  updateFilterIndicators();
  injectStyles();
};

window.clearAllFilters = function clearAllFilters() {
  activeFilters = {};
  renderAllCharts();
  updateFilterIndicators();
  
  // Limpiar highlighting en el mapa
  if (typeof window.highlightMapProjects === 'function') {
    window.highlightMapProjects([], null);
  }
};

// ==============================
// CONSTRUCCIÓN DE CARDS
// ==============================

function buildChartCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  CHARTS_CONFIG.forEach((cfg) => {
    cfg.cardId = `card_${cfg.id}`;
    cfg.containerId = `chart_${cfg.id}`;

    const card = document.createElement("div");
    card.className = "chart-card";
    card.id = cfg.cardId;

    const h3 = document.createElement("h3");
    h3.textContent = cfg.title;

    const chartDiv = document.createElement("div");
    chartDiv.className = "plotly-chart";
    chartDiv.id = cfg.containerId;

    card.appendChild(h3);
    card.appendChild(chartDiv);
    grid.appendChild(card);
  });
}

// ==============================
// ESTILOS DINÁMICOS
// ==============================

function injectStyles() {
  const existingStyle = document.getElementById('graficos-enhanced-styles');
  if (existingStyle) return;

  const style = document.createElement('style');
  style.id = 'graficos-enhanced-styles';
  style.textContent = `
    .chart-card {
      position: relative;
      transition: all 0.3s ease;
      cursor: pointer;
    }

    .chart-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }

    .chart-card.filtered {
      border: 2px solid #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .filter-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 0.7rem;
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-left: 0.5rem;
      animation: badgeAppear 0.3s ease;
    }

    @keyframes badgeAppear {
      from {
        opacity: 0;
        transform: scale(0.8);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .filter-badge:hover {
      background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
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

    /* Indicador de clic en barra */
    .plotly .bar:hover {
      opacity: 0.8;
    }
  `;
  document.head.appendChild(style);
}

// ==============================
// INDICADORES VISUALES
// ==============================

function updateFilterIndicators() {
  CHARTS_CONFIG.forEach(cfg => {
    const card = document.getElementById(cfg.cardId);
    if (!card) return;

    const hasFilter = activeFilters[cfg.dimension];
    
    if (hasFilter) {
      card.classList.add('filtered');
      
      const h3 = card.querySelector('h3');
      let badge = h3.querySelector('.filter-badge');
      
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'filter-badge';
        badge.textContent = 'Filtrado';
        badge.onclick = (e) => {
          e.stopPropagation();
          clearChartFilter(cfg.dimension);
        };
        h3.appendChild(badge);
      }
    } else {
      card.classList.remove('filtered');
      const badge = card.querySelector('.filter-badge');
      if (badge) badge.remove();
    }
  });
}

function clearChartFilter(dimension) {
  delete activeFilters[dimension];
  renderAllCharts();
  updateFilterIndicators();
  
  // Limpiar highlighting en el mapa
  if (typeof window.highlightMapProjects === 'function') {
    window.highlightMapProjects([], null);
  }
}

// ==============================
// RENDER DE GRÁFICOS
// ==============================

function renderAllCharts() {
  CHARTS_CONFIG.forEach((cfg) => renderChart(cfg));
}

function renderChart(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  // Categorías globales
  const allCategories = Array.from(
    new Set(
      fullData
        .map((row) => {
          let keyRaw = row[cfg.dimension];

          if (cfg.dimension === "anio") {
            if (keyRaw == null || keyRaw === "") return null;
            const anioNum = parseInt(keyRaw, 10);
            if (!Number.isFinite(anioNum)) return null;
            return String(anioNum);
          }

          if (keyRaw === undefined || keyRaw === null || 
              String(keyRaw).trim() === "") {
            return "Sin dato";
          }
          return keyRaw.toString().trim();
        })
        .filter((v) => v !== null)
    )
  );

  // Aplicar filtros activos
  const filtered = fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue;

      let rowVal = row[dim];

      if (dim === "anio") {
        if (rowVal == null || rowVal === "") return false;
        const anioNum = parseInt(rowVal, 10);
        if (!Number.isFinite(anioNum)) return false;
        rowVal = String(anioNum);
      } else {
        if (rowVal === undefined || rowVal === null) {
          rowVal = "Sin dato";
        } else {
          rowVal = rowVal.toString().trim();
        }
      }

      if (dim === "estado") {
        if (!rowVal.toLowerCase().includes(val.toLowerCase())) {
          return false;
        }
      } else {
        if (rowVal !== val) {
          return false;
        }
      }
    }
    return true;
  });

  // Agrupar por categoría
  const groups = {};
  allCategories.forEach((cat) => {
    groups[cat] = 0;
  });

  filtered.forEach((row) => {
    let key = row[cfg.dimension];

    if (cfg.dimension === "anio") {
      if (key == null || key === "") return;
      const anioNum = parseInt(key, 10);
      if (!Number.isFinite(anioNum)) return;
      key = String(anioNum);
    } else {
      if (key === undefined || key === null || String(key).trim() === "") {
        key = "Sin dato";
      } else {
        key = key.toString().trim();
      }
    }

    const inv = row.inversionMm;
    if (Number.isFinite(inv)) {
      groups[key] = (groups[key] || 0) + inv;
    }
  });

  let labels = Object.keys(groups);
  let values = labels.map((cat) => groups[cat]);

  // Ordenar
  if (cfg.dimension === "anio") {
    const pairs = labels.map((l, i) => ({ label: l, value: values[i] }));
    pairs.sort((a, b) => {
      const aNum = parseInt(a.label, 10);
      const bNum = parseInt(b.label, 10);
      if (!Number.isFinite(aNum) && !Number.isFinite(bNum)) return 0;
      if (!Number.isFinite(aNum)) return 1;
      if (!Number.isFinite(bNum)) return -1;
      return aNum - bNum;
    });
    labels = pairs.map((p) => p.label);
    values = pairs.map((p) => p.value);
  } else {
    const pairs = labels.map((l, i) => ({ label: l, value: values[i] }));
    pairs.sort((a, b) => b.value - a.value);
    labels = pairs.map((p) => p.label);
    values = pairs.map((p) => p.value);
  }

  // Layout base
  let layout = {
    font: { family: "system-ui, sans-serif", size: 11 },
    margin: { t: 20, b: 40, l: 80, r: 20 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: false,
    hovermode: "closest"
  };

  let dataTraces;

  if (cfg.chartType === "pie") {
    const nonZero = labels
      .map((l, i) => ({ label: l, value: values[i] }))
      .filter((p) => p.value > 0);

    if (nonZero.length === 0) {
      dataTraces = [{
        type: "pie",
        labels: ["Sin datos"],
        values: [1],
        textinfo: "none",
        hoverinfo: "none",
        marker: {
          colors: ['#f3f4f6'],
          line: { color: "#ffffff", width: 1 }
        }
      }];
    } else {
      const pieLabels = nonZero.map((p) => p.label);
      const pieValues = nonZero.map((p) => p.value);
      const pieColors = pieLabels.map((cat) => {
        const selectedDimValue = activeFilters[cfg.dimension] || null;
        const base = getEstadoColor(cat);
        if (selectedDimValue && selectedDimValue !== cat) {
          return base.replace("0.9", "0.3");
        }
        return base;
      });

      dataTraces = [
        {
          type: "pie",
          labels: pieLabels,
          values: pieValues,
          textinfo: "percent",
          hovertemplate: "%{label}<br>%{value:.1f} MMU$ (%{percent})<extra></extra>",
          sort: false,
          marker: {
            colors: pieColors,
            line: { color: "#ffffff", width: 1 }
          }
        }
      ];
    }
    
    layout = {
      ...layout,
      showlegend: true
    };
  } else {
    // Barras
    let colors;

    if (cfg.dimension === "estado") {
      colors = labels.map((cat) => {
        const selectedDimValue = activeFilters[cfg.dimension] || null;
        const base = getEstadoColor(cat);
        
        if (selectedDimValue && selectedDimValue !== cat) {
          return base.replace("0.9", "0.2");
        }
        return base;
      });
    } else {
      colors = labels.map((cat) => {
        const selectedDimValue = activeFilters[cfg.dimension] || null;
        const strong = "rgba(59,130,246,0.9)";
        const soft = "rgba(59,130,246,0.2)";
        
        if (selectedDimValue && selectedDimValue !== cat) {
          return soft;
        }
        return strong;
      });
    }

    if (cfg.orientation === "h") {
      dataTraces = [
        {
          type: "bar",
          orientation: "h",
          x: values,
          y: labels,
          marker: { color: colors },
          hovertemplate: "%{y}<br>%{x:.1f} MMU$<extra></extra>"
        }
      ];
      layout = {
        ...layout,
        margin: { t: 20, b: 60, l: 160, r: 20 },
        xaxis: {
          title: cfg.id === "sector" || cfg.id === "estado_bar"
            ? "Inversión (MMU$)"
            : undefined,
          automargin: true
        },
        yaxis: {
          automargin: true
        }
      };
    } else {
      dataTraces = [
        {
          type: "bar",
          x: labels,
          y: values,
          marker: { color: colors },
          hovertemplate: "%{x}<br>%{y:.1f} MMU$<extra></extra>"
        }
      ];

      const tickAngle = typeof cfg.xTickAngle === "number" ? cfg.xTickAngle : 0;

      layout = {
        ...layout,
        xaxis: {
          title: cfg.id === "inv_por_anio" ? "Año" : undefined,
          automargin: true,
          tickangle: tickAngle,
          type: cfg.dimension === "anio" ? "category" : undefined
        },
        yaxis: {
          title: "Inversión (MMU$)",
          automargin: true
        }
      };
    }
  }

  Plotly.newPlot(container, dataTraces, layout, {
    responsive: true,
    displaylogo: false
  });

  // ✨ EVENTO DE CLICK - COMUNICACIÓN CON MAPA
  container.on("plotly_click", (ev) => {
    if (!ev.points || !ev.points.length) return;
    const pt = ev.points[0];

    let category;
    if (cfg.chartType === "pie") {
      category = pt.label.toString();
      if (category === "Sin datos") return;
    } else if (cfg.orientation === "h") {
      category = pt.y.toString();
    } else {
      category = pt.x.toString();
    }

    const current = activeFilters[cfg.dimension] || null;

    if (current === category) {
      // Quitar filtro
      delete activeFilters[cfg.dimension];
      
      // ✨ Limpiar mapa
      if (typeof window.highlightMapProjects === 'function') {
        window.highlightMapProjects([], null);
      }
    } else {
      // Aplicar filtro
      activeFilters[cfg.dimension] = category;
      
      // ✨ Notificar al mapa
      notifyMapFilter(cfg.dimension, category);
    }

    renderAllCharts();
    updateFilterIndicators();
  });
}