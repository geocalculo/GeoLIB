import fs from "fs";

const PATH = "./capas/nacional.compact.v2.json";
const raw = JSON.parse(fs.readFileSync(PATH, "utf8"));
const { columns, rows } = raw;

function rowToObj(columns, row) {
  const o = {};
  for (let i = 0; i < columns.length; i++) o[columns[i]] = row[i];
  return o;
}

const o0 = rowToObj(columns, rows[0]);

console.log("OBJ0.nombre :", o0.nombre);
console.log("OBJ0.titular:", o0.titular);
console.log("OBJ0.web    :", o0.web);
console.log("OBJ0 keys   :", Object.keys(o0).slice(0, 12));