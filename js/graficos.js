// =======================================
// graficos.js – Sistema genérico de gráficos Plotly
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
    dimension: "anio",      // usa el año corregido desde columna R
    chartType: "bar",
    orientation: "v",       // barras verticales
    xTickAngle: 0           // cambiar a 45 si quieres texto inclinado
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

    // guardar id real en la config
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

          if (keyRaw === undefined || keyRaw === null || keyRaw === "") {
            return "Sin dato";
          }
          return keyRaw.toString();
        })
        .filter((v) => v !== null)
    )
  );

  // 1) Aplicar filtros activos (sobre fullData)
  const filtered = fullData.filter((row) => {
    for (const dim in activeFilters) {
      const val = activeFilters[dim];
      if (!val) continue;
      const rowVal = (row[dim] || "Sin dato").toString();
      if (rowVal !== val) return false;
    }
    return true;
  });

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
      keyRaw === undefined || keyRaw === null || keyRaw === ""
        ? "Sin dato"
        : keyRaw.toString();

    // valor de inversión: prioriza inversionMm
    const inv = Number(
      row.inversionMm ?? row.inversion ?? row.inversion_mmus ?? 0
    );
    if (!Number.isFinite(inv)) return;

    groups.set(key, (groups.get(key) || 0) + inv);
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

  // 4) Construir trace según tipo de gráfico
  let dataTraces;
  let layout = {
    margin: { t: 20, b: 60, l: 60, r: 20 }
  };

  if (cfg.chartType === "pie") {
    // En la torta SÍ dejamos solo las categorías filtradas (nueva forma)
    const pieLabels = Array.from(groups.keys());
    const pieValues = pieLabels.map((k) => groups.get(k));

    const pieColors =
      cfg.dimension === "estado"
        ? pieLabels.map((cat) => getEstadoColor(cat))
        : undefined;

    dataTraces = [
      {
        type: "pie",
        labels: pieLabels,
        values: pieValues,
        textinfo: "percent",
        hovertemplate:
          "%{label}<br>%{value:.1f} MMU$ (%{percent})<extra></extra>",
        sort: false,
        marker: {
          colors: pieColors,
          line: { color: "#ffffff", width: 1 }
        }
      }
    ];
    layout = {
      ...layout,
      showlegend: true
    };
  } else {
    // ---------- BARRAS ----------
    // Colores con atenuación para categorías NO seleccionadas en ESTE gráfico
    let colors;

    if (cfg.dimension === "estado") {
      colors = labels.map((cat) => {
        const selectedDimValue = activeFilters.estado || null;
        const base = getEstadoColor(cat);
        if (!selectedDimValue || selectedDimValue === cat) {
          // sin filtro en esta dimensión o categoría seleccionada
          return base;
        }
        // atenuar
        return base.replace("0.9", "0.2");
      });
    } else {
      colors = labels.map((cat) => {
        const dim = cfg.dimension;
        const selectedDimValue = activeFilters[dim] || null;
        const strong = "rgba(191,219,254,1)";
        const soft = "rgba(191,219,254,0.2)";
        if (!selectedDimValue || selectedDimValue === cat) {
          return strong;
        }
        return soft;
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
          hovertemplate: "%{y}<br>%{x:.1f} MMU$<extra></extra>"
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
          hovertemplate: "%{x}<br>%{y:.1f} MMU$<extra></extra>"
        }
      ];

      const tickAngle =
        typeof cfg.xTickAngle === "number" ? cfg.xTickAngle : 0;

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

  // 5) Click → toggle de filtro en esta dimensión
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
