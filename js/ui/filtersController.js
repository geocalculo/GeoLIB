// js/ui/filtersController.js
// GeoEVA index.html actual: solo modo proximidad + nSlider

export function initFiltersController({ onFiltersChanged } = {}) {
  const notify = () => typeof onFiltersChanged === "function" && onFiltersChanged();

  function getSelectedSectors() {
    // En este index.html no hay sectores
    return [];
  }

  function getModoSeleccion() {
    // En tu HTML solo existe "proximidad"
    const rb = document.querySelector('input[name="modoSeleccion"]:checked');
    return rb ? rb.value : "proximidad";
  }

  function getRadioAnalisisKm() {
    // No existe radioSlider en este HTML
    return 10;
  }

  function getNProximos() {
    const slider = document.getElementById("nSlider");
    const val = slider ? parseInt(slider.value, 10) : 10;
    return Number.isFinite(val) && val > 0 ? val : 10;
  }

  function refreshSectors() {
    // No aplica en este HTML
  }

  // Slider N
  const nSlider = document.getElementById("nSlider");
  const nValueSpan = document.getElementById("nValue");
  if (nSlider && nValueSpan) {
    nValueSpan.textContent = nSlider.value;
    nSlider.addEventListener("input", () => (nValueSpan.textContent = nSlider.value));
    nSlider.addEventListener("change", notify);
  }

  // Modo (aunque solo haya 1 radio, lo soportamos igual)
  document.querySelectorAll('input[name="modoSeleccion"]').forEach((rb) =>
    rb.addEventListener("change", notify)
  );

  return {
    getSelectedSectors,
    getModoSeleccion,
    getRadioAnalisisKm,
    getNProximos,
    refreshSectors,
  };
}
