// ===========================
// GeoEVA - MapaInfo Logic
// Sistema de análisis de proximidad con labels inteligentes
// ===========================

const DATA_XLSX_URL = "capas/nacional.xlsx";
let globalParams = null;

function parseCoord(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/\s/g, "");
  if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.indexOf(",") >= 0) {
    s = s.replace(",", ".");
  }
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatMMU(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return (
    value.toLocaleString("es-CL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " MMU$"
  );
}

async function loadExcelData() {
  const resp = await fetch(DATA_XLSX_URL);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!json.length) return [];

  const rows = json.slice(1);

  const COL_NOMBRE = 0;
  const COL_WEB    = 1;
  const COL_TIPO   = 2;
  const COL_REGION = 3;
  const COL_INV    = 9;
  const COL_FECHA  = 10;
  const COL_ESTADO = 11;
  const COL_SECTOR = 13;
  const COL_LAT    = 14;
  const COL_LON    = 15;
  const COL_ANEXOS = 16;
  const COL_ANIO   = 17;

  const data = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    const lat = parseCoord(row[COL_LAT]);
    const lon = parseCoord(row[COL_LON]);
    if (lat === null || lon === null) continue;

    const invNum = parseCoord(row[COL_INV]);
    const anioVal = row[COL_ANIO];
    const anioNum =
      anioVal !== null && anioVal !== undefined && anioVal !== ""
        ? parseInt(anioVal, 10)
        : null;

    data.push({
      lat,
      lon,
      nombre: row[COL_NOMBRE] || "",
      web: row[COL_WEB] || "",
      tipo: row[COL_TIPO] || "",
      region: row[COL_REGION] || "",
      inversion: invNum,
      fechaIngreso: row[COL_FECHA] || null,
      estado: row[COL_ESTADO] || "",
      sector: row[COL_SECTOR] || "",
      anexos: row[COL_ANEXOS] || "",
      anio: anioNum,
    });
  }

  return data;
}

function ajustarZoomCirculo(map, circle) {
  const size = map.getSize();
  const minSide = Math.min(size.x, size.y);
  const paddingPx = minSide * 0.20;

  map.fitBounds(circle.getBounds(), {
    padding: [paddingPx, paddingPx]
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  globalParams = params;

  const lat = parseFloat(params.get("lat"));
  const lng = parseFloat(params.get("lng"));
  const modo = params.get("modo") || "radio";
  const radioParam = parseFloat(params.get("radio")) || 10;
  const nParam = parseInt(params.get("n") || "10", 10);
  const sectoresParam = params.get("sectores") || "";
  const sectoresFiltro = sectoresParam
    ? sectoresParam.split("|").filter(Boolean)
    : [];

  const coordsLabel = document.getElementById("coordsLabel");
  const modoLabel   = document.getElementById("modoLabel");
  const radioLabel  = document.getElementById("radioLabel");
  const countLabel  = document.getElementById("countLabel");
  const invLabel    = document.getElementById("invLabel");

  coordsLabel.textContent = `Punto: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  modoLabel.textContent =
    modo === "proximidad"
      ? `Modo: Proximidad (N=${nParam} aprobados)`
      : `Modo: Radio (R=${radioParam} km)`;

  const map = L.map("map", {
    center: [lat, lng],
    zoom: 10,
    minZoom: 4,
  });

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      opacity: 1.0,
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      opacity: 0.10,
      maxZoom: 19,
    }
  ).addTo(map);

  L.control.scale().addTo(map);

  L.circleMarker([lat, lng], {
    radius: 6,
    color: "#1d4ed8",
    weight: 2,
    fillColor: "#1d4ed8",
    fillOpacity: 1,
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = `
      <div class="legend-item">
        <span class="legend-color" style="background:#16a34a;"></span> Aprobado
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#ea580c;"></span> En calificación / evaluación
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#dc2626;"></span> Rechazado
      </div>
      <div class="legend-item">
        <span class="legend-color" style="background:#6b7280;"></span> Otros estados
      </div>
    `;
    return div;
  };
  legend.addTo(map);

  let proyectos;
  try {
    proyectos = await loadExcelData();
  } catch (err) {
    console.error("Error cargando nacional.xlsx en mapainfo.html:", err);
    radioLabel.textContent = "Radio: —";
    countLabel.textContent = "Error al cargar datos de proyectos para este detalle.";
    invLabel.textContent = "Inversión: —";
    return;
  }

  if (sectoresFiltro.length) {
    proyectos = proyectos.filter((p) => {
      const sectorLower = (p.sector || "").toLowerCase();
      return sectoresFiltro.some(
        (s) => sectorLower === s.trim().toLowerCase()
      );
    });
  }

  const todosConDist = proyectos.map((p) => ({
    ...p,
    distKm: distanceKm(lat, lng, p.lat, p.lon),
  }));

  let radioKm = radioParam;
  let topNSet = new Set();

  if (modo === "proximidad") {
    const aprobados = todosConDist.filter((p) =>
      (p.estado || "").toLowerCase().includes("aprob")
    );
    aprobados.sort((a, b) => a.distKm - b.distKm);

    const aprobTopN = aprobados.slice(0, nParam);

    if (aprobTopN.length) {
      radioKm = aprobTopN[aprobTopN.length - 1].distKm;
      topNSet = new Set(
        aprobTopN.map(
          (p) => `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`
        )
      );
    } else {
      radioKm = radioParam;
    }
  }

  const circle = L.circle([lat, lng], {
    radius: radioKm * 1000,
    color: "#1d4ed8",
    weight: 3,
    fill: false,
    fillOpacity: 0,
    interactive: false,
  }).addTo(map);

  ajustarZoomCirculo(map, circle);

  map.on("resize", () => {
    ajustarZoomCirculo(map, circle);
  });

  const dentro = todosConDist.filter((p) => p.distKm <= radioKm);

  let resumenAprob = 0;
  let resumenCalif = 0;
  let resumenRech  = 0;
  let resumenOtros = 0;

  let invAprob = 0;
  let invCalif = 0;
  let invRech  = 0;
  let invOtros = 0;

  const labelsInfo = [];

  dentro.forEach((p, index) => {
    const estadoL = (p.estado || "").toLowerCase();
    const key = `${p.lat}|${p.lon}|${(p.nombre || "").trim()}`;

    let color = "#6b7280";
    let bucket = "Otros";

    if (modo === "proximidad" && topNSet.has(key)) {
      color = "#16a34a";
      bucket = "Aprob";
    } else if (estadoL.includes("rech")) {
      color = "#dc2626";
      bucket = "Rech";
    } else if (estadoL.includes("calif") || estadoL.includes("eval")) {
      color = "#ea580c";
      bucket = "Calif";
    } else if (estadoL.includes("aprob")) {
      color = "#16a34a";
      bucket = "Aprob";
    }

    if (bucket === "Aprob") resumenAprob++;
    else if (bucket === "Calif") resumenCalif++;
    else if (bucket === "Rech") resumenRech++;
    else resumenOtros++;

    if (Number.isFinite(p.inversion)) {
      if (bucket === "Aprob") invAprob += p.inversion;
      else if (bucket === "Calif") invCalif += p.inversion;
      else if (bucket === "Rech") invRech += p.inversion;
      else invOtros += p.inversion;
    }

    const m = L.circleMarker([p.lat, p.lon], {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.8,
    });

    m.proyecto = p;
    m.bucket = bucket;

    m.bindPopup(`
      <strong>${p.nombre || "Proyecto sin nombre"}</strong><br/>
      <b>Tipo:</b> ${p.tipo || "—"}<br/>
      <b>Sector:</b> ${p.sector || "—"}<br/>
      <b>Inversión:</b> ${formatMMU(p.inversion)}<br/>
      <b>Estado:</b> ${p.estado || "—"}<br/>
      <b>Distancia:</b> ${p.distKm.toFixed(2)} km<br/><br/>
      <b>Expediente:</b> ${
        p.web
          ? `<a href="${p.web}" target="_blank">Abrir expediente</a>`
          : "—"
      }<br/>
      <b>Anexos:</b> ${
        p.anexos
          ? `<a href="${p.anexos}" target="_blank">Abrir anexos</a>`
          : "—"
      }
    `);

    m.addTo(markersLayer);

    const esImportante = bucket === 'Aprob' || (modo === 'proximidad' && topNSet.has(key));

    if (esImportante) {
      labelsInfo.push({
        proyecto: p,
        marker: m,
        color: color,
        bucket: bucket,
        index: index
      });
    }
  });

  // ✨ FUNCIÓN CON DETECCIÓN DE COLISIONES INTELIGENTE
  function actualizarLabelsConPolylines() {
    markersLayer.eachLayer((layer) => {
      if (layer.options && layer.options.esLabel) {
        markersLayer.removeLayer(layer);
      }
    });

    const zoom = map.getZoom();
    
    // Offset según zoom
    let offsetDist = 0.012;
    if (zoom < 10) offsetDist = 0.020;
    else if (zoom < 12) offsetDist = 0.015;
    else if (zoom >= 13) offsetDist = 0.008;

    // Umbral de colisión dinámico según zoom
    // REDUCIDO porque texto pelado ocupa menos espacio
    let umbralColision = 0.0015;  // Más pequeño que antes (era 0.003)
    if (zoom < 10) umbralColision = 0.003;   // Antes 0.006
    else if (zoom < 12) umbralColision = 0.002;  // Antes 0.004
    else if (zoom >= 13) umbralColision = 0.001;  // Antes 0.002

    // ✨ DEFINIR CUADRANTES Y OFFSETS
    const cuadranteOffsets = {
      'NE': { lat: +1, lng: +1 },
      'SE': { lat: -1, lng: +1 },
      'SW': { lat: -1, lng: -1 },
      'NW': { lat: +1, lng: -1 }
    };

    // Orden de prioridad: NE → SE → SW → NW (horario)
    const cuadrantesOrden = ['NE', 'SE', 'SW', 'NW'];

    // ✨ FUNCIÓN PARA CALCULAR BOUNDING BOX
    function calcularBoundingBox(lat, lng, nombreTexto) {
      const zoom = map.getZoom();
      let factorAncho = 0.00015;
      
      if (zoom < 10) factorAncho = 0.00025;
      else if (zoom < 12) factorAncho = 0.0002;
      else if (zoom >= 13) factorAncho = 0.00012;
      
      const anchoTexto = nombreTexto.length * factorAncho;
      const altoTexto = 0.002;
      
      return {
        latMin: lat - altoTexto / 2,
        latMax: lat + altoTexto / 2,
        lngMin: lng - anchoTexto / 2,
        lngMax: lng + anchoTexto / 2,
        nombre: nombreTexto
      };
    }

    // ✨ FUNCIÓN PARA VERIFICAR SI DOS BOUNDING BOXES COLISIONAN
    function colisionan(bb1, bb2) {
      const superponeHorizontal = bb1.lngMin <= bb2.lngMax && bb1.lngMax >= bb2.lngMin;
      const superponeVertical = bb1.latMin <= bb2.latMax && bb1.latMax >= bb2.latMin;
      return superponeHorizontal && superponeVertical;
    }

    // ✨ FASE 1: CREAR ARRAY DE LABELS CON POSICIONES INICIALES (todos en NE)
    const labelsConPosicion = [];
    
    labelsInfo.forEach((info) => {
      const p = info.proyecto;
      const distanciaAlPunto = distanceKm(lat, lng, p.lat, p.lon);
      if (distanciaAlPunto > radioKm) return;
      
      const nombreOriginal = p.nombre || "Sin nombre";
      const nombreMostrar = nombreOriginal.length > 20
        ? nombreOriginal.substring(0, 17) + '...'
        : nombreOriginal;
      
      // Posición inicial en NE
      const offset = cuadranteOffsets['NE'];
      const labelLat = p.lat + (offsetDist * offset.lat);
      const labelLng = p.lon + (offsetDist * offset.lng);
      
      labelsConPosicion.push({
        proyecto: p,
        info: info,
        nombreOriginal: nombreOriginal,
        nombreMostrar: nombreMostrar,
        cuadrante: 'NE',
        lat: labelLat,
        lng: labelLng,
        boundingBox: calcularBoundingBox(labelLat, labelLng, nombreMostrar)
      });
    });

    console.log(`📍 ${labelsConPosicion.length} labels creados, resolviendo colisiones...`);

    // ✨ FASE 2: RESOLVER COLISIONES - COMPARAR TODOS CON TODOS
    for (let i = 0; i < labelsConPosicion.length; i++) {
      for (let j = i + 1; j < labelsConPosicion.length; j++) {
        const label1 = labelsConPosicion[i];
        const label2 = labelsConPosicion[j];
        
        if (colisionan(label1.boundingBox, label2.boundingBox)) {
          console.log(`🔴 Colisión: "${label1.nombreMostrar}" vs "${label2.nombreMostrar}"`);
          
          // Intentar reubicar label2 en otro cuadrante
          let reubicado = false;
          
          for (const cuadrante of cuadrantesOrden) {
            if (cuadrante === label2.cuadrante) continue; // Ya probado
            
            // Calcular nueva posición
            const offset = cuadranteOffsets[cuadrante];
            const nuevaLat = label2.proyecto.lat + (offsetDist * offset.lat);
            const nuevaLng = label2.proyecto.lon + (offsetDist * offset.lng);
            const nuevoBB = calcularBoundingBox(nuevaLat, nuevaLng, label2.nombreMostrar);
            
            // Verificar si colisiona con TODOS los labels existentes
            let hayColisionConOtros = false;
            for (let k = 0; k < labelsConPosicion.length; k++) {
              if (k === j) continue; // No comparar consigo mismo
              
              const otroLabel = labelsConPosicion[k];
              if (colisionan(nuevoBB, otroLabel.boundingBox)) {
                hayColisionConOtros = true;
                break;
              }
            }
            
            if (!hayColisionConOtros) {
              // ✅ Encontramos un cuadrante sin colisión
              console.log(`  ✅ Reubicado "${label2.nombreMostrar}" de ${label2.cuadrante} a ${cuadrante}`);
              label2.cuadrante = cuadrante;
              label2.lat = nuevaLat;
              label2.lng = nuevaLng;
              label2.boundingBox = nuevoBB;
              reubicado = true;
              break;
            }
          }
          
          if (!reubicado) {
            console.warn(`  ⚠️ No se pudo reubicar "${label2.nombreMostrar}" sin colisiones`);
          }
        }
      }
    }

    // Contador de cuadrantes usados (para debug)
    const cuadrantesUsados = { NE: 0, SE: 0, SW: 0, NW: 0 };

    // ✨ FASE 3: RENDERIZAR LABELS CON SUS POSICIONES FINALES
    labelsConPosicion.forEach((label) => {
      const p = label.proyecto;
      const info = label.info;
      const labelLat = label.lat;
      const labelLng = label.lng;
      const cuadranteSeleccionado = label.cuadrante;
      
      cuadrantesUsados[cuadranteSeleccionado]++;

      // Crear línea conectora
      const polyline = L.polyline(
        [[p.lat, p.lon], [labelLat, labelLng]],
        {
          color: '#000000'
          weight: 1,
          opacity: 0.7,
          dashArray: '',
          esLabel: true,
          interactive: false
        }
      );
      polyline.proyecto = p;
      polyline.addTo(markersLayer);

      let labelClass = 'project-label';
      if (info.bucket === 'Aprob') labelClass += ' project-label-aprobado';
      else if (info.bucket === 'Calif') labelClass += ' project-label-calificacion';
      else if (info.bucket === 'Rech') labelClass += ' project-label-rechazado';

      const labelIcon = L.divIcon({
        className: 'project-label-icon',
        html: `<div class="${labelClass}" title="${label.nombreOriginal}" data-cuadrante="${cuadranteSeleccionado}">${label.nombreMostrar}</div>`,
        iconSize: null,
        iconAnchor: [0, 10]
      });

      const labelMarker = L.marker([labelLat, labelLng], { 
        icon: labelIcon,
        interactive: false,
        esLabel: true
      });
      labelMarker.proyecto = p;
      labelMarker.cuadrante = cuadranteSeleccionado;
      labelMarker.addTo(markersLayer);
    });

    // Log de distribución (para debugging)
    console.log('📊 Distribución de cuadrantes:', cuadrantesUsados);
    console.log(`   Total labels: ${Object.values(cuadrantesUsados).reduce((a, b) => a + b, 0)}`);
  }

  actualizarLabelsConPolylines();

  map.on('zoomend', () => {
    actualizarLabelsConPolylines();
  });

  // ==============================
  // ✨ SISTEMA DE HIGHLIGHTING A++
  // ==============================

  let currentFilter = null;
  let highlightedProjectKeys = new Set();
  let highlightRingsGroup = L.layerGroup().addTo(map);

  window.highlightMapProjects = function(projectKeys, filterInfo) {
    if (!projectKeys || projectKeys.length === 0) {
      resetHighlight();
      return;
    }

    currentFilter = filterInfo;
    highlightedProjectKeys = new Set(projectKeys);

    applyHighlight();
    updateFilterUI();
  };

  function applyHighlight() {
    markersLayer.eachLayer((layer) => {
      if (!layer.proyecto) return;

      const p = layer.proyecto;
      const key = `${p.nombre}|${p.sector}|${p.region}`;
      const isHighlighted = highlightedProjectKeys.has(key);

      if (layer instanceof L.CircleMarker && !layer.options.esLabel) {
        if (isHighlighted) {
          const el = layer.getElement();
          if (el) {
            el.style.opacity = '1';
            el.style.transform = 'scale(1.5)';
          }
        } else {
          const el = layer.getElement();
          if (el) el.style.opacity = '0.25';
        }
      }

      if (layer instanceof L.Polyline && layer.options.esLabel) {
        if (layer._path) {
          layer._path.style.strokeOpacity = isHighlighted ? '1' : '0.2';
          layer._path.style.strokeWidth = isHighlighted ? '3px' : '2px';
        }
      }

      if (layer instanceof L.Marker && layer.options.esLabel) {
        const el = layer.getElement();
        if (el) {
          const labelDiv = el.querySelector('.project-label');
          if (labelDiv) {
            if (isHighlighted) {
              labelDiv.classList.add('project-label-highlighted');
              labelDiv.classList.remove('project-label-dimmed');
            } else {
              labelDiv.classList.add('project-label-dimmed');
              labelDiv.classList.remove('project-label-highlighted');
            }
          }
        }
      }
    });

    addHighlightRings();
  }

  function resetHighlight() {
    currentFilter = null;
    highlightedProjectKeys.clear();

    markersLayer.eachLayer((layer) => {
      if (!layer.proyecto) return;

      if (layer instanceof L.CircleMarker && !layer.options.esLabel) {
        const el = layer.getElement();
        if (el) {
          el.style.opacity = '';
          el.style.transform = '';
        }
      }

      if (layer instanceof L.Polyline && layer.options.esLabel) {
        if (layer._path) {
          layer._path.style.strokeOpacity = '';
          layer._path.style.strokeWidth = '';
        }
      }

      if (layer instanceof L.Marker && layer.options.esLabel) {
        const el = layer.getElement();
        if (el) {
          const labelDiv = el.querySelector('.project-label');
          if (labelDiv) {
            labelDiv.classList.remove('project-label-highlighted', 'project-label-dimmed');
          }
        }
      }
    });

    removeHighlightRings();
    updateFilterUI();
  }

  function addHighlightRings() {
    removeHighlightRings();

    dentro.forEach((p) => {
      const key = `${p.nombre}|${p.sector}|${p.region}`;
      
      if (highlightedProjectKeys.has(key)) {
        const estadoL = (p.estado || "").toLowerCase();
        let ringColor = "#667eea";
        
        if (estadoL.includes("aprob")) ringColor = "#16a34a";
        else if (estadoL.includes("calif") || estadoL.includes("eval")) ringColor = "#ea580c";
        else if (estadoL.includes("rech")) ringColor = "#dc2626";

        const ring = L.circle([p.lat, p.lon], {
          radius: 150,
          color: ringColor,
          weight: 3,
          fill: false,
          interactive: false
        });

        const svg = ring.getElement();
        if (svg) {
          svg.style.animation = 'pulse-ring 2s ease-out infinite';
        }

        highlightRingsGroup.addLayer(ring);
      }
    });
  }

  function removeHighlightRings() {
    highlightRingsGroup.clearLayers();
  }

  function updateFilterUI() {
    let counterDiv = document.querySelector('.filter-counter');
    let resetBtn = document.querySelector('.filter-reset-btn');

    if (!counterDiv) {
      counterDiv = document.createElement('div');
      counterDiv.className = 'filter-counter';
      document.querySelector('.map-square').appendChild(counterDiv);
    }

    if (!resetBtn) {
      resetBtn = document.createElement('button');
      resetBtn.className = 'filter-reset-btn';
      resetBtn.textContent = '✕ Limpiar filtro';
      resetBtn.onclick = resetHighlight;
      document.querySelector('.map-square').appendChild(resetBtn);
    }

    if (highlightedProjectKeys.size > 0) {
      counterDiv.innerHTML = `
        📊 <strong>${highlightedProjectKeys.size}</strong> proyecto(s) filtrado(s)
        ${currentFilter ? `<br><small>${currentFilter}</small>` : ''}
      `;
      counterDiv.classList.add('active');
      resetBtn.classList.add('active');
    } else {
      counterDiv.classList.remove('active');
      resetBtn.classList.remove('active');
    }
  }

  radioLabel.textContent = `Radio: ${radioKm.toFixed(1)} km`;
  countLabel.textContent =
    `Resumen – Aprob: ${resumenAprob} | Calif: ${resumenCalif} | ` +
    `Rech: ${resumenRech} | Otros: ${resumenOtros}`;
  invLabel.textContent =
    `Inversión – Aprob: ${formatMMU(invAprob)} | ` +
    `Calif: ${formatMMU(invCalif)} | ` +
    `Rech: ${formatMMU(invRech)} | ` +
    `Otros: ${formatMMU(invOtros)}`;

  const chartData = dentro.map((p) => {
    const tipoRaw = (p.tipo || "").toUpperCase();
    let tipoNorm = "Otros";
    if (tipoRaw.includes("EIA")) tipoNorm = "EIA";
    else if (tipoRaw.includes("DIA")) tipoNorm = "DIA";

    return {
      tipo: tipoNorm,
      estado: p.estado || "Otros",
      sector: p.sector || "Sin sector",
      region: p.region || "Sin región",
      nombre: p.nombre || "Sin nombre",
      inversionMm: p.inversion || 0,
      anio:
        p.anio !== null && p.anio !== undefined && p.anio !== ""
          ? parseInt(p.anio, 10)
          : null,
      distKm: p.distKm,
    };
  });

  window.chartDataGlobal = chartData;

  if (typeof window.initCharts === "function") {
    window.initCharts(chartData);
  } else {
    console.warn("initCharts(chartData) no está definido. Revisa js/graficos.js");
  }
});

const style = document.createElement('style');
style.textContent = `
  @keyframes pulse-ring {
    0% {
      stroke-opacity: 1;