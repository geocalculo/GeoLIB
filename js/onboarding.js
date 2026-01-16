/* ===============================
   GeoEVA – Onboarding (FINAL / SAFE)
   - CSS lo deja OCULTO por defecto
   - JS lo abre sólo 1 vez (localStorage)
   - Reabrible con botón "Ayuda"
   - Cierra con: Comenzar / Saltar / ESC / click overlay / click mapa
   - Al cerrar: invalidateSize Leaflet
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const KEY = "geoeva_intro_seen";
  const root = document.getElementById("geoeva-onboarding");
  if (!root) { console.warn("[onboarding] root #geoeva-onboarding no existe"); return; }

  const slides = Array.from(root.querySelectorAll(".geoeva-onboarding__slide"));
  if (!slides.length) { console.warn("[onboarding] no hay slides"); return; }

  let i = 0;
  let closed = false;

  const log = (...a) => console.log("[onboarding]", ...a);

  const show = (k) => {
    slides.forEach(s => s.classList.remove("is-active"));
    const kk = Math.max(0, Math.min(k, slides.length - 1));
    slides[kk].classList.add("is-active");
    i = kk;
  };

  const invalidateLeaflet = () => {
    try {
      const map = window.__leafletMap;
      if (map && typeof map.invalidateSize === "function") map.invalidateSize(true);
    } catch (_) {}
  };

  const close = () => {
    if (closed) return;
    closed = true;

    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");

    try { localStorage.setItem(KEY, "1"); } catch(_) {}

    document.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("click", onRootClick, true);

    setTimeout(invalidateLeaflet, 120);
    setTimeout(invalidateLeaflet, 450);

    log("cerrado");
  };

  const open = (forceFirstSlide = true) => {
    closed = false;

    if (forceFirstSlide) show(0);

    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");

    // evita duplicar listeners si reabres desde "Ayuda"
    document.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("click", onRootClick, true);

    document.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("click", onRootClick, true);

    setTimeout(invalidateLeaflet, 120);
    setTimeout(invalidateLeaflet, 450);

    log("abierto");
  };

  const onKeyDown = (ev) => {
    if (ev.key === "Escape" || ev.key === "Esc") {
      ev.preventDefault();
      close();
    }
  };

  const onRootClick = (ev) => {
    // click fuera del cuadro (overlay) => cerrar
    if (ev.target === root) return close();

    // CTA / Skip => cerrar
    if (ev.target.closest(".geoeva-onboarding__cta")) return close();
    if (ev.target.closest(".geoeva-onboarding__skip")) return close();

    // navegación
    if (ev.target.closest("[data-onboard-next]")) {
      ev.preventDefault();
      show(i + 1);
      return;
    }
    if (ev.target.closest("[data-onboard-prev]")) {
      ev.preventDefault();
      show(i - 1);
      return;
    }
  };

  // API pública: reabrir desde consola o botón
  window.geoevaOpenOnboarding = () => open(true);
  window.geoevaCloseOnboarding = () => close();

  // Botón "Ayuda"
  const helpBtn = document.getElementById("helpOnboardingBtn");
  if (helpBtn) {
    helpBtn.addEventListener("click", () => {
      log("click Ayuda");
      open(true);
    });
  } else {
    console.warn("[onboarding] no existe #helpOnboardingBtn (si lo quieres, revisa el id en HTML)");
  }

  // Mostrar SOLO la primera vez
  let seen = false;
  try { seen = !!localStorage.getItem(KEY); } catch(_) {}

  if (!seen) {
    open(true);
    log("primera visita: se muestra");
  } else {
    log("ya visto: no se muestra");
  }

  // cerrar con primer click en el mapa cuando exista
  const attachMapOnce = () => {
    const map = window.__leafletMap;
    if (map && typeof map.once === "function") {
      map.once("click", () => close());
      return true;
    }
    return false;
  };

  if (!attachMapOnce()) {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (attachMapOnce() || tries >= 40) clearInterval(t); // ~4s
    }, 100);
  }
});
