// js/report/reportModel.js
// Construye un modelo estándar para UI + export a partir del output del engine.

import { parseNumber } from "../core/utils.js";

export function buildReportModel({ engineOutput, meta = {} } = {}) {
  if (!engineOutput || !engineOutput.query) {
    throw new Error("buildReportModel: engineOutput inválido.");
  }

  const { query, projects = [], stats = {} } = engineOutput;

  // Total inversión (leer de forma robusta: inversionMm o inversion)
  const invTotal =
    stats?.inv
      ? Object.values(stats.inv).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
      : projects.reduce((acc, p) => {
          const inv = Number.isFinite(p.inversionMm)
            ? p.inversionMm
            : (Number.isFinite(p.inversion) ? p.inversion : 0);
          return acc + inv;
        }, 0);

  // Helper: toma el primer número válido desde una lista de posibles campos
  function pickNumber(p, keys) {
    for (const k of keys) {
      const v = p?.[k];
      if (Number.isFinite(v)) return v;
      const n = parseNumber(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  // Normalizar proyectos para consumo consistente
  const items = projects.map((p) => {
    // Inversión robusta
    const inversion = Number.isFinite(p.inversionMm)
      ? p.inversionMm
      : (Number.isFinite(p.inversion) ? p.inversion : parseNumber(p.inversion) || 0);

    // Plazo en meses robusto (ajusta/expande claves según tu engine)
    const plazoMeses = pickNumber(p, [
      "plazoMeses",
      "plazo_meses",
      "plazoMes",
      "meses",
      "duracionMeses",
      "duracion_meses",
      "plazo", // por si el engine lo llama así
    ]);

    return {
      id: p.id,
      nombre: p.nombre || "",
      estado: p.estado || "",
      sector: p.sector || "",
      region: p.region || "",
      tipo: p.tipo || "",
      web: p.web || "",
      anexos: p.anexos || "",
      fechaIngreso: p.fechaIngreso || "",
      anio: p.anio ?? null,

      inversion,
      inversionMm: inversion, // Alias para gráficos

      // ✅ NUEVO: plazo en meses (número o null)
      plazoMeses,

      lat: p.lat,
      lon: p.lon,
      distKm: p.distKm,
      bucket: p.bucket || "Otros",
      isTopN: !!p.isTopN,
    };
  });

  return {
    meta,
    query,
    stats: {
      ...stats,
      invTotal,
      totalProjects: items.length,
    },
    projects: items,
  };
}
