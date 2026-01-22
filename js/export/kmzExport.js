// js/export/kmzExport.js
// GeoEVA - Exportador KMZ (JSZip)
// Uso:
//   import { downloadProximityKMZ } from "./export/kmzExport.js";
//   await downloadProximityKMZ({ model });
//
// Requisitos globales en HTML:
// - JSZip cargado antes del módulo (window.JSZip)
//
// Depende de módulos internos:
// - core/geo.js (circlePolygonCoords)
// - core/utils.js (xmlEscape)
// - report/htmlRenderer.js (renderKmlBalloonHtml, renderKmlBalloonForQuery)

import { circlePolygonCoords } from "../core/geo.js";
import { xmlEscape } from "../core/utils.js";
import {
  renderKmlBalloonHtml,
  renderKmlBalloonForQuery,
} from "../report/htmlRenderer.js";

// ---------------------------
// Helpers KML
// ---------------------------

function kmlHeader(docName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${xmlEscape(docName)}</name>
`;
}

function kmlFooter() {
  return `</Document></kml>`;
}

function kmlStyleDefs() {
  // Colores KML en formato aabbggrr (alpha, blue, green, red)
  // Ojo: IconStyle usa imágenes, Line/Poly usan color.
  return `
  <!-- ===== Styles ===== -->
  <Style id="stAprob">
    <IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle>
  </Style>
  <Style id="stCalif">
    <IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle>
  </Style>
  <Style id="stRech">
    <IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle>
  </Style>
  <Style id="stOtros">
    <IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href></Icon></IconStyle>
  </Style>

  <Style id="stQuery">
    <IconStyle><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href></Icon></IconStyle>
  </Style>

  <Style id="stCircle">
    <LineStyle><color>ff1d4ed8</color><width>2</width></LineStyle>
    <PolyStyle><color>331d4ed8</color></PolyStyle>
  </Style>
`;
}

function styleForBucket(bucket) {
  if (bucket === "Aprob") return "#stAprob";
  if (bucket === "Calif") return "#stCalif";
  if (bucket === "Rech") return "#stRech";
  return "#stOtros";
}

function placemarkPoint({ name, lon, lat, styleUrl, balloonHtmlCdata }) {
  return `
  <Placemark>
    <name>${xmlEscape(name)}</name>
    <styleUrl>${styleUrl}</styleUrl>
    <description><![CDATA[${balloonHtmlCdata}]]></description>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>
`;
}

function placemarkCircle({ name, ringCoords, balloonHtmlCdata }) {
  return `
  <Placemark>
    <name>${xmlEscape(name)}</name>
    <styleUrl>#stCircle</styleUrl>
    <description><![CDATA[${balloonHtmlCdata}]]></description>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>${ringCoords}</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
`;
}

function safeFileName(s) {
  return String(s || "GeoEVA_proximidad")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

// ---------------------------
// API principal
// ---------------------------

export async function downloadProximityKMZ({ model, fileName } = {}) {
  if (!model || !model.query) {
    throw new Error("downloadProximityKMZ: model inválido.");
  }
  if (!window.JSZip) {
    throw new Error("JSZip no está disponible. Carga jszip.min.js antes del módulo.");
  }

  const q = model.query;
  const lat = Number(q.lat);
  const lng = Number(q.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("downloadProximityKMZ: lat/lng inválidos.");
  }

  const radioFinal =
    Number.isFinite(q.radioKmFinal) && q.radioKmFinal > 0
      ? q.radioKmFinal
      : Number.isFinite(q.radioKmInput) && q.radioKmInput > 0
      ? q.radioKmInput
      : 10;

  const baseName =
    fileName ||
    `GeoEVA_${q.modo || "proximidad"}_${lat.toFixed(5)}_${lng.toFixed(5)}_${radioFinal.toFixed(2)}km`;
  const kmzName = safeFileName(baseName) + ".kmz";

  // Helper GA4 seguro (no rompe si gtag no existe)
  const gaEvent = (name, params = {}) => {
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, params);
    } catch (_) {}
  };

  // 1) INTENTO (click / inicio export)
  gaEvent("download_kmz", {
    event_category: "export",
    event_label: kmzName,
    mode: String(q.modo || "proximidad"),
    radio_km: Number(radioFinal.toFixed(2)),
  });

  const zip = new window.JSZip();
  const kmlName = "doc.kml";

  let objectUrl = null;

  try {
    let kml = "";
    kml += kmlHeader("GeoEVA - Proximidad");
    kml += kmlStyleDefs();

    // Punto consulta
    kml += placemarkPoint({
      name: "Punto de consulta",
      lon: lng,
      lat: lat,
      styleUrl: "#stQuery",
      balloonHtmlCdata: renderKmlBalloonForQuery({ model, kind: "punto" }),
    });

    // Círculo
    const ring = circlePolygonCoords(lng, lat, radioFinal, 120);
    if (ring) {
      kml += placemarkCircle({
        name: `Radio ${radioFinal.toFixed(2)} km`,
        ringCoords: ring,
        balloonHtmlCdata: renderKmlBalloonForQuery({ model, kind: "circulo" }),
      });
    }

    // Proyectos
    for (const p of model.projects || []) {
      // (opcional) valida coords del proyecto
      const plon = Number(p.lon);
      const plat = Number(p.lat);
      if (!Number.isFinite(plon) || !Number.isFinite(plat)) continue;

      const balloon = renderKmlBalloonHtml({
        model,
        p,
        extraSummaryText: "",
      });

      kml += placemarkPoint({
        name: `${p.id}. ${p.nombre || "Proyecto"}`,
        lon: plon,
        lat: plat,
        styleUrl: styleForBucket(p.bucket),
        balloonHtmlCdata: balloon,
      });
    }

    kml += kmlFooter();

    zip.file(kmlName, kml);

    const blob = await zip.generateAsync({ type: "blob" });

    const a = document.createElement("a");
    objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = kmzName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // 2) ÉXITO REAL (descarga disparada)
    gaEvent("download_kmz_success", {
      event_category: "export",
      event_label: kmzName,
      mode: String(q.modo || "proximidad"),
      radio_km: Number(radioFinal.toFixed(2)),
      projects_n: Array.isArray(model.projects) ? model.projects.length : 0,
    });
  } catch (err) {
    // (opcional) evento de error para diagnóstico
    gaEvent("download_kmz_error", {
      event_category: "export",
      event_label: kmzName,
      error_message: String(err?.message || err || "unknown"),
    });
    throw err;
  } finally {
    // Revocar objectURL aunque ocurra error
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    }
  }
}

