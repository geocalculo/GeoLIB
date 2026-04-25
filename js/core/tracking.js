// js/core/tracking.js
// Capa única de tracking frontend para GeoEVA (GTM + dataLayer).

const TRACK_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("gtm_debug");

const EVENT_DEDUPE_KEYS = new Set();

export function trackEvent(payload = {}, extra = {}, options = {}) {
  if (typeof window === "undefined") return false;

  const basePayload =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const extraPayload =
    extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  const eventName = String(basePayload.event || "").trim();
  if (!eventName) return false;

  const dedupeKey = String(options?.dedupeKey || "").trim();
  if (dedupeKey && EVENT_DEDUPE_KEYS.has(dedupeKey)) return false;

  window.dataLayer = window.dataLayer || [];

  const normalizedPayload = {
    site: "geoeva",
    ...basePayload,
    ...extraPayload,
    event: eventName,
  };

  window.dataLayer.push(normalizedPayload);
  if (dedupeKey) EVENT_DEDUPE_KEYS.add(dedupeKey);

  if (TRACK_DEBUG) {
    console.log("[GeoEVA GTM] evento enviado", normalizedPayload);
  }

  return true;
}

if (typeof window !== "undefined") {
  window.trackEvent = trackEvent;
}
