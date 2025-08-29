// scripts/merge_bairros.mjs
// Junta bairros novos (cidades_import.json) com cidades.json existente
// Uso:
//   node scripts/merge_bairros.mjs --in cidades_import.json --out cidades.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Normaliza strings (sem acento/maiúscula/minúscula)
function normalize(str) {
  return str
    ? str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
    : "";
}

// Lê argumentos
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, arr) => {
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
      return [key, val];
    }
    return [];
  })
);

if (!args.in || !args.out) {
  console.error("✖ Uso correto: node scripts/merge_bairros.mjs --in cidades_import.json --out cidades.json");
  process.exit(1);
}

const importFile = path.resolve(args.in);
const outFile = path.resolve(args.out);

if (!fs.existsSync(importFile)) {
  console.error("✖ Arquivo de entrada não encontrado:", importFile);
  process.exit(1);
}
if (!fs.existsSync(outFile)) {
  console.error("✖ Arquivo de saída base não encontrado:", outFile);
  process.exit(1);
}

// Lê JSONs
const novos = JSON.parse(fs.readFileSync(importFile, "utf8"));
const base = JSON.parse(fs.readFileSync(outFile, "utf8"));

console.log("🔄 Mesclando bairros...");
let totalNovos = 0;

for (const [cidadeUF, bairrosNovos] of Object.entries(novos)) {
  base[cidadeUF] ??= [];
  const existentes = base[cidadeUF];
  const set = new Set(existentes);

  for (const b of bairrosNovos) {
    const existe = [...set].some((e) => normalize(e) === normalize(b));
    if (!existe) {
      set.add(b);
      totalNovos++;
    }
  }

  base[cidadeUF] = Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Salva de volta
fs.writeFileSync(outFile, JSON.stringify(base, null, 2), "utf8");

console.log(`✅ Merge concluído: adicionados ${totalNovos} bairros novos.`);
console.log(`✅ Arquivo atualizado: ${outFile}`);
