// ===============================
// CAPAS BASE (usar siempre después de crear el mapa)
// ===============================

function agregarCapasBase(map) {
  // 🌎 OSM abajo
  const capaOSM = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      opacity: 1.0,     // 0% transparente
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  // 🛰️ Satélite arriba (90% transparente)
  const capaSatelite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.10,    // 90% transparente
      maxZoom: 19
    }
  ).addTo(map);  // queda ENCIMA de OSM

  return { capaOSM, capaSatelite };
}
