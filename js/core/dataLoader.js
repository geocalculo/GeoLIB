// js/core/dataLoader.js
// Cargador JSON para GeoEVA (sin dependencia de XLSX)
// Lee nacional.compact.v2.json con formato {columns: [...], rows: [[...]]}

import { parseCoord, parseNumber, stripInvalidXmlChars } from "./utils.js";

/**
 * Mapeo de campos del JSON compacto a estructura interna
 * El JSON tiene formato: { columns: ["nombre", "web", ...], rows: [[val1, val2, ...], ...] }
 */
const JSON_FIELD_MAPPING = {
  nombre: "nombre",
  web: "web",
  tipo_presentacion: "tipo",
  region: "region",
  inversion_mmusd: "inversion",
  fecha_presentacion: "fechaIngreso",
  estado: "estado",
  sector: "sector",
  lat: "lat",
  lon: "lon",
  documentacion: "anexos",
  anio: "anio",
  meses: "meses",
};

/**
 * Carga un JSON compacto y retorna proyectos normalizados
 * @param {string} url - URL del JSON (ej: "capas/nacional.compact.v2.json")
 * @returns {Promise<Array<object>>}
 */
async function loadJsonCompact(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al cargar ${url}`);

  const data = await resp.json();
  
  if (!data.columns || !Array.isArray(data.columns)) {
    throw new Error("JSON inválido: falta 'columns'");
  }
  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error("JSON inválido: falta 'rows'");
  }

  // Crear índice de columnas para acceso rápido
  const colIndex = {};
  data.columns.forEach((col, idx) => {
    colIndex[col] = idx;
  });

  return { rows: data.rows, colIndex };
}

/**
 * Parsea el campo meses de forma robusta
 * @param {any} raw - Valor del campo meses
 * @returns {number|null} Meses como entero o null si inválido
 */
function parseMeses(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  
  // Rechazar strings de error tipo "#VALUE!"
  if (typeof raw === "string" && raw.includes("#")) return null;
  
  const num = parseNumber(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  
  return Math.round(num); // Retornar como entero
}

/**
 * Normaliza una fila del JSON a objeto proyecto
 * @param {Array} row - Fila del JSON (array de valores)
 * @param {Object} colIndex - Mapeo de nombre_columna -> índice
 * @returns {Object|null} Proyecto normalizado o null si coords inválidas
 */
function mapJsonRowToProyecto(row, colIndex) {
  // Coordenadas (obligatorias)
  const latIdx = colIndex[JSON_FIELD_MAPPING.lat] ?? colIndex["lat"];
  const lonIdx = colIndex[JSON_FIELD_MAPPING.lon] ?? colIndex["lon"];
  
  const lat = parseCoord(row[latIdx]);
  const lon = parseCoord(row[lonIdx]);
  if (lat === null || lon === null) return null;

  // Campos base (obligatorios)
  const nombreIdx = colIndex[JSON_FIELD_MAPPING.nombre] ?? colIndex["nombre"];
  const regionIdx = colIndex[JSON_FIELD_MAPPING.region] ?? colIndex["region"];
  const estadoIdx = colIndex[JSON_FIELD_MAPPING.estado] ?? colIndex["estado"];
  const sectorIdx = colIndex[JSON_FIELD_MAPPING.sector] ?? colIndex["sector"];

  const nombre = stripInvalidXmlChars(row[nombreIdx] || "");
  const region = stripInvalidXmlChars(row[regionIdx] || "");
  const estado = stripInvalidXmlChars(row[estadoIdx] || "");
  const sector = stripInvalidXmlChars(row[sectorIdx] || "");

  // Campos opcionales
  const webIdx = colIndex[JSON_FIELD_MAPPING.web] ?? colIndex["web"];
  const web = webIdx !== undefined ? stripInvalidXmlChars(row[webIdx] || "") : "";

  const tipoIdx = colIndex[JSON_FIELD_MAPPING.tipo] ?? colIndex["tipo_presentacion"];
  const tipo = tipoIdx !== undefined ? stripInvalidXmlChars(row[tipoIdx] || "") : "";

  const anexosIdx = colIndex[JSON_FIELD_MAPPING.anexos] ?? colIndex["documentacion"];
  const anexos = anexosIdx !== undefined ? stripInvalidXmlChars(row[anexosIdx] || "") : "";

  const fechaIngresoIdx = colIndex[JSON_FIELD_MAPPING.fechaIngreso] ?? colIndex["fecha_presentacion"];
  const fechaIngreso = fechaIngresoIdx !== undefined ? stripInvalidXmlChars(row[fechaIngresoIdx] || "") : "";

  // Inversión (parseNumber maneja null/undefined/string)
  const inversionIdx = colIndex[JSON_FIELD_MAPPING.inversion] ?? colIndex["inversion_mmusd"];
  const inversion = inversionIdx !== undefined ? parseNumber(row[inversionIdx]) : null;

  // Año
  const anioIdx = colIndex[JSON_FIELD_MAPPING.anio] ?? colIndex["anio"];
  let anio = null;
  if (anioIdx !== undefined) {
    const v = row[anioIdx];
    if (v !== null && v !== undefined && v !== "") {
      const n = parseInt(String(v), 10);
      if (Number.isFinite(n) && n > 1900 && n < 2100) {
        anio = n;
      }
    }
  }

  // Meses (plazo)
  const mesesIdx = colIndex[JSON_FIELD_MAPPING.meses] ?? colIndex["meses"];
  const meses = mesesIdx !== undefined ? parseMeses(row[mesesIdx]) : null;

  return {
    lat,
    lon,
    nombre,
    region,
    estado,
    sector,
    web,
    tipo,
    anexos,
    fechaIngreso,
    inversion,
    inversionMm: inversion, // Alias para compatibilidad con gráficos
    anio,
    meses, // Para gráfico de plazo
    plazoMeses: meses, // Alias
  };
}

/**
 * API principal - Carga proyectos desde JSON
 * @param {string} url - URL del JSON
 * @returns {Promise<Array<object>>} Array de proyectos normalizados
 */
export async function loadProyectos(url) {
  const { rows, colIndex } = await loadJsonCompact(url);

  const out = [];
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const p = mapJsonRowToProyecto(row, colIndex);
    if (p) out.push(p);
  }

  return out;
}

/**
 * Wrapper para compatibilidad con código existente
 * @deprecated Use loadProyectos() instead
 */
export async function loadProyectosXlsx(url, profileOrName = "mapainfo") {
  console.warn("loadProyectosXlsx() is deprecated. El sistema ahora usa JSON.");
  
  // Si la URL sigue siendo .xlsx, cambiarla a .json
  const jsonUrl = url.replace(/\.xlsx?$/i, ".compact.v2.json");
  return loadProyectos(jsonUrl);
}

/**
 * Helper para testing rápido
 */
export async function testLoad(url = "capas/nacional.compact.v2.json") {
  const proyectos = await loadProyectos(url);
  return { 
    count: proyectos.length, 
    sample: proyectos[0] || null,
    fields: proyectos[0] ? Object.keys(proyectos[0]) : []
  };
}