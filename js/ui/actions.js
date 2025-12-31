// js/ui/actions.js
// Acciones UI reutilizables (KMZ)

export function bindKmzButton({
  buttonId = "btnKmz",
  getModel,
  exporter, // ({model}) => Promise<void>
  attachGlobalName = "downloadProximityKMZ",
} = {}) {
  const btn = document.getElementById(buttonId);

  const run = async () => {
    const model = typeof getModel === "function" ? getModel() : null;
    if (!model) return;

    try {
      await exporter({ model });
    } catch (err) {
      console.error("❌ Error exportando KMZ:", err);
      alert("No se pudo exportar KMZ. Revisa la consola.");
    }
  };

  // Compatibilidad con HTML legacy: onclick="downloadProximityKMZ()"
  if (attachGlobalName) {
    window[attachGlobalName] = run;
  }

  if (btn) {
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
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
