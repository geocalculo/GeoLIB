// js/ui/actions.js
// Acciones UI reutilizables (KMZ)

export function bindKmzButton({
  buttonId = "btnKmz",
  getModel,
  exporter, // ({model}) => Promise<void>
  attachGlobalName = "downloadProximityKMZ",
} = {}) {
  const btn = document.getElementById(buttonId);
  const runtimeDebug =
    window.__GEOEVA_RUNTIME_DEBUG__ === true ||
    new URLSearchParams(window.location.search).get("debugRuntime") === "1";

  const debugLog = (...args) => {
    if (!runtimeDebug) return;
    console.log("[GeoEVA][KMZ][bind]", ...args);
  };

  const run = async () => {
    const model = typeof getModel === "function" ? getModel() : null;
    debugLog("run()", {
      buttonId,
      hasModel: Boolean(model),
      hasQuery: Boolean(model?.query),
    });
    if (!model) return;

    try {
      debugLog("before exporter()");
      await exporter({ model });
      debugLog("after exporter()");
    } catch (err) {
      debugLog("error in exporter()", err);
      console.error("❌ Error exportando KMZ:", err);
      alert("No se pudo exportar KMZ. Revisa la consola.");
    }
  };

  // Compatibilidad con HTML legacy: onclick="downloadProximityKMZ()"
  if (attachGlobalName) {
    window[attachGlobalName] = run;
  }

  if (btn) {
    if (btn.dataset.boundKmz === "1") return { run };
    btn.dataset.boundKmz = "1";
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      debugLog("btn click", { disabled: btn.disabled, boundKmz: btn.dataset.boundKmz });
      e.preventDefault();
      run();
    });
  }

  return { run };
}

// -----------------------------
// Informe (Desktop/PDF)
// Abre report.html con los mismos params de la consulta actual.
// -----------------------------
export function bindReportButton({
  buttonId = "btnPdf",
  getModel,
  reportPage = "report.html",
  target = "_blank",
  attachGlobalName = "openReport",
} = {}) {
  const btn = document.getElementById(buttonId);

  const run = () => {
    const model = typeof getModel === "function" ? getModel() : null;
    if (!model?.query) return;

    const q = model.query;
    const url = new URL(reportPage, window.location.href);
    url.searchParams.set("lat", Number(q.lat).toFixed(6));
    url.searchParams.set("lng", Number(q.lng).toFixed(6));
    url.searchParams.set("modo", String(q.modo || "proximidad"));
    url.searchParams.set("radio", String(q.radioKmInput ?? q.radioKmFinal ?? 10));
    url.searchParams.set("n", String(q.n ?? 10));
    if (Array.isArray(q.sectores) && q.sectores.length) {
      url.searchParams.set("sectores", q.sectores.join("|"));
    }

    window.open(url.toString(), target);
  };

  if (attachGlobalName) window[attachGlobalName] = run;

  if (btn) {
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      run();
    });
  }

  return { run };
}
