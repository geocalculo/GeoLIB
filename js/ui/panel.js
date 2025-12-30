// js/ui/panel.js
// Panel lateral: render lista + sincronizar con mapa.
// No conoce Leaflet: usa callbacks.

import { renderProjectListItemHtml } from "../report/htmlRenderer.js";

export function createProjectsPanel({
  containerId = "panelContent",
  countId = "panelCount",
  onSelectProject,
} = {}) {
  const container = document.getElementById(containerId);
  const countEl = document.getElementById(countId);

  if (!container) throw new Error(`createProjectsPanel: falta #${containerId}`);

  function setCount(n) {
    if (countEl) countEl.textContent = String(n ?? 0);
  }

  function clearHighlight() {
    container.querySelectorAll(".project-item.highlighted").forEach((el) => {
      el.classList.remove("highlighted");
    });
  }

  function highlight(id) {
    clearHighlight();
    const el = container.querySelector(`.project-item[data-project-id="${CSS.escape(String(id))}"]`);
    if (el) {
      el.classList.add("highlighted");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function render(projects) {
    container.innerHTML = projects.map(renderProjectListItemHtml).join("");
    setCount(projects.length);

    // puntito de estado por bucket (CSS minimal)
    container.querySelectorAll(".project-status-dot").forEach((dot) => {
      const bucket = dot.getAttribute("data-bucket");
      dot.style.background =
        bucket === "Aprob"
          ? "#10b981"
          : bucket === "Calif"
          ? "#f59e0b"
          : bucket === "Rech"
          ? "#ef4444"
          : "#6b7280";
    });

    // clicks
    container.querySelectorAll(".project-item").forEach((row) => {
      row.addEventListener("click", () => {
        const id = Number(row.getAttribute("data-project-id"));
        onSelectProject?.(id);
      });
    });
  }

  return {
    render,
    highlight,
    clearHighlight,
    setCount,
  };
}
