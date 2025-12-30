// js/features/proximity/proximityEngine.js
// GeoEVA - Proximity Engine (punto → puntos)
// - Sin DOM, sin Leaflet
// - Recibe proyectos normalizados (perfil "mapainfo" recomendado)
// - Calcula distancias, radio dinámico por N aprobados (modo proximidad),
//   asigna buckets (Aprob/Calif/Rech/Otros), ids, y stats.
//
// Requiere:
//   import { distanceKm } from "../../core/geo.js";

import { distanceKm } from "../../core/geo.js";

/**
 * Normaliza a un "bucket" GeoEVA según estado.
 */
function bucketFromEstado(estadoRaw) {
  const e = String(estadoRaw || "").toLowerCase();

  if (e.includes("rech")) return "Rech";
  if (e.includes("calif") || e.includes("evalu")) return "Calif";
  if (e.includes("aprob") || e.includes("favorabl")) return "Aprob";

  return "Otros";
}

/**
 * Firma de entrada recomendada:
 * runProximityEngine({
 *   projects, // array de proyectos con lat/lon + estado + inversion (opcional) + nombre (opcional)
 *   center: { lat, lng },
 *   modo: "radio" | "proximidad",
 *   radioKm: number,   // usado en modo radio (o fallback)
 *   n: number          // usado en modo proximidad (N aprobados)
 * })
 *
 * Retorna:
 * {
 *   query: { lat, lng, modo, radioKmInput, n, radioKmFinal },
 *   projects: [ { ...p, distKm, id, bucket, isTopN } ],
 *   stats: { counts, inv, totalProjects, topNCount }
 * }
 */
export function runProximityEngine({
  projects = [],
  center,
  modo = "radio",
  radioKm = 10,
  n = 10,
} = {}) {
  if (
    !center ||
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng)
  ) {
    throw new Error("runProximityEngine: center inválido (lat/lng requeridos).");
  }

  const lat0 = center.lat;
  const lng0 = center.lng;

  const modoNorm = modo === "proximidad" ? "proximidad" : "radio";
  const nNorm = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 10;
  const radioInput =
    Number.isFinite(radioKm) && radioKm > 0 ? radioKm : 10;

  // 1) Distancias a todos
  const withDist = (Array.isArray(projects) ? projects : [])
    .filter(
      (p) =>
        p &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        // evita NaN raros
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180
    )
    .map((p) => {
      const d = distanceKm(lat0, lng0, p.lat, p.lon);
      return { ...p, distKm: d };
    })
    .filter((p) => Number.isFinite(p.distKm));

  // 2) Determinar radio final
  let radioFinalKm = radioInput;
  let topNSetKey = new Set(); // set de key para marcar topN
  let topNCount = 0;

  if (modoNorm === "proximidad") {
    const aprobados = withDist
      .filter((p) => bucketFromEstado(p.estado) === "Aprob")
      .sort((a, b) => a.distKm - b.distKm);

    const topN = aprobados.slice(0, nNorm);
    topNCount = topN.length;

    if (topN.length > 0) {
      radioFinalKm = topN[topN.length - 1].distKm;

      // key estable para identificar topN (similar a tu mapainfo.js)
      topN.forEach((p) => {
        const key = `${p.lat}|${p.lon}|${String(p.nombre || "").trim()}`;
        topNSetKey.add(key);
      });
    } else {
      // fallback: si no hay aprobados, usa radioInput
      radioFinalKm = radioInput;
    }
  }

  // 3) Filtrar proyectos dentro del radio
  const inRadio = withDist.filter((p) => p.distKm <= radioFinalKm);

  // 4) Orden estable: distancia + nombre
  inRadio.sort((a, b) => {
    if (a.distKm !== b.distKm) return a.distKm - b.distKm;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });

  // 5) Asignar id, bucket, isTopN y stats
  const stats = {
    totalProjects: inRadio.length,
    topNCount,
    counts: { Aprob: 0, Calif: 0, Rech: 0, Otros: 0 },
    inv: { Aprob: 0, Calif: 0, Rech: 0, Otros: 0 }, // MMU$ (según tu XLSX)
  };

  const out = inRadio.map((p, idx) => {
    const id = idx + 1;

    const estadoBucket = bucketFromEstado(p.estado);

    // Si modo proximidad y es uno de los topN aprobados → fuerza bucket Aprob
    let isTopN = false;
    let bucket = estadoBucket;

    if (modoNorm === "proximidad") {
      const key = `${p.lat}|${p.lon}|${String(p.nombre || "").trim()}`;
      if (topNSetKey.has(key)) {
        isTopN = true;
        bucket = "Aprob";
      }
    }

    stats.counts[bucket]++;

    const inv = Number.isFinite(p.inversion) ? p.inversion : 0;
    if (Number.isFinite(inv) && inv > 0) stats.inv[bucket] += inv;

    return {
      ...p,
      id,
      bucket,
      isTopN,
    };
  });

  return {
    query: {
      lat: lat0,
      lng: lng0,
      modo: modoNorm,
      radioKmInput: radioInput,
      n: nNorm,
      radioKmFinal: radioFinalKm,
    },
    projects: out,
    stats,
  };
}
