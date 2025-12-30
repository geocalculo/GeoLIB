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
