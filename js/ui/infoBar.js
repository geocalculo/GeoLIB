// js/ui/infoBar.js
// Rellena la barra superior de mapainfo.html

import { formatMMU } from "../core/utils.js";

export function renderInfoBar(model, ids = {}) {
  const {
    coordsLabelId = "coordsLabel",
    modoLabelId = "modoLabel",
    radioLabelId = "radioLabel",
    countLabelId = "countLabel",
    invLabelId = "invLabel",
  } = ids;

  const elCoords = document.getElementById(coordsLabelId);
  const elModo = document.getElementById(modoLabelId);
  const elRadio = document.getElementById(radioLabelId);
  const elCount = document.getElementById(countLabelId);
  const elInv = document.getElementById(invLabelId);

  if (!model?.query) return;

  const q = model.query;
  const total = model.stats?.totalProjects ?? model.projects?.length ?? 0;

  if (elCoords) elCoords.textContent = `Punto: lat ${q.lat.toFixed(6)}, lng ${q.lng.toFixed(6)}`;

  if (elModo) {
    elModo.textContent =
      `Modo: ${q.modo === "proximidad" ? "Proximidad (Top N aprobados)" : "Radio fijo"}`;
  }

  if (elRadio) {
    const r = Number.isFinite(q.radioKmFinal) ? q.radioKmFinal : (Number.isFinite(q.radioKmInput) ? q.radioKmInput : null);
    elRadio.textContent = `Radio: ${r != null ? r.toFixed(2) : "—"} km`;
  }

  if (elCount) {
    const a = model.stats?.counts?.Aprob ?? 0;
    const c = model.stats?.counts?.Calif ?? 0;
    const r = model.stats?.counts?.Rech ?? 0;
    const o = model.stats?.counts?.Otros ?? 0;
    elCount.textContent = `Resumen: ${total} (Aprob ${a} / Calif ${c} / Rech ${r} / Otros ${o})`;
  }

  if (elInv) {
    const inv = Number.isFinite(model.stats?.invTotal) ? model.stats.invTotal : 0;
    elInv.textContent = `Inversión: ${formatMMU(inv)}`;
  }
}
