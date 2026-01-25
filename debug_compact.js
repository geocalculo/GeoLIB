// debug_compact.js
import fs from "fs";

// 🔧 ajusta la ruta si tu archivo está en otro lado
const PATH = "./capas/nacional.compact.v2.json";

const raw = JSON.parse(fs.readFileSync(PATH, "utf8"));
const { columns, rows } = raw;

console.log("Total columnas:", columns.length);

console.log("\nPrimeras 15 columnas:");
columns.slice(0, 15).forEach((c, i) => console.log(`${i}: ${c}`));

const idxNombre = columns.indexOf("nombre");
const idxTitular = columns.indexOf("titular");
const idxTipo = columns.indexOf("tipo_proyecto");
const idxWeb = columns.indexOf("web");

console.log("\nÍndices detectados:");
console.log("nombre  =", idxNombre);
console.log("titular =", idxTitular);
console.log("tipo    =", idxTipo);
console.log("web     =", idxWeb);

console.log("\n--- PRIMER REGISTRO (row[0]) ---");
console.log("nombre  :", idxNombre >= 0 ? rows[0][idxNombre] : "(no existe)");
console.log("titular :", idxTitular >= 0 ? rows[0][idxTitular] : "(no existe)");
console.log("tipo    :", idxTipo >= 0 ? rows[0][idxTipo] : "(no existe)");
console.log("web     :", idxWeb >= 0 ? rows[0][idxWeb] : "(no existe)");

console.log("\n--- DUMP columnas 0..15 del primer registro ---");
columns.slice(0, 15).forEach((c, i) => {
  console.log(`${i}: ${c} =`, rows[0][i]);
});