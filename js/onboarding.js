/* ===============================
   GeoEVA – Onboarding (definitivo / SAFE)
   - CSS lo deja OCULTO por defecto
   - JS lo abre sólo 1 vez (localStorage)
   - Cierra con: Comenzar / Saltar / ESC / click overlay / click mapa
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const KEY = "geoeva_intro_seen";
  const root = document.getElementById("geoeva-onboarding");
  if (!root) return;

  const slides = Array.from(root.querySelectorAll(".geoeva-onboarding__slide"));
  if (!slides.length) return;

  let i = 0;
  let closed = false;

  const show = (k) => {
    slides.forEach(s => s.classList.remove("is-active"));
    slides[Math.max(0, Math.min(k, slides.length - 1))].classList.add("is-active");
  };

  const goHome = () => {
    try { window.scrollTo({ top: 0, left: 0, behavior: "smooth" }); }
    catch { window.scrollTo(0, 0); }
  };

  const close = () => {
    if (closed) return;
    closed = true;

    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");

    try { localStorage.setItem(KEY, "1"); } catch(_) {}

    document.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("click", onRootClick, true);

    goHome();
  };

  const onKeyDown = (ev) => {
    if (ev.key === "Escape" || ev.key === "Esc") {
      ev.preventDefault();
      close();
    }
  };

  const onRootClick = (ev) => {
    // Click en el overlay (fuera del cuadro) => cerrar
    if (ev.target === root) return close();

    // CTA / Skip
    if (ev.target.closest(".geoeva-onboarding__cta")) return close();
    if (ev.target.closest(".geoeva-onboarding__skip")) return close();

    // Navegación
    if (ev.target.closest("[data-onboard-next]")) {
      ev.preventDefault();
      i = Math.min(i + 1, slides.length - 1);
      show(i);
      return;
    }
    if (ev.target.closest("[data-onboard-prev]")) {
      ev.preventDefault();
      i = Math.max(i - 1, 0);
      show(i);
      return;
    }
  };

  // Si ya se vio, no abrir
  try {
    if (localStorage.getItem(KEY)) {
      root.classList.remove("is-open");
      root.setAttribute("aria-hidden", "true");
      return;
    }
  } catch(_) {
    // si localStorage falla, igual no bloqueamos nada; pero sí mostramos onboarding
  }

  // Abrir onboarding
  show(0);
  root.classList.add("is-open");
  root.setAttribute("aria-hidden", "false");

  // Listeners
  document.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("click", onRootClick, true);

  // Cerrar al primer click del mapa (tu app guarda window.__leafletMap)
  const attachMapOnce = () => {
    const map = window.__leafletMap;
    if (map && typeof map.once === "function") {
      map.once("click", () => close());
      return true;
    }
    return false;
  };

  // intenta ahora + reintentos cortos por si el mapa aún no está listo
  if (!attachMapOnce()) {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (attachMapOnce() || tries >= 20) clearInterval(t); // ~2s
    }, 100);
  }
});
