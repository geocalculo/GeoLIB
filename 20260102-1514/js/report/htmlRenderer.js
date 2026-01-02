// js/report/htmlRenderer.js
// Render HTML para: popup Leaflet, fila panel, balloon KML.
// (sin Leaflet, solo strings)

import { escapeHtml, xmlEscape, safeCdata, formatMMU, orDash } from "../core/utils.js";

export function renderProjectPopupHtml(p) {
  const urlExp = String(p.web || "").trim();
  const urlAnx = String(p.anexos || "").trim();

  const links =
    urlExp || urlAnx
      ? `
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          ${
            urlExp
              ? `<a href="${escapeHtml(urlExp)}" target="_blank" rel="noopener"
                   style="display:inline-block; padding:6px 10px; border-radius:8px;
                          background:#1d4ed8; color:#fff; text-decoration:none; font-weight:700; font-size:12px;">
                   Abrir expediente
                 </a>`
              : ""
          }
          ${
            urlAnx
              ? `<a href="${escapeHtml(urlAnx)}" target="_blank" rel="noopener"
                   style="display:inline-block; padding:6px 10px; border-radius:8px;
                          background:#0f766e; color:#fff; text-decoration:none; font-weight:700; font-size:12px;">
                   Abrir anexos
                 </a>`
              : ""
          }
        </div>
      `
      : "";

  return `
    <div style="min-width:240px">
      <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(p.nombre)}</div>
      <div style="font-size:12px; line-height:1.35;">
        <div><b>#</b> ${escapeHtml(String(p.id))}</div>
        <div><b>Estado:</b> ${escapeHtml(orDash(p.estado))}</div>
        <div><b>Sector:</b> ${escapeHtml(orDash(p.sector))}</div>
        <div><b>Dist:</b> ${Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—"} km</div>
        <div><b>Inversión:</b> ${formatMMU(p.inversion)}</div>
      </div>
      ${links}
    </div>
  `;
}


export function renderProjectListItemHtml(p) {
  return `
    <div class="project-item" data-project-id="${escapeHtml(String(p.id))}">
      <div class="project-id">${escapeHtml(String(p.id))}</div>
      <div class="project-name" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</div>
      <div class="project-status-dot" data-bucket="${escapeHtml(p.bucket)}"></div>
    </div>
  `;
}

/**
 * Balloon HTML para KML (dentro de CDATA).
 * Puedes enriquecerlo después sin tocar el exportador.
 */
export function renderKmlBalloonHtml({ model, p, extraSummaryText = "" }) {
  const urlExp = (p.web || "").trim();
  const urlAnx = (p.anexos || "").trim();

  const links =
    urlExp || urlAnx
      ? `<div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap;">
          ${urlExp ? `<a href="${xmlEscape(urlExp)}" target="_blank" rel="noopener">Abrir expediente</a>` : ""}
          ${urlAnx ? `<a href="${xmlEscape(urlAnx)}" target="_blank" rel="noopener">Abrir anexos</a>` : ""}
         </div>`
      : "";


  const extra = extraSummaryText ? `<div style="margin-top:10px;">${extraSummaryText}</div>` : "";

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial; font-size:12px;">
      <div style="font-weight:800; font-size:13px; margin-bottom:6px;">
        ${escapeHtml(p.nombre)}
      </div>

      <table style="border-collapse:collapse; width:100%; font-size:12px;">
        <tr><td><b>#</b></td><td>${escapeHtml(String(p.id))}</td></tr>
        <tr><td><b>Estado</b></td><td>${escapeHtml(orDash(p.estado))}</td></tr>
        <tr><td><b>Sector</b></td><td>${escapeHtml(orDash(p.sector))}</td></tr>
        <tr><td><b>Dist</b></td><td>${Number.isFinite(p.distKm) ? p.distKm.toFixed(2) : "—"} km</td></tr>
        <tr><td><b>Inversión</b></td><td>${escapeHtml(formatMMU(p.inversion))}</td></tr>
      </table>

      ${links}
      ${extra}
    </div>
  `;

  // CDATA-safe
  return safeCdata(html);
}

/**
 * Balloon simple para el punto consulta y el círculo
 */
export function renderKmlBalloonForQuery({ model, kind = "punto" }) {
  const q = model.query;
  const title = kind === "circulo" ? "Área de análisis (radio)" : "Punto de consulta";

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial; font-size:12px;">
      <div style="font-weight:900; font-size:13px; margin-bottom:8px;">${escapeHtml(title)}</div>
      <div><b>Lat:</b> ${Number(q.lat).toFixed(6)}</div>
      <div><b>Lng:</b> ${Number(q.lng).toFixed(6)}</div>
      <div style="margin-top:8px;"><b>Modo:</b> ${escapeHtml(q.modo)}</div>
      <div><b>Radio:</b> ${Number.isFinite(q.radioKmFinal) ? q.radioKmFinal.toFixed(2) : "—"} km</div>
      <div><b>Proyectos:</b> ${escapeHtml(String(model.stats.totalProjects ?? model.projects.length))}</div>
    </div>
  `;
  return safeCdata(html);
}
