// js/ui/mapLayers.js
// Manejo de capas Leaflet: punto consulta, círculo, markers y resaltado.
// Requiere Leaflet global (L).

import { renderProjectPopupHtml } from "../report/htmlRenderer.js";

export function createMapLayers(map) {
  if (!map) throw new Error("createMapLayers: map requerido.");

  const layers = {
    queryMarker: null,
    queryCircle: null,
    markersLayer: L.layerGroup().addTo(map),
    markerById: new Map(),
    tooltipById: new Map(),
    projectById: new Map(),
  };

  function clearProjects() {
    layers.markersLayer.clearLayers();
    layers.markerById.clear();
    layers.tooltipById.clear();
    layers.projectById.clear();
  }

  function setQueryPoint(lat, lng) {
    if (layers.queryMarker) map.removeLayer(layers.queryMarker);
    layers.queryMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: "#1d4ed8",
      weight: 2,
      fillColor: "#60a5fa",
      fillOpacity: 0.9,
    }).addTo(map);
  }

  function setQueryCircle(lat, lng, radiusKm) {
    if (layers.queryCircle) map.removeLayer(layers.queryCircle);
    layers.queryCircle = L.circle([lat, lng], {
      radius: (radiusKm || 1) * 1000,
      color: "#1d4ed8",
      weight: 2,
      fillColor: "#1d4ed8",
      fillOpacity: 0.18,
    }).addTo(map);
  }

  function markerColor(bucket) {
    if (bucket === "Aprob") return "#10b981";
    if (bucket === "Calif") return "#f59e0b";
    if (bucket === "Rech") return "#ef4444";
    return "#6b7280";
  }

  function renderProjects(projects, { onMarkerClick } = {}) {
    clearProjects();

    for (const p of projects) {
      const m = L.circleMarker([p.lat, p.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1,
        fillColor: markerColor(p.bucket),
        fillOpacity: 0.9,
      });

      const isMobile = window.__isMobile
  ? window.__isMobile()
  : window.matchMedia("(max-width: 768px)").matches;

if (!isMobile) {
  m.bindPopup(renderProjectPopupHtml(p));
}


      // etiqueta ID
      const tooltip = m.bindTooltip(String(p.id), {
        permanent: true,
        direction: "center",
        className: "project-id-label",
        offset: [0, 0],
      });

// Click: desktop -> popup; móvil -> bottom sheet (si existe)
// Click: desktop -> popup; móvil -> bottom sheet (si existe)
m.on("click", (e) => {
  const isMobile = window.__isMobile
    ? window.__isMobile()
    : window.matchMedia("(max-width: 768px)").matches;

  if (isMobile) {
    // 1) Cierra cualquier popup abierto
    map.closePopup();

    // 2) Evita que Leaflet intente abrir popup por click
    L.DomEvent.stop(e);
    if (typeof m.closePopup === "function") m.closePopup();

    // 3) Abre bottom sheet
    if (typeof window.openMobileSheet === "function") {
      window.openMobileSheet(p);
    }
    return;
  }

  // Desktop normal
  m.openPopup();
  if (typeof onMarkerClick === "function") onMarkerClick(p.id);
});


      layers.markersLayer.addLayer(m);
      layers.markerById.set(p.id, m);
      layers.tooltipById.set(p.id, tooltip);
      layers.projectById.set(p.id, p);
    }
  }

function highlightProject(id) {
  // limpia todos
  for (const [, marker] of layers.markerById.entries()) {
    const el = marker.getElement?.();
    if (el) el.classList.remove("marker-highlighted");
  }

  const m = layers.markerById.get(id);
  if (!m) return;

  const el = m.getElement?.();
  if (el) el.classList.add("marker-highlighted");

  const isMob = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  if (isMob && typeof window.openMobileSheet === "function") {
    const p = layers.projectById.get(id);
    if (p) window.openMobileSheet(p);
    return;
  }

  m.openPopup();
}

  return {
    clearProjects,
    setQueryPoint,
    setQueryCircle,
    renderProjects,
    highlightProject,
  };
}
