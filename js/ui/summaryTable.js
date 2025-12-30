// js/ui/summaryTable.js

export function summarizeByRegionAndState(proyectos = []) {
  const resumen = {};

  proyectos.forEach((p) => {
    const region = p.region || "Sin región";
    if (!resumen[region]) resumen[region] = { Aprob: 0, Calif: 0, Rech: 0, Otros: 0 };

    const bucket = p.bucket || "Otros";
    if (!resumen[region][bucket]) resumen[region][bucket] = 0;
    resumen[region][bucket]++;
  });

  return resumen;
}

export function renderSummaryTable(resumen, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const regiones = Object.keys(resumen || {});
  if (!regiones.length) {
    container.innerHTML = "<p>No hay proyectos visibles para los filtros seleccionados.</p>";
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Región / Estado</th>
          <th>Aprob</th>
          <th>Calif</th>
          <th>Rech</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const region of regiones) {
    const r = resumen[region];
    html += `
      <tr>
        <td>${region}</td>
        <td>${r.Aprob || 0}</td>
        <td>${r.Calif || 0}</td>
        <td>${r.Rech || 0}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  container.innerHTML = html;
}
