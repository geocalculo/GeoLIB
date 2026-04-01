// js/core/tracking.js
// Capa única de tracking frontend para GeoEVA (GTM + dataLayer).

export function trackEvent(name, params = {}) {
  if (!name) return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: String(name),
    ...params,
  });
}
