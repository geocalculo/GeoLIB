// =======================================
// graficos.js – Sistema genérico de gráficos Plotly
// =======================================
//
// Espera que mapainfo.html llame a:
//   initCharts(chartData)
//
// donde chartData es un array de objetos como:
//   { sector: 'Energía', estado: 'Aprobado', inversion: 123.4, ... }
//
// =======================================

// ---------- CONFIGURACIÓN DE GRÁFICOS ----------
// chartType: "bar" | "pie"
// orientation sólo aplica a "bar": "h" | "v"

const CHARTS_CONFIG = [
  {
    id: "sector",
    title: "Inversión por sector productivo",
    dimension: "sector",
    chartType: "bar",
    orientation: "h",
  },
  {
    id: "estado_bar",
    title: "Inversión por estado",
    dimension: "estado",
    chartType: "bar",
    orientation: "v",
  },
  {
    id: "estado_pie",
    title: "Participación porcentual por estado",
    dimension: "estado",
    chartType: "pie",
  },
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
};

// ---------- Construcción dinámica de tarjetas ----------

function buildChartCards() {
  const grid = document.getElementById("chartsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  CHARTS_CONFIG.forEach((cfg) => {
    const card = document.createElement("div");
    card.className = "chart-card";

    const h3 = document.createElement("h3");
    h3.textContent = cfg.title;

    const div = document.createElement("div");
    div.id = `chart_${cfg.id}`;
    div.className = "plotly-chart";

    card.appendChild(h3);
    card.appendChild(div);
    grid.appendChild(card);

    cfg.containerId = div.id;
  });
}

// ---------- Render y filtros ----------

function renderAllCharts() {
  CHARTS_CONFIG.forEach((cfg) => renderChart(cfg));
}

function renderChart(cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) return;

  // 1) Aplicar filtros activos
  const filtered = fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue;
      const rowVal = (row[dim] || "Sin dato").toString();
      if (rowVal !== val) return false;
    }
    return true;
  });

  // 2) Agrupar por dimensión (sector, estado, etc.)
  const groups = new Map();
  filtered.forEach((row) => {
    const key = (row[cfg.dimension] || "Sin dato").toString() || "Sin dato";
    const inv = Number(row.inversion) || 0;
    groups.set(key, (groups.get(key) || 0) + inv);
  });

  const labels = Array.from(groups.keys());
  const values = labels.map((k) => groups.get(k));

  const selectedValue = activeFilters[cfg.dimension] || null;

  // 3) Construir trace según tipo de gráfico
  let dataTraces;
  let layout = {
    margin: { t: 20, b: 60, l: 60, r: 20 },
  };

  if (cfg.chartType === "pie") {
    dataTraces = [
      {
        type: "pie",
        labels,
        values,
        textinfo: "percent",
        hovertemplate:
          "%{label}<br>%{value:.1f} MMU$ (%{percent})<extra></extra>",
        sort: false,
        marker: {
          line: { color: "#ffffff", width: 1 },
        },
      },
    ];
    layout = {
      ...layout,
      showlegend: true,
    };
  } else {
    // BAR
    const colors = labels.map((cat) =>
      selectedValue === cat ? "rgba(37,99,235,0.9)" : "rgba(191,219,254,1)"
    );

    if (cfg.orientation === "h") {
      dataTraces = [
        {
          type: "bar",
          orientation: "h",
          x: values,
          y: labels,
          marker: { color: colors },
          hovertemplate: "%{y}<br>%{x:.1f} MMU$<extra></extra>",
        },
      ];
      layout = {
        ...layout,
        margin: { t: 20, b: 60, l: 140, r: 20 }, // margen izq grande para ver etiquetas
        xaxis: {
          title: "Inversión (MMU$)",
          automargin: true,
        },
        yaxis: {
          automargin: true,
        },
      };
    } else {
      dataTraces = [
        {
          type: "bar",
          x: labels,
          y: values,
          marker: { color: colors },
          hovertemplate: "%{x}<br>%{y:.1f} MMU$<extra></extra>",
        },
      ];
      layout = {
        ...layout,
        xaxis: {
          automargin: true,
        },
        yaxis: {
          title: "Inversión (MMU$)",
          automargin: true,
        },
      };
    }
  }

  Plotly.newPlot(container, dataTraces, layout, {
    responsive: true,
    displaylogo: false,
  });

  // 4) Click → toggle de filtro en esta dimensión
  container.on("plotly_click", (ev) => {
    if (!ev.points || !ev.points.length) return;
    const pt = ev.points[0];

    let category;
    if (cfg.chartType === "pie") {
      category = pt.label.toString();
    } else if (cfg.orientation === "h") {
      category = pt.y.toString();
    } else {
      category = pt.x.toString();
    }

    const current = activeFilters[cfg.dimension] || null;

    if (current === category) {
      activeFilters[cfg.dimension] = null; // quitar filtro
    } else {
      activeFilters[cfg.dimension] = category; // aplicar filtro
    }

    renderAllCharts();
  });
}
