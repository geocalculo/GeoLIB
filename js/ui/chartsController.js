// js/ui/chartsController.js
// VERSIÓN DEBUG para diagnosticar problema de meses

import { log, warn } from "../core/logger.js";

export function updateCharts(model) {
  log("=== DEBUG chartsController ===");
  log("model.projects:", model?.projects?.length);
  
  if (typeof window.initCharts !== "function") {
    warn("window.initCharts no disponible - graficos.js no cargado?");
    return;
  }

  // Debug: ver primeros 3 proyectos RAW
  log("Primeros 3 proyectos del modelo:");
  (model?.projects || []).slice(0, 3).forEach((p, i) => {
    log(`  Proyecto ${i}:`, {
      nombre: p.nombre?.substring(0, 40),
      estado: p.estado,
      meses: p.meses,
      plazoMeses: p.plazoMeses,
      inversion: p.inversion,
      inversionMm: p.inversionMm
    });
  });

  const chartData = (model?.projects || []).map((p) => ({
    sector: (p.sector ?? "").toString().trim() || "Sin dato",
    estado: (p.estado ?? "").toString().trim() || "Sin dato",
    anio: p.anio != null && String(p.anio).trim() !== ""
      ? parseInt(p.anio, 10)
      : null,
    
    inversionMm: Number.isFinite(p.inversionMm) 
      ? p.inversionMm 
      : (Number.isFinite(p.inversion) ? p.inversion : 0),
    
    meses: Number.isFinite(p.meses) 
      ? p.meses 
      : (Number.isFinite(p.plazoMeses) ? p.plazoMeses : null),
    plazoMeses: Number.isFinite(p.meses) 
      ? p.meses 
      : (Number.isFinite(p.plazoMeses) ? p.plazoMeses : null),
    
    nombre: p.nombre ?? "",
    region: p.region ?? "",
    distKm: Number.isFinite(p.distKm) ? p.distKm : null,
    id: p.id ?? null,
  }));

  log("Primeros 3 proyectos DESPUÉS de mapeo:");
  chartData.slice(0, 3).forEach((p, i) => {
    log(`  ChartData ${i}:`, {
      nombre: p.nombre.substring(0, 40),
      estado: p.estado,
      meses: p.meses,
      sector: p.sector
    });
  });

  const conMeses = chartData.filter(p => 
    Number.isFinite(p.meses) && p.meses > 0
  ).length;
  log(`[chartsController] Proyectos con meses válidos: ${conMeses}/${chartData.length}`);

  const aprobadosConMeses = chartData.filter(p => {
    const est = (p.estado || "").toLowerCase();
    return est.includes("aprob") && Number.isFinite(p.meses) && p.meses > 0;
  }).length;
  log(`[chartsController] APROBADOS con meses válidos: ${aprobadosConMeses}`);

  window.initCharts(chartData);
}