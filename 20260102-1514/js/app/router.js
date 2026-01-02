// js/app/router.js
// Router común GeoEVA: parsea params y construye URL a mapainfo

function numFromParam(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function intFromParam(v) {
  if (v == null) return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function getMapainfoParamsFromUrl({
  defaults = { lat: -27.5, lng: -70.25, modo: "proximidad", radio: 10, n: 10, sectores: [] },
} = {}) {
  const p = new URLSearchParams(window.location.search);

  const lat = numFromParam(p.get("lat")) ?? defaults.lat;
  const lng = numFromParam(p.get("lng")) ?? defaults.lng;

  const modoRaw = (p.get("modo") || defaults.modo || "proximidad").toLowerCase();
  const modo = modoRaw === "radio" ? "radio" : "proximidad";

  const radio = numFromParam(p.get("radio")) ?? defaults.radio;
  const n = intFromParam(p.get("n")) ?? defaults.n;

  const sec = p.get("sectores");
  const sectores = sec ? sec.split("|").map((x) => x.trim()).filter(Boolean) : (defaults.sectores || []);

  return { lat, lng, modo, radio, n, sectores };
}

export function buildMapainfoUrl({
  baseHref,
  lat,
  lng,
  modo,
  radioKm,
  n,
  sectores,
} = {}) {
  const url = new URL("mapainfo.html", baseHref || window.location.href);

  url.searchParams.set("lat", Number(lat).toFixed(6));
  url.searchParams.set("lng", Number(lng).toFixed(6));
  url.searchParams.set("modo", (modo || "proximidad").toLowerCase());
  url.searchParams.set("radio", String(radioKm ?? 10));
  url.searchParams.set("n", String(n ?? 10));

  if (Array.isArray(sectores) && sectores.length) {
    url.searchParams.set("sectores", sectores.join("|"));
  }

  return url.toString();
}
