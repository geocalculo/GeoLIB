// js/report/reportModel.js
// Construye un modelo estándar para UI + export a partir del output del engine.

import { parseNumber } from "../core/utils.js";

export function buildReportModel({ engineOutput, meta = {} } = {}) {
  if (!engineOutput || !engineOutput.query) {
    throw new Error("buildReportModel: engineOutput inválido.");
  }

  const { query, projects = [], stats = {} } = engineOutput;

  // total inversión (si viene en stats.inv o la recalculamos)
  const invTotal =
    stats?.inv
      ? Object.values(stats.inv).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
      : projects.reduce((acc, p) => acc + (Number.isFinite(p.inversion) ? p.inversion : 0), 0);

  // normalizar proyectos para consumo consistente
  const items = projects.map((p) => ({
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
    inversion: Number.isFinite(p.inversion) ? p.inversion : parseNumber(p.inversion) || 0,
    lat: p.lat,
    lon: p.lon,
    distKm: p.distKm,
    bucket: p.bucket || "Otros",
    isTopN: !!p.isTopN,
  }));

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
