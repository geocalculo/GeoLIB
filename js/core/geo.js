// js/core/geo.js
// Geometría / geodesia simple compartida GeoEVA
// (sin Leaflet, sin DOM)
//
// Incluye:
// - distanceKm (haversine)
// - distanceM
// - circlePolygonCoords (polígono WGS84 para KML)
// - bboxFromLeafletBounds (helper opcional)
// - pointInBbox (helper opcional)

const EARTH_RADIUS_KM = 6371;

// ---------------------------
// Distancias (Haversine)
// ---------------------------

export function distanceKm(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return NaN;
  }

  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function distanceM(lat1, lon1, lat2, lon2) {
  const km = distanceKm(lat1, lon1, lat2, lon2);
  return Number.isFinite(km) ? km * 1000 : NaN;
}

// ---------------------------
// Círculo aproximado como polígono (para KML/KMZ)
// ---------------------------

/**
 * Genera un anillo de coordenadas "lng,lat,0" para un círculo aproximado
 * alrededor de (lon,lat) con radio "radiusKm".
 *
 * Retorna string listo para KML:
 *   "lon1,lat1,0 lon2,lat2,0 ... lonN,latN,0"
 *
 * Nota: aproximación geodésica (gran círculo) suficientemente buena para KMZ.
 */
export function circlePolygonCoords(lon, lat, radiusKm, steps = 96) {
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0
  ) {
    return "";
  }

  const rad = Math.PI / 180;

  const latRad = lat * rad;
  const lonRad = lon * rad;
  const d = radiusKm / EARTH_RADIUS_KM;

  const coords = [];
  const n = Math.max(12, Math.min(720, Math.floor(steps))); // límites razonables

  for (let i = 0; i <= n; i++) {
    const brng = (2 * Math.PI * i) / n;

    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
        Math.cos(latRad) * Math.sin(d) * Math.cos(brng)
    );

    const lon2 =
      lonRad +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(lat2)
      );

    const latDeg = lat2 / rad;
    const lonDeg = lon2 / rad;

    coords.push(`${lonDeg},${latDeg},0`);
  }

  return coords.join(" ");
}

// ---------------------------
// Helpers BBOX (opcionales)
// ---------------------------

/**
 * Convierte un bounds tipo Leaflet (o similar) a bbox [minLon,minLat,maxLon,maxLat]
 * Espera un objeto con:
 * - getSouthWest(): { lat, lng }
 * - getNorthEast(): { lat, lng }
 */
export function bboxFromLeafletBounds(bounds) {
  if (!bounds || typeof bounds.getSouthWest !== "function") return null;

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  if (
    !sw ||
    !ne ||
    !Number.isFinite(sw.lat) ||
    !Number.isFinite(sw.lng) ||
    !Number.isFinite(ne.lat) ||
    !Number.isFinite(ne.lng)
  ) {
    return null;
  }

  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

export function pointInBbox(lat, lon, bbox) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!bbox || bbox.length !== 4) return false;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (
    !Number.isFinite(minLon) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLon) ||
    !Number.isFinite(maxLat)
  ) {
    return false;
  }

  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}
