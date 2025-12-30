// js/app/router.js
export function buildMapainfoUrl({ baseHref, lat, lng, modo, radioKm, n, sectores }) {
  const url = new URL("mapainfo.html", baseHref);

  url.searchParams.set("lat", Number(lat).toFixed(6));
  url.searchParams.set("lng", Number(lng).toFixed(6));
  url.searchParams.set("modo", modo || "radio");
  url.searchParams.set("radio", String(radioKm || 10));
  url.searchParams.set("n", String(n || 10));

  if (Array.isArray(sectores) && sectores.length) {
    url.searchParams.set("sectores", sectores.join("|"));
  }

  return url.toString();
}
