// js/core/utils.js
// Utils compartidos GeoEVA (sin Leaflet, sin DOM)
// - parseo robusto de números (coma/punto/miles)
// - normalización de texto/cabeceras
// - sanitización XML/KML (evita "invalid token")
// - escapes HTML/XML
// - helpers de formato

// ---------------------------
// Normalización
// ---------------------------

export function normalizeHeader(h) {
  return String(h || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function normalizeSimple(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------
// Parseo robusto de números (coords / inversión)
// ---------------------------

/**
 * Convierte strings con separadores comunes a Number.
 * Soporta:
 *  - "1.234,56" -> 1234.56
 *  - "1,234.56" -> 1234.56
 *  - "1234,56"  -> 1234.56
 *  - "1234.56"  -> 1234.56
 *  - "1 234,56" -> 1234.56
 */
export function parseNumber(value) {
  if (value === null || value === undefined) return null;

  let s = String(value).trim();
  if (!s) return null;

  // quitar espacios (incluye NBSP)
  s = s.replace(/\s/g, "").replace(/\u00A0/g, "");

  // Si tiene coma y punto: decidir cuál es decimal por última ocurrencia
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      // Formato "1.234,56" -> miles "." y decimal ","
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Formato "1,234.56" -> miles "," y decimal "."
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // Solo coma: asumir decimal
    s = s.replace(",", ".");
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/**
 * Alias semántico para coords (lat/lon), mismo parse robusto.
 */
export function parseCoord(value) {
  return parseNumber(value);
}

/**
 * Parsea enteros de forma segura
 */
export function parseIntSafe(value) {
  if (value === null || value === undefined) return null;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------
// Formatos
// ---------------------------

export function formatMMU(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return (
    value.toLocaleString("es-CL", {
      minimumFractionDigits: value >= 100 ? 0 : 1,
      maximumFractionDigits: 1,
    }) + " MMU$"
  );
}

// ---------------------------
// HTML / XML / KML hardening
// ---------------------------

/**
 * Escape para HTML (UI web)
 */
export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Remueve caracteres de control inválidos en XML 1.0.
 * Permitidos: \t \n \r
 * Esto evita errores tipo: "not well-formed (invalid token)" en Google Earth.
 */
export function stripInvalidXmlChars(s) {
  return String(s ?? "").replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    ""
  );
}

/**
 * Escape para XML (atributos/valores en KML/XML).
 * Limpia caracteres inválidos primero.
 */
export function xmlEscape(s) {
  const clean = stripInvalidXmlChars(s);
  return clean
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * CDATA segura: evita cortar CDATA y limpia chars inválidos.
 */
export function safeCdata(text) {
  return stripInvalidXmlChars(text).replaceAll("]]>", "]]&gt;");
}

// ---------------------------
// Helpers varios (opcionales pero útiles)
// ---------------------------

/**
 * Retorna string "—" si viene vacío, null o undefined.
 */
export function orDash(v) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

/**
 * Trunca un string con ellipsis.
 */
export function truncate(s, max = 60) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 3)) + "...";
}
