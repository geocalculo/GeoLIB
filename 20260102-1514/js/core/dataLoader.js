// js/core/dataLoader.js
// Cargador XLSX para GeoEVA (sin Leaflet, sin DOM)
// - Lee un XLSX desde URL (fetch)
// - Mapea columnas a un modelo normalizado
// - Soporta 2 perfiles: "index" y "mapainfo" (tu nacional.xlsx actual)

import { parseCoord, parseNumber, stripInvalidXmlChars } from "./utils.js";

/**
 * Perfiles predefinidos para nacional.xlsx (según tu código actual).
 * Si mañana cambia el Excel, ajustas aquí.
 */
export const DATA_PROFILES = {
  // Usado en index-fullheight.js (resumen por BBOX)
  index: {
    name: "index",
    sheetIndex: 0,
    columns: {
      nombre: 0,
      region: 3,
      estado: 11,
      sector: 13,
      lat: 14,
      lon: 15,
    },
  },

  // Usado en mapainfo.js (detalle + KMZ + charts)
  mapainfo: {
    name: "mapainfo",
    sheetIndex: 0,
    columns: {
      nombre: 0,
      web: 1,
      tipo: 2,
      region: 3,
      inversion: 9,
      fechaIngreso: 10,
      estado: 11,
      sector: 13,
      lat: 14,
      lon: 15,
      anexos: 16,
      anio: 17,
    },
  },
};

/**
 * Carga un XLSX y retorna filas como matriz (header+rows)
 */
async function fetchXlsxAsMatrix(url, sheetIndex = 0) {
  if (!window.XLSX) {
    throw new Error(
      "SheetJS (XLSX) no está disponible. Carga xlsx.full.min.js antes de usar dataLoader."
    );
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al cargar ${url}`);

  const buf = await resp.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[sheetIndex] || wb.SheetNames[0];
  if (!sheetName) throw new Error("El XLSX no contiene hojas.");

  const ws = wb.Sheets[sheetName];
  const arr = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  return arr || [];
}

/**
 * Normaliza una fila según un perfil (index/mapainfo) y devuelve un objeto proyecto.
 * Retorna null si no tiene coords válidas.
 */
function mapRowToProyecto(row, profile) {
  const c = profile.columns;

  const lat = parseCoord(row?.[c.lat]);
  const lon = parseCoord(row?.[c.lon]);
  if (lat === null || lon === null) return null;

  // Campos base
  const nombre = stripInvalidXmlChars(row?.[c.nombre] || "");
  const region = stripInvalidXmlChars(row?.[c.region] || "");
  const estado = stripInvalidXmlChars(row?.[c.estado] || "");
  const sector = stripInvalidXmlChars(row?.[c.sector] || "");

  // Campos opcionales (solo si están definidos en el perfil)
  const web =
    typeof c.web === "number"
      ? stripInvalidXmlChars(row?.[c.web] || "")
      : "";

  const tipo =
    typeof c.tipo === "number"
      ? stripInvalidXmlChars(row?.[c.tipo] || "")
      : "";

  const anexos =
    typeof c.anexos === "number"
      ? stripInvalidXmlChars(row?.[c.anexos] || "")
      : "";

  const fechaIngreso =
    typeof c.fechaIngreso === "number"
      ? stripInvalidXmlChars(row?.[c.fechaIngreso] || "")
      : "";

  const inversion =
    typeof c.inversion === "number" ? parseNumber(row?.[c.inversion]) : null;

  const anio =
    typeof c.anio === "number"
      ? (() => {
          const v = row?.[c.anio];
          if (v === null || v === undefined || v === "") return null;
          const n = parseInt(String(v), 10);
          return Number.isFinite(n) ? n : null;
        })()
      : null;

  return {
    lat,
    lon,
    nombre,
    region,
    estado,
    sector,
    // opcionales
    web,
    tipo,
    anexos,
    fechaIngreso,
    inversion,
    anio,
  };
}

/**
 * API principal
 * @param {string} url - URL del XLSX (ej: "capas/nacional.xlsx")
 * @param {object|string} profileOrName - "index" | "mapainfo" | objeto perfil custom
 * @returns {Promise<Array<object>>}
 */
export async function loadProyectosXlsx(url, profileOrName = "index") {
  const profile =
    typeof profileOrName === "string"
      ? DATA_PROFILES[profileOrName]
      : profileOrName;

  if (!profile || !profile.columns) {
    throw new Error(
      `Perfil inválido para loadProyectosXlsx(). Usa "index", "mapainfo" o un perfil custom.`
    );
  }

  const arr = await fetchXlsxAsMatrix(url, profile.sheetIndex ?? 0);
  if (!arr.length) return [];

  // arr[0] es header; filas desde 1
  const rows = arr.slice(1);

  const out = [];
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const p = mapRowToProyecto(row, profile);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Helper por si quieres detectar rápido si hay datos
 */
export async function testLoad(url = "capas/nacional.xlsx") {
  const a = await loadProyectosXlsx(url, "index");
  return { count: a.length, sample: a[0] || null };
}

