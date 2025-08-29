// scripts/seed_cidades_ibge.mjs
// Gera/atualiza cidades.json com todas as cidades do Brasil via API do IBGE.
// Formato: { "Cidade/UF": ["Bairro 1","Bairro 2", ...], ... }
//
// Modo padrão: MERGE (preserva bairros existentes; adiciona novas cidades).
// Flags:
//   --overwrite   => sobrescreve cidades.json (não preserva bairros)
//   --prune       => remove cidades que não estão no IBGE (útil com bases antigas)
//
// Exemplo:
//   node scripts/seed_cidades_ibge.mjs
//   node scripts/seed_cidades_ibge.mjs --prune
//   node scripts/seed_cidades_ibge.mjs --overwrite

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, "..");
const OUT_FILE = path.join(DATA_DIR, "cidades.json");

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";

const args = new Set(process.argv.slice(2));
const FLAG_OVERWRITE = args.has("--overwrite");
const FLAG_PRUNE     = args.has("--prune");

// Utilitários
const norm = (s) => (s ?? "").toString().trim();
async function fetchWithTimeout(url, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
function readExisting(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && !Array.isArray(j)) return j;
  } catch {}
  return {};
}
function backupIfExists(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = file.replace(/\.json$/i, `.${stamp}.bak.json`);
  fs.copyFileSync(file, bak);
  return bak;
}

async function main() {
  console.log("▶ Seed IBGE — iniciando");
  console.log(`   DATA_DIR: ${DATA_DIR}`);
  console.log(`   OUT_FILE: ${OUT_FILE}`);
  console.log(`   Flags: ${FLAG_OVERWRITE ? "[--overwrite] " : ""}${FLAG_PRUNE ? "[--prune]" : ""}`.trim() || "(nenhuma)");

  console.log("▶ Baixando municípios do IBGE…");
  let res;
  try {
    res = await fetchWithTimeout(IBGE_URL, 25000);
  } catch (e) {
    console.error("✖ Timeout/erro de rede:", e?.message || e);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`✖ IBGE respondeu HTTP ${res.status}`);
    process.exit(1);
  }
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) {
    console.error("✖ Resposta IBGE vazia/inesperada.");
    process.exit(1);
  }

  const mapaIBGE = {};
  for (const m of arr) {
    const nome = norm(m?.nome);
    const uf   = norm(m?.microrregiao?.mesorregiao?.UF?.sigla);
    if (!nome || !uf) continue;
    const chave = `${nome}/${uf}`;
    mapaIBGE[chave] = mapaIBGE[chave] || [];
  }
  const totalIBGE = Object.keys(mapaIBGE).length;
  console.log(`✔ IBGE OK — ${totalIBGE} cidades.`);

  let existentes = {};
  if (!FLAG_OVERWRITE) {
    existentes = readExisting(OUT_FILE);
    console.log(`ℹ Merge: preservando bairros de ${Object.keys(existentes).length} cidade(s) já existentes.`);
  } else {
    console.log("ℹ Overwrite: NÃO preservará bairros existentes.");
  }

  let result = {};
  if (FLAG_OVERWRITE) {
    result = mapaIBGE;
  } else {
    // Merge: começa pelo IBGE
    result = { ...mapaIBGE };
    // Preserva bairros das existentes
    for (const [cidade, bairros] of Object.entries(existentes)) {
      const arrB = Array.isArray(bairros) ? bairros : [];
      if (!result[cidade]) {
        if (!FLAG_PRUNE) result[cidade] = [...new Set(arrB.map(norm))].filter(Boolean).sort((a,b)=>a.localeCompare(b));
      } else {
        const set = new Set(result[cidade]); // normalmente vazio
        arrB.map(norm).filter(Boolean).forEach(b => set.add(b));
        result[cidade] = Array.from(set).sort((a,b)=>a.localeCompare(b));
      }
    }
    // Remove cidades fora do IBGE, se pedido
    if (FLAG_PRUNE) {
      for (const c of Object.keys(result)) if (!mapaIBGE[c]) delete result[c];
    }
  }

  // Ordenar alfabeticamente
  const ordenadas = Object.keys(result).sort((a,b)=>a.localeCompare(b, "pt-BR"));
  const saida = {};
  for (const k of ordenadas) saida[k] = Array.isArray(result[k]) ? result[k] : [];

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bak = backupIfExists(OUT_FILE);
  if (bak) console.log(`ℹ Backup criado: ${bak}`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(saida, null, 2), "utf8");

  console.log(`✅ Gerado ${OUT_FILE} com ${Object.keys(saida).length} cidades.`);
  if (!FLAG_OVERWRITE) console.log("✅ Bairros existentes preservados (MERGE).");
  if (FLAG_PRUNE) console.log("✅ PRUNE: Cidades fora do IBGE removidas.");
  console.log("ℹ Pronto! O backend já pode sugerir cidades do Brasil inteiro.");
}

main().catch(err => {
  console.error("ERRO:", err?.message || err);
  process.exit(1);
});
