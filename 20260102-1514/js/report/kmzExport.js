// js/export/kmzExport.js
// Export KMZ para GeoEVA desde reportModel
// Requiere: JSZip global (window.JSZip)

import { circlePolygonCoords } from "../core/geo.js";
import { xmlEscape } from "../core/utils.js";
import { renderKmlBalloonHtml, renderKmlBalloonForQuery } from "../report/htmlRenderer.js";

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
  // Estilos simples (ajústalos cuando quieras)
  return `
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
      <outerBoundaryIs><LinearRing><coordinates>${ringCoords}</coordinates></LinearRing></outerBoundaryIs>
    </Polygon>
  </Placemark>
`;
}

export async function downloadProximityKMZ({ model, fileName = "" } = {}) {
  if (!model || !model.query) throw new Error("downloadProximityKMZ: model inválido.");
  if (!window.JSZip) throw new Error("JSZip no está disponible (carga jszip antes).");

  const q = model.query;
  const docName =
    fileName ||
    `GeoEVA_proximidad_${Number(q.lat).toFixed(5)}_${Number(q.lng).toFixed(5)}.kmz`;

  const kmlName = "doc.kml";
  const kmz = new window.JSZip();

  let kml = "";
  kml += kmlHeader("GeoEVA - Proximidad");
  kml += kmlStyleDefs();

  // Punto consulta (azul)
  kml += placemarkPoint({
    name: "Punto de consulta",
    lon: q.lng,
    lat: q.lat,
    styleUrl: "#stQuery",
    balloonHtmlCdata: renderKmlBalloonForQuery({ model, kind: "punto" }),
  });

  // Círculo (polígono)
  const ring = circlePolygonCoords(q.lng, q.lat, q.radioKmFinal || q.radioKmInput || 10, 120);
  if (ring) {
    kml += placemarkCircle({
      name: `Radio ${Number(q.radioKmFinal || 0).toFixed(2)} km`,
      ringCoords: ring,
      balloonHtmlCdata: renderKmlBalloonForQuery({ model, kind: "circulo" }),
    });
  }

  // Proyectos
  for (const p of model.projects) {
    const extraSummaryText = ""; // si quieres agregar texto desde graficos.js, lo inyectas aquí
    const balloon = renderKmlBalloonHtml({ model, p, extraSummaryText });

    kml += placemarkPoint({
      name: `${p.id}. ${p.nombre}`,
      lon: p.lon,
      lat: p.lat,
      styleUrl: styleForBucket(p.bucket),
      balloonHtmlCdata: balloon,
    });
  }

  kml += kmlFooter();

  kmz.file(kmlName, kml);

  const blob = await kmz.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = docName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
