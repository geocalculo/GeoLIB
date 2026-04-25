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
import { trackEvent } from "../core/tracking.js";

const RUNTIME_DEBUG_KMZ =
  window.__GEOEVA_RUNTIME_DEBUG__ === true ||
  new URLSearchParams(window.location.search).get("debugRuntime") === "1";

function kmzDebugLog(...args) {
  if (!RUNTIME_DEBUG_KMZ) return;
  console.log("[GeoEVA][KMZ]", ...args);
}

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
  kmzDebugLog("enter downloadProximityKMZ", {
    hasModel: Boolean(model),
    hasQuery: Boolean(model?.query),
  });

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
  const proyectos = Array.isArray(model.projects) ? model.projects.length : null;
  const radioKm = Number.isFinite(radioFinal) ? Number(radioFinal.toFixed(2)) : null;

  const zip = new window.JSZip();
  const kmlName = "doc.kml";

  let objectUrl = null;

  try {
    kmzDebugLog("before trackEvent geo_download_attempt/kmz", { kmzName, radioKm, proyectos });
    trackEvent({
      event: "geo_download_attempt",
      result_type: "mapainfo",
      file_type: "kmz",
      method: "button_click",
      projects_total: Number.isFinite(proyectos) ? proyectos : 0,
    });
    kmzDebugLog("after trackEvent geo_download_attempt/kmz");

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
    kmzDebugLog("blob generated", { size: blob?.size ?? null, type: blob?.type ?? null });

    const a = document.createElement("a");
    objectUrl = URL.createObjectURL(blob);
    kmzDebugLog("objectUrl created");

    kmzDebugLog("before trackEvent geo_download_success/kmz", {
      kmzName,
      stage: "blob_ready_pre_click",
    });
    trackEvent({
      event: "geo_download_success",
      result_type: "mapainfo",
      file_type: "kmz",
      method: "button_click",
      projects_total: Number.isFinite(proyectos) ? proyectos : 0,
    });
    kmzDebugLog("after trackEvent geo_download_success/kmz");

    a.href = objectUrl;
    a.download = kmzName;
    document.body.appendChild(a);

    kmzDebugLog("before a.click()");
    a.click();
    kmzDebugLog("after a.click()");
    a.remove();
    kmzDebugLog("anchor removed");
  } catch (err) {
    kmzDebugLog("error in downloadProximityKMZ", err);
    throw err;
  } finally {
    if (objectUrl) {
      kmzDebugLog("schedule URL.revokeObjectURL");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    }
  }
}
