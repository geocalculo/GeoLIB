// js/ui/layoutController.js
// Panel responsive: desktop fijo / móvil overlay con backdrop

export function initPanelResponsive({
  panelId,
  backdropId,
  headerBtnId,
  isMobileWidth = 768,
  onAfterToggle,
} = {}) {
  const panel = document.getElementById(panelId);
  const backdrop = document.getElementById(backdropId);
  const headerBtn = document.getElementById(headerBtnId);

  if (!panel) return;

  const isMobile = () => window.innerWidth < isMobileWidth;
  let isOpen = false;

  function updateUI() {
    if (isMobile()) {
      if (isOpen) {
        panel.classList.add("is-open");
        backdrop?.classList.add("active");
        if (headerBtn) headerBtn.textContent = "✕ Cerrar";
        document.body.style.overflow = "hidden";
      } else {
        panel.classList.remove("is-open");
        backdrop?.classList.remove("active");
        if (headerBtn) headerBtn.textContent = "☰ Configuración";
        document.body.style.overflow = "";
      }
    } else {
      panel.classList.remove("is-open");
      backdrop?.classList.remove("active");
      document.body.style.overflow = "";
      if (headerBtn) headerBtn.textContent = "☰ Configuración";
      isOpen = false;
    }

    if (typeof onAfterToggle === "function") onAfterToggle();
  }

  function togglePanel() {
    if (!isMobile()) return;
    isOpen = !isOpen;
    updateUI();
  }

  function closePanel() {
    if (!isMobile()) return;
    isOpen = false;
    updateUI();
  }

  // init
  updateUI();

  headerBtn?.addEventListener("click", togglePanel);
  backdrop?.addEventListener("click", closePanel);

  // stop propagation inside panel
  panel.addEventListener("click", (e) => e.stopPropagation());

  // resize debounce
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => updateUI(), 150);
  });
}
