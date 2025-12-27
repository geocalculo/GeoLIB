// =======================================
// graficos.js – Sistema genérico de gráficos Plotly
// VERSIÓN MEJORADA con filtros múltiples e indicadores visuales
// =======================================
//
// Espera que mapainfo.html llame a:
//   initCharts(chartData)
//
// donde chartData es un array de objetos como:
//   {
//     sector: 'Energía',
//     estado: 'Aprobado',
//     inversionMm: 123.4,
//     anio: 2021,
//     ... (otros campos)
//   }
//
// =======================================

// ---------- Colores por estado ----------

function getEstadoColor(label) {
  const txt = (label || "").toString().toLowerCase();

  if (txt.includes("aprob")) {
    // Aprobado → verde
    return "rgba(34,197,94,0.9)"; // green-500
  }
  if (txt.includes("rech")) {
    // Rechazado → rojo
    return "rgba(239,68,68,0.9)"; // red-500
  }
  if (txt.includes("calif") || txt.includes("eval")) {
    // En calificación / evaluación → amarillo
    return "rgba(234,179,8,0.9)"; // yellow-400
  }

  // Otros estados
  return "rgba(148,163,184,0.9)"; // slate-400
}

// ---------- CONFIGURACIÓN DE GRÁFICOS ----------
// chartType: "bar" | "pie"
// orientation (sólo para "bar"): "h" | "v"
// xTickAngle (opcional): ángulo del texto eje X en barras verticales

// ---------- CONFIGURACIÓN DE GRÁFICOS ----------
// chartType: "bar" | "pie"
// orientation (sólo para "bar"): "h" | "v"
// metric: "sum" (inversión) | "count" (#proyectos)

const CHARTS_CONFIG = [
  // =========================
  // FILA 1: Sector (barra horizontal)
  // =========================
  {
    id: "inv_sector_bar",
    title: "Inversión vs sector productivo",
    dimension: "sector",
    chartType: "bar",
    orientation: "h",
    metric: "sum"
  },
  {
    id: "count_sector_bar",
    title: "# Proyectos vs sector productivo",
    dimension: "sector",
    chartType: "bar",
    orientation: "h",
    metric: "count"
  },

  // =========================
  // FILA 2: Estado (barra horizontal)
  // =========================
  {
    id: "inv_estado_bar",
    title: "Inversión vs estado",
    dimension: "estado",
    chartType: "bar",
    orientation: "h",
    metric: "sum"
  },
  {
    id: "count_estado_bar",
    title: "# Proyectos vs estado",
    dimension: "estado",
    chartType: "bar",
    orientation: "h",
    metric: "count"
  },

  // =========================
  // FILA 3: Tipo DIA/EIA (barra horizontal)
  // =========================
  {
    id: "inv_tipo_bar",
    title: "Inversión vs tipo (DIA/EIA)",
    dimension: "tipo",
    chartType: "bar",
    orientation: "h",
    metric: "sum"
  },
  {
    id: "count_tipo_bar",
    title: "# Proyectos vs tipo (DIA/EIA)",
    dimension: "tipo",
    chartType: "bar",
    orientation: "h",
    metric: "count"
  },

  // =========================
  // FILA 4: Año (barra vertical)
  // =========================
  {
    id: "inv_anio_bar",
    title: "Inversión vs año",
    dimension: "anio",
    chartType: "bar",
    orientation: "v",
    metric: "sum",
    xTickAngle: 0
  },
  {
    id: "count_anio_bar",
    title: "# Proyectos vs año",
    dimension: "anio",
    chartType: "bar",
    orientation: "v",
    metric: "count",
    xTickAngle: 0
  },

  // =========================
  // FILA 5: Estado (torta)
  // =========================
  {
    id: "inv_estado_pie",
    title: "Inversión vs estado (torta)",
    dimension: "estado",
    chartType: "pie",
    metric: "sum"
  },
  {
    id: "count_estado_pie",
    title: "# Proyectos vs estado (torta)",
    dimension: "estado",
    chartType: "pie",
    metric: "count"
  }
];

// ---------- ESTADO GLOBAL ----------

let fullData = [];
let activeFilters = {}; // { dimension: valorSeleccionado | null }

// Expuesto globalmente para mapainfo.html
window.initCharts = function initCharts(data) {
  fullData = Array.isArray(data) ? data : [];
  activeFilters = {};
  buildChartCards();
  renderAllCharts();
  updateFilterIndicators();
};

// ========================================
// NUEVA FUNCIONALIDAD: Limpiar todos los filtros
// ========================================
window.clearAllFilters = function clearAllFilters() {
  activeFilters = {};
  renderAllCharts();
  updateFilterIndicators();
};

// ---------- Construcción dinámica de tarjetas ----------

function buildChartCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  grid.innerHTML = "";



  CHARTS_CONFIG.forEach((cfg, index) => {
    const card = document.createElement("div");
    card.className = "chart-card";
    card.id = `card_${cfg.id}`;
    
    // ✨ NUEVO: Animación de entrada escalonada
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

    // guardar id real en la config
    cfg.containerId = div.id;
    cfg.cardId = card.id;
  });

  // ✨ NUEVO: Agregar estilos de animación al head si no existen
  if (!document.getElementById('chart-animations-style')) {
    const style = document.createElement('style');
    style.id = 'chart-animations-style';
    style.textContent = `
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
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

// ========================================
// NUEVA FUNCIONALIDAD: Indicadores visuales de filtros
// ========================================

function updateFilterIndicators() {
  CHARTS_CONFIG.forEach(cfg => {
    const card = document.getElementById(cfg.cardId);
    if (!card) return;

    const hasFilter = activeFilters[cfg.dimension];
    
    if (hasFilter) {
      card.classList.add('filtered');
      
      // Agregar badge si no existe
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
}

// ---------- Render y filtros ----------

function renderAllCharts() {
  CHARTS_CONFIG.forEach((cfg) => renderChart(cfg));
}

function renderChart(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  // 0) Categorías globales (todas, para que no cambie la estructura)
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

          // ✨ MEJORADO: Normalizar valores vacíos
          if (keyRaw === undefined || keyRaw === null || 
              String(keyRaw).trim() === "") {
            return "Sin dato";
          }
          return keyRaw.toString().trim();
        })
        .filter((v) => v !== null)
    )
  );

  // 1) ✨ MEJORADO: Aplicar TODOS los filtros activos (múltiples dimensiones)
  const filtered = fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue; // Skip si el filtro es null
      
      let rowVal = row[dim];
      
      // Normalizar el valor de la fila
      if (rowVal === undefined || rowVal === null || 
          String(rowVal).trim() === "") {
        rowVal = "Sin dato";
      } else {
        rowVal = rowVal.toString().trim();
      }
      
      // Si no coincide con el filtro, excluir esta fila
      if (rowVal !== val) return false;
    }
    return true;
  });

  // ✨ NUEVO: Verificar si hay datos después de filtrar
  const hasData = filtered.length > 0;

  // 2) Agrupar por dimensión (sector, estado, año, etc.) usando SOLO datos filtrados
  const groups = new Map();

  filtered.forEach((row) => {
    let keyRaw = row[cfg.dimension];

    // --- Tratamiento especial para AÑO ---
    if (cfg.dimension === "anio") {
      if (keyRaw == null || keyRaw === "") return;
      const anioNum = parseInt(keyRaw, 10);
      if (!Number.isFinite(anioNum)) return;
      keyRaw = String(anioNum); // guardamos como STRING
    }

    let key =
      keyRaw === undefined || keyRaw === null || String(keyRaw).trim() === ""
        ? "Sin dato"
        : keyRaw.toString().trim();

        // MÉTRICA: suma inversión o conteo
    let delta = 0;

    if ((cfg.metric || "sum") === "count") {
      delta = 1;
    } else {
      // suma inversión
      const inv = Number(row.inversionMm ?? row.inversion ?? row.inversion_mmus ?? 0);
      if (!Number.isFinite(inv)) return;
      delta = inv;
    }

    groups.set(key, (groups.get(key) || 0) + delta);

    const prev = groups.get(key) || 0;


  });

  // 3) Labels: TODAS las categorías globales (para que no cambien)
  let labels;

  if (cfg.dimension === "anio") {
    labels = allCategories
      .filter((v) => /^\d{4}$/.test(v)) // solo años bien formados
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  } else {
    labels = allCategories.slice().sort();
  }

  const values = labels.map((cat) => groups.get(cat) || 0);

  const isCount = (cfg.metric || "sum") === "count";
  const xTitleDefault = isCount ? "# Proyectos" : "Inversión (MMU$)";
  const yTitleDefault = isCount ? "# Proyectos" : "Inversión (MMU$)";


  // 4) Construir trace según tipo de gráfico
  let dataTraces;
  let layout = {
    margin: { t: 20, b: 60, l: 60, r: 20 }
  };

  // ✨ NUEVO: Mensaje cuando no hay datos
  if (!hasData) {
    layout.annotations = [{
      text: 'Sin datos para<br>los filtros seleccionados',
      xref: 'paper',
      yref: 'paper',
      x: 0.5,
      y: 0.5,
      xanchor: 'center',
      yanchor: 'middle',
      showarrow: false,
      font: {
        size: 14,
        color: '#9ca3af'
      }
    }];
  }

  if (cfg.chartType === "pie") {
    // En la torta SÍ dejamos solo las categorías filtradas (nueva forma)
    const pieLabels = Array.from(groups.keys());
    const pieValues = pieLabels.map((k) => groups.get(k));

    const pieColors =
      cfg.dimension === "estado"
        ? pieLabels.map((cat) => getEstadoColor(cat))
        : undefined;

    // ✨ MEJORADO: Manejar torta vacía
    if (pieLabels.length === 0) {
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
      dataTraces = [
        {
          type: "pie",
          labels: pieLabels,
          values: pieValues,
          textinfo: "percent",

          hovertemplate: isCount
            ? "%{label}<br>%{value:.0f} proyectos (%{percent})<extra></extra>"
            : "%{label}<br>%{value:.1f} MMU$ (%{percent})<extra></extra>",


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
    // ---------- BARRAS ----------
    // ✨ MEJORADO: Colores con atenuación SOLO para categorías no seleccionadas en ESTA dimensión
    let colors;

    if (cfg.dimension === "estado") {
      colors = labels.map((cat) => {
        const selectedDimValue = activeFilters[cfg.dimension] || null;
        const base = getEstadoColor(cat);
        
        // Si HAY filtro en esta dimensión y NO es esta categoría → atenuar
        if (selectedDimValue && selectedDimValue !== cat) {
          return base.replace("0.9", "0.2");
        }
        // Sin filtro o es la categoría seleccionada → color completo
        return base;
      });
    } else {
      colors = labels.map((cat) => {
        const selectedDimValue = activeFilters[cfg.dimension] || null;
        const strong = "rgba(59,130,246,0.9)"; // blue-500
        const soft = "rgba(59,130,246,0.2)";
        
        // Si HAY filtro en esta dimensión y NO es esta categoría → atenuar
        if (selectedDimValue && selectedDimValue !== cat) {
          return soft;
        }
        // Sin filtro o es la categoría seleccionada → color completo
        return strong;
      });
    }

    if (cfg.orientation === "h") {
      // Barras horizontales
      dataTraces = [
        {
          type: "bar",
          orientation: "h",
          x: values,
          y: labels,
          marker: { color: colors },
          hovertemplate: isCount
          ? "%{y}<br>%{x:.0f} proyectos<extra></extra>"
          : "%{y}<br>%{x:.1f} MMU$<extra></extra>"

        }
      ];
      layout = {
        ...layout,
        margin: { t: 20, b: 60, l: 160, r: 20 }, // margen izq grande
        xaxis: {
          title:
            cfg.id === "sector" || cfg.id === "estado_bar"
              ? "Inversión (MMU$)"
              : undefined,
          automargin: true
        },
        yaxis: {
          automargin: true
        }
      };
    } else {
      // Barras verticales
      dataTraces = [
        {
          type: "bar",
          x: labels,
          y: values,
          marker: { color: colors },
          hovertemplate: isCount
          ? "%{x}<br>%{y:.0f} proyectos<extra></extra>"
          : "%{x}<br>%{y:.1f} MMU$<extra></extra>"

        }
      ];

      const tickAngle =
        typeof cfg.xTickAngle === "number" ? cfg.xTickAngle : 0;

      layout = {
        ...layout,
        xaxis: {
          title: xTitleDefault,
          automargin: true,
          tickangle: tickAngle,
          type: cfg.dimension === "anio" ? "category" : undefined
        },
        yaxis: {
          title: yTitleDefault,
          automargin: true
        }
      };
    }
  }

  Plotly.newPlot(container, dataTraces, layout, {
    responsive: true,
    displaylogo: false
  });

  // 5) ✨ MEJORADO: Click → toggle de filtro en esta dimensión
  container.on("plotly_click", (ev) => {
    if (!ev.points || !ev.points.length) return;
    const pt = ev.points[0];

    let category;
    if (cfg.chartType === "pie") {
      category = pt.label.toString();
      // No permitir clic en "Sin datos"
      if (category === "Sin datos") return;
    } else if (cfg.orientation === "h") {
      category = pt.y.toString();
    } else {
      category = pt.x.toString();
    }

    const current = activeFilters[cfg.dimension] || null;

    if (current === category) {
      // Si ya está filtrado por esta categoría → quitar filtro
      delete activeFilters[cfg.dimension];
    } else {
      // Aplicar/cambiar filtro a esta categoría
      activeFilters[cfg.dimension] = category;
    }

    renderAllCharts();
    updateFilterIndicators(); // ✨ NUEVO: Actualizar indicadores visuales
  });
}