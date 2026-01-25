// js/report/reportModel.js
// Construye un modelo estándar para UI + export a partir del output del engine.
//
// Ajustes:
// - uid: ID interno estable (id_expediente extraído desde web; fallback row-i)
// - id: correlativo 1..N (para mostrar en lista/tooltip dentro del círculo)
// - nombre/titular: normalización robusta (sala de empaque) para desktop/móvil/PDF
// - invTotal y plazoMeses se mantienen

import { parseNumber } from "../core/utils.js";

export function buildReportModel({ engineOutput, meta = {} } = {}) {
  if (!engineOutput || !engineOutput.query) {
    throw new Error("buildReportModel: engineOutput inválido.");
  }

  const { query, projects = [], stats = {} } = engineOutput;

  // Total inversión (leer de forma robusta: inversionMm o inversion)
  const invTotal =
    stats?.inv
      ? Object.values(stats.inv).reduce(
          (a, b) => a + (Number.isFinite(b) ? b : 0),
          0
        )
      : projects.reduce((acc, p) => {
          const inv = Number.isFinite(p.inversionMm)
            ? p.inversionMm
            : Number.isFinite(p.inversion)
              ? p.inversion
              : 0;
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
  const items = projects.map((p, i) => {
    // Inversión robusta
    const inversion = Number.isFinite(p.inversionMm)
      ? p.inversionMm
      : Number.isFinite(p.inversion)
        ? p.inversion
        : parseNumber(p.inversion) || 0;

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

    // ✅ uid interno estable (id_expediente) + fallback
    const m = /id_expediente=(\d+)/.exec(String(p.web || ""));
    const uid = m ? String(m[1]) : `row-${i}`;

    // ✅ id visible 1..N (correlativo en lista/tooltip)
    const id = i + 1;

    // ✅ Sala de empaque: nombre/titular robustos (mismo modelo para desktop/móvil/PDF)
    const nombre = String(p?.nombre ?? p?.proyecto ?? p?.Nombre ?? "").trim() || "";

    const titular =
      String(p?.titular ?? p?.Titular ?? p?.TITULAR ?? "").trim() ||
      String(p?.raw?.titular ?? p?.raw?.Titular ?? p?.raw?.TITULAR ?? "").trim() ||
      String(p?.RAW?.titular ?? p?.RAW?.Titular ?? p?.RAW?.TITULAR ?? "").trim() ||
      "";

    return {
      uid, // ✅ usar este para indexar y seleccionar (Map keys / data-project-id)

      id, // ✅ mostrar 1..N en lista y en el tooltip del mapa
      rank: id, // alias opcional (por si ya usas "rank" en reportes)

      nombre,
      titular,

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

      // ✅ plazo en meses (número o null)
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