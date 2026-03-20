# Auditoría estructural del frontend de GeoEVA

## A. Diagnóstico estructural

### Entry point real actual
- `index.html` es el documento de arranque del frontend público.
- El entrypoint JS real cargado por la app quedó consolidado en `js/app/index.js`.
- El CSS principal quedó consolidado en `css/app.css`.
- Se retiró del HTML toda carga de onboarding, balloon y dependencias no usadas por el frontend actual.

### Problemas detectados antes de la depuración
- Convivían tres versiones de bootstrap JS para la misma pantalla: `js/index.js`, `js/index-fullheight.js` y `js/app/index.js`.
- Había dos CSS principales históricos (`css/index.css` y `css/index-fullheight.css`) con responsabilidades solapadas.
- El HTML activo cargaba `js/app/index.js`, pero este archivo todavía contenía referencias a DOM inexistente (`bboxInfo`, `configPanel`, `nSlider`, `radioSlider`, `summaryTableContainer`, `sectorTableContainer`, etc.).
- El HTML activo seguía incluyendo onboarding aunque el objetivo funcional actual ya no lo requería.
- Coexistían tres mecanismos de ayuda/hint con comportamiento superpuesto: `#map-balloon`, `#map-hint-cursor` y la ayuda móvil heredada implícita en estilos/lógica legacy.
- El frontend mezclaba en un mismo bootstrap: mapa, UI, onboarding, tracking, panel legacy, ayudas UX y residuos de versiones previas.

## B. Archivos realmente usados vs legacy

### Usados por la app tras la depuración
- `index.html`
- `js/app/index.js`
- `js/core/dataLoader.js`
- `js/core/utils.js`
- `js/core/logger.js`
- `js/app/router.js`
- `css/app.css`
- `capas/nacional.compact.v2.json`
- `capas/regiones.json`

### Legacy o candidatos a archivar/eliminar
- `js/index.js`: versión histórica no cargada por `index.html`.
- `js/index-fullheight.js`: versión histórica no cargada por `index.html`.
- `js/onboarding.js`: ya no cargado; dependía de un onboarding eliminado.
- `css/index.css`: CSS histórico con onboarding y hint cursor; ya no cargado.
- `css/index-fullheight.css`: CSS histórico full-height con panel/configuración legacy; ya no cargado.
- `js/app/state.js`: no participa en el flujo actual del index.

### Archivos que parecían “vivos” pero no mandaban realmente
- `js/index.js` y `js/index-fullheight.js` contienen lógica funcional relevante, pero no eran cargados por el `index.html` activo.
- `css/index.css` tenía reglas activas para onboarding y `map-hint-cursor`, pero nunca aplicaban si el HTML seguía cargando `css/index-fullheight.css`.
- `js/onboarding.js` sí estaba cargado antes, pero quedó fuera del flujo final porque el onboarding fue eliminado del markup y del comportamiento actual.

## C. Duplicidades y conflictos detectados

### JavaScript
- Carga de regiones duplicada entre `js/index-fullheight.js`, `js/index.js` y `js/app/index.js`.
- Geolocalización duplicada entre `js/index.js` y `js/app/index.js`.
- Persistencia de basemap (`geoeva_basemap`) duplicada entre `js/index-fullheight.js` y `js/app/index.js`.
- Lógica de apertura de `mapainfo.html` implementada manualmente en más de una variante.
- Resumen móvil duplicado con criterios de bucket distintos entre `js/index.js` y `js/app/index.js`.
- En `js/app/index.js` coexistían funciones útiles con referencias muertas a panel/configuración legacy inexistente en el HTML activo.

### CSS
- Reset global y layout full-height duplicados entre `css/index.css` y `css/index-fullheight.css`.
- Estilos de onboarding duplicados en ambos CSS.
- Estilos de ayuda/hint dispersos entre balloon, cursor hint y clases de onboarding.
- Reglas para panel lateral/configuración en `css/index-fullheight.css` sin correspondencia real en el HTML activo.

## D. Arquitectura frontend final propuesta

```text
index.html
css/
  app.css                 # único stylesheet del index público
js/
  app/
    index.js              # bootstrap del index
    router.js             # construcción/parsing de URLs a mapainfo
  core/
    dataLoader.js         # carga y normalización de dataset
    utils.js              # utilidades puras compartidas
    logger.js             # logging controlado por entorno
```

### Responsabilidades recomendadas
- **Mapa:** inicialización Leaflet, capas base, geolocalización, markers, click sobre mapa.
- **UI:** select de regiones, resumen móvil y wiring del DOM del index.
- **Hints / ayudas UX:** módulo o bloque aislado con dos hints explícitos (`desktop` y `mobile`) y storage propio.
- **Tracking / analytics:** helper pequeño (`track`) aislado de la lógica de negocio.
- **Banners:** dejar en HTML/CSS como bloque desacoplado, sin contaminar el bootstrap del mapa.

## E. Qué eliminar, qué fusionar y qué conservar

### Conservar
- `js/core/dataLoader.js`, `js/core/utils.js`, `js/core/logger.js`, `js/app/router.js`.
- `index.html` como shell único.
- `js/app/index.js` como único bootstrap del index.
- Dataset compacto JSON como fuente principal del index.

### Fusionar
- Toda la lógica útil de mapa/UI del index debe vivir sólo en `js/app/index.js` o dividirse después en módulos (`mapController`, `regionController`, `hintController`) pero sin duplicar reglas.
- El sistema de hints debe quedar en sólo dos nodos/estados: uno desktop y uno mobile.

### Eliminar o archivar
- `#map-balloon`.
- `#map-hint-cursor`.
- Markup, JS y CSS del onboarding eliminado.
- Panel/configuración legacy no renderizado por el HTML actual.
- `js/index.js`, `js/index-fullheight.js`, `css/index.css`, `css/index-fullheight.css`, `js/onboarding.js` como artefactos legacy a mover a una carpeta `archive/` en una segunda etapa controlada.

## F. Plan de refactor por etapas con bajo riesgo

### Etapa 1 — Consolidación de entrada
- Dejar un solo `index.html`.
- Dejar un solo JS bootstrap para index.
- Dejar un solo CSS principal.
- Eliminar del HTML referencias a onboarding y hints legacy.

### Etapa 2 — Saneamiento funcional
- Remover funciones que referencian DOM inexistente.
- Unificar bucketización de estados en una sola función.
- Cambiar la carga de datos del index a JSON compacto como fuente oficial.

### Etapa 3 — Modularización interna
- Separar `mapController`, `uiController`, `hintController` y `analytics` dentro de `js/app/`.
- Mantener `core/` como capa pura sin DOM.

### Etapa 4 — Archivo físico de legacy
- Mover archivos históricos a `archive/frontend-legacy/`.
- Añadir README corto con trazabilidad de por qué quedaron archivados.
- Ejecutar smoke test visual/manual antes de borrar definitivamente.

### Etapa 5 — Hardening de producción
- Añadir smoke tests E2E básicos para: carga de mapa, cambio de región, click mapa, apertura de `mapainfo`, y visibilidad/cierre de hints.
- Registrar métricas de errores de carga y fallos de geolocalización.

## G. Resultado técnico de esta depuración
- El index quedó sin onboarding.
- El sistema de ayudas quedó reducido a:
  - 1 hint desktop
  - 1 hint mobile
  - sin `map-balloon`
  - sin `map-hint-cursor`
- Se eliminó la dependencia del bootstrap principal respecto de DOM inexistente.
- Se formalizó el uso de `capas/nacional.compact.v2.json` como fuente del frontend del index.
- Los archivos históricos quedaron claramente identificados como no cargados por la app actual.
