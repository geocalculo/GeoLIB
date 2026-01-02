// js/ui/chartsController.js
// Adaptador EXACTO para tu graficos.js (legacy)
// - graficos.js espera: initCharts(Array<Row>)
// - Row debe tener llaves: sector, estado, tipo, anio, inversion

export function updateCharts(model) {
  if (typeof window.initCharts !== "function") return;

  const rows = (model?.projects || []).map((p) => ({
    // ✅ claves EXACTAS que usa graficos.js
    sector: (p.sector ?? "").toString().trim() || "Sin dato",
    estado: (p.estado ?? "").toString().trim() || "Sin dato",
    tipo: (p.tipo ?? "").toString().trim() || "Sin dato",
    anio:
      p.anio != null && String(p.anio).trim() !== ""
        ? String(parseInt(p.anio, 10))
        : "Sin dato",
    inversion: Number.isFinite(p.inversion) ? p.inversion : 0,

    // (extras por si después los usas, no molestan)
    nombre: p.nombre ?? "",
    distKm: Number.isFinite(p.distKm) ? p.distKm : null,
    region: p.region ?? "",
    id: p.id ?? null,
  }));

  // ✅ graficos.js: initCharts(dataArray)
  window.initCharts(rows);

  // Opcional: texto KMZ si tu graficos.js tiene helper
  // (en tu graficos.js existe la sección "Salida texto simple para KMZ")
  // Si allá expones algo como window.getKmzSummaryText, acá lo dejamos disponible.
  if (typeof window.getKmzSummaryText === "function") {
    window.__geoeva_kmz_summary = window.getKmzSummaryText(rows);
  }
}
