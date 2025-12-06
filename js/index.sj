// ===============================
// Inicializar mapa
// ===============================
const map = L.map("map", {
  zoomControl: true,
}).setView([-27.5, -70.5], 5);

// Capa base
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const coordsDisplay = document.getElementById("coordsDisplay");
const sectorSelect = document.getElementById("sectorSelect");

function getRadioKm() {
  const radios = document.querySelectorAll('input[name="radio"]');
  for (const r of radios) {
    if (r.checked) return parseInt(r.value, 10);
  }
  return 100;
}

function actualizarCoords(lat, lng) {
  coordsDisplay.textContent =
    "Coordenadas clic: lat " +
    lat.toFixed(6) +
    ", lng " +
    lng.toFixed(6) +
    ". Zoom: " +
    map.getZoom();
}

// ===============================
// Evento de clic en el mapa
// ===============================
map.on("click", (e) => {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;
  const zoom = map.getZoom();

  actualizarCoords(lat, lng);

  const sector = encodeURIComponent(sectorSelect.value || "Todos");
  const radioKm = getRadioKm();

  const url =
    "info.html" +
    "?lat=" +
    lat.toFixed(6) +
    "&lng=" +
    lng.toFixed(6) +
    "&z=" +
    zoom +
    "&radio_km=" +
    radioKm +
    "&sector=" +
    sector;

  window.location.href = url;
});

