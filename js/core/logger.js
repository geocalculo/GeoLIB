// js/core/logger.js
// Logger central para controlar ruido de consola por entorno.

function isDebugEnabled() {
  if (typeof window === "undefined") return false;

  const host = String(window.location?.hostname || "").toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";

  let byStorage = false;
  try {
    byStorage = window.localStorage?.getItem("geoeva_debug") === "1";
  } catch {
    byStorage = false;
  }

  return isLocalHost || byStorage;
}

export const DEBUG = isDebugEnabled();

export function log(...args) {
  if (DEBUG) console.log(...args);
}

export function warn(...args) {
  if (DEBUG) console.warn(...args);
}

export function error(...args) {
  console.error(...args);
}

