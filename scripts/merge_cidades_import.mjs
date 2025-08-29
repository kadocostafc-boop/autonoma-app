// scripts/merge_cidades_import.mjs
// Mescla cidades_import.json → cidades.json (com backup e modos de junção)
//
// Uso:
//   node scripts/merge_cidades_import.mjs
//   node scripts/merge_cidades_import.mjs --in ./cidades_import.json
//   node scripts/merge_cidades_import.mjs --mode add
//   node scripts/merge_cidades_import.mjs --mode replace
//
// Regras:
//   - mode add (default): adiciona cidades novas; soma bairros sem duplicar (acento/caixa-insensível).
//   - mode replace: para cada cidade presente no import, substitui a lista de bairros.
// Saída:
//   - Atualiza <DATA_DIR>/cidades.json (ou ./cidades.json se DATA_DIR não definido).
//   - Cria backup automático com timestamp antes de salvar.
//
// Requisitos: Node 18+

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---------- Args ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const argv = (() => {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.split("=");
      const key = k.replace(/^--/, "");
      if (v !== undefined) out[key] = v;
      else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) out[key] = process.argv[++i];
      else out[key] = true;
    }
  }
  return out;
})();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : PROJECT_ROOT;

const IMPORT_FILE = path.resolve(argv.in || path.join(PROJECT_ROOT, "cidades_import.json"));
const OUT_FILE = path.join(DATA_DIR, "cidades.json");
const MODE = (argv.mode || "add").toString().toLowerCase(); // add | replace

// ---------- Utils ----------
const norm = (s) => (s ?? "").toString().trim();
const canonical = (s) =>
  norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function readJsonIfExists(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      const j = JSON.parse(raw);
      if (j && typeof j === "object" && !Array.isArray(j)) return j;
    }
  } catch (e) {
    console.warn(`⚠ Não foi possível ler ${file}:`, e?.message || e);
  }
  return fallback;
}

function backupIfExists(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = file.replace(/\.json$/i, `.${stamp}.bak.json`);
  fs.copyFileSync(file, bak);
  return bak;
}

// ---------- Main ----------
function main() {
  console.log("▶ Merge: cidades_import.json → cidades.json");
  console.log(`   DATA_DIR: ${DATA_DIR}`);
  console.log(`   IMPORT:   ${IMPORT_FILE}`);
  console.log(`   OUT:      ${OUT_FILE}`);
  console.log(`   MODE:     ${MODE}`);

  if (!fs.existsSync(IMPORT_FILE)) {
    console.error("✖ Arquivo de importação não encontrado:", IMPORT_FILE);
    process.exit(1);
  }

  const base = readJsonIfExists(OUT_FILE, {});      // cidades.json atual
  const imp  = readJsonIfExists(IMPORT_FILE, null); // cidades_import.json
  if (!imp || !Object.keys(imp).length) {
    console.error("✖ Import vazio ou inválido.");
    process.exit(1);
  }

  const result = { ...base };
  let cidadesNovas = 0, cidadesAtualizadas = 0, bairrosAdicionados = 0, bairrosSubstituidos = 0;

  for (const [cidadeUF, lista] of Object.entries(imp)) {
    const incoming = Array.isArray(lista) ? lista.map(norm).filter(Boolean) : [];

    if (MODE === "replace") {
      const before = Array.isArray(result[cidadeUF]) ? result[cidadeUF].length : 0;
      result[cidadeUF] = [...new Set(incoming)].sort((a,b)=> a.localeCompare(b, "pt-BR"));
      if (before === 0) cidadesNovas++;
      else cidadesAtualizadas++;
      bairrosSubstituidos += before;
      continue;
    }

    // MODE === "add"
    if (!result[cidadeUF]) {
      result[cidadeUF] = [...new Set(incoming)].sort((a,b)=> a.localeCompare(b, "pt-BR"));
      cidadesNovas++;
      bairrosAdicionados += result[cidadeUF].length;
    } else {
      const canonSet = new Set(result[cidadeUF].map(canonical));
      let added = 0;
      for (const b of incoming) {
        const can = canonical(b);
        if (!canonSet.has(can)) {
          result[cidadeUF].push(b);
          canonSet.add(can);
          added++;
        }
      }
      if (added > 0) {
        result[cidadeUF] = result[cidadeUF].sort((a,b)=> a.localeCompare(b, "pt-BR"));
        cidadesAtualizadas++;
        bairrosAdicionados += added;
      }
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bak = backupIfExists(OUT_FILE);
  if (bak) console.log(`ℹ Backup criado: ${bak}`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");

  console.log("✅ Merge concluído!");
  console.log(`   Cidades novas:        ${cidadesNovas}`);
  console.log(`   Cidades atualizadas:  ${cidadesAtualizadas}`);
  console.log(`   Bairros adicionados:  ${bairrosAdicionados}`);
  if (MODE === "replace") {
    console.log(`   Bairros substituídos: ${bairrosSubstituidos}`);
  }
  console.log(`   Arquivo salvo em: ${OUT_FILE}`);
}

main();
