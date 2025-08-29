// scripts/csv_bairros_to_json.mjs
// Converte um CSV (cidade,uf,bairro) em JSON estruturado para Autônoma.app,
// com detecção automática de encoding (UTF-8 → fallback Latin-1/Windows-1252).
//
// Uso:
//   node scripts/csv_bairros_to_json.mjs --in dados.csv --pretty
//   node scripts/csv_bairros_to_json.mjs --in dados.csv --pretty --post http://localhost:3000 --cookie "connect.sid=XYZ"
//   node scripts/csv_bairros_to_json.mjs --in dados.csv --encoding utf8|latin1   (força encoding, opcional)
//
// Saída: cria ./cidades_import.json no formato { "Cidade/UF": ["Bairro 1", ...], ... }
//
// Requisitos:
//   - Node 18+
//   - Dependência: csv-parse (modo sync) →  npm i -D csv-parse

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- args ----
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

if (!args.in) {
  console.error(
    "✖ Uso correto:\n" +
      "  node scripts/csv_bairros_to_json.mjs --in dados.csv [--pretty]\n" +
      "  node scripts/csv_bairros_to_json.mjs --in dados.csv [--post URL] [--cookie TOKEN]\n" +
      "  node scripts/csv_bairros_to_json.mjs --in dados.csv [--encoding utf8|latin1]\n"
  );
  process.exit(1);
}

const inputFile = path.resolve(args.in);
if (!fs.existsSync(inputFile)) {
  console.error("✖ Arquivo CSV não encontrado:", inputFile);
  process.exit(1);
}

const FORCE_ENCODING = (args.encoding || "").toString().toLowerCase(); // "", "utf8", "latin1"
const PRETTY = !!args.pretty;

// ---- helpers ----
function normalizeSimple(str) {
  return str
    ? str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
    : "";
}

// Heurística: detecta “mojibake” típico quando UTF-8 foi interpretado como Latin-1
function looksLikeMojibake(s) {
  if (!s) return false;
  // presença de substituição (�) ou sequências clássicas de mojibake
  const bad = /�|Ã.|Â.|â..|Ã\u0083|Ã\u009F|Ã\u0089|Ã\u00A7/i;
  return bad.test(s);
}

function readCsvAuto(file) {
  if (FORCE_ENCODING === "utf8") {
    const txt = fs.readFileSync(file, "utf8");
    return { text: txt, encoding: "utf8" };
  }
  if (FORCE_ENCODING === "latin1") {
    const txt = fs.readFileSync(file, "latin1");
    return { text: txt, encoding: "latin1" };
  }

  // 1) tenta UTF-8
  let text = fs.readFileSync(file, "utf8");
  // se parecer mojibake, relê como latin1
  if (looksLikeMojibake(text)) {
    const latin = fs.readFileSync(file, "latin1");
    console.warn("⚠ Detectado possível mojibake; usando encoding Latin-1/Windows-1252.");
    return { text: latin, encoding: "latin1" };
  }
  return { text, encoding: "utf8" };
}

// ---- leitura + parse ----
console.log("Convertendo CSV → JSON");
console.log("   Arquivo:", inputFile);

const { text: content, encoding: usedEnc } = readCsvAuto(inputFile);
console.log("   Encoding detectado:", usedEnc.toUpperCase());

let records;
try {
  records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ",",
    relax_column_count: true,
    trim: true,
  });
} catch (err) {
  console.error("✖ Erro ao ler CSV:", err?.message || err);
  process.exit(1);
}

// ---- transforma em mapa cidade/UF -> bairros ----
const mapa = {};
let validos = 0;

for (const row of records) {
  // aceita variações de cabeçalho (cidade, uf, bairro), com/sem acentos
  // mapeando pelo nome esperado em minúsculas
  const colsLower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toString().trim().toLowerCase(), v])
  );

  const cidade = (colsLower["cidade"] || "").toString().trim();
  const uf = (colsLower["uf"] || "").toString().trim().toUpperCase();
  const bairro = (colsLower["bairro"] || "").toString().trim();

  if (!cidade || !uf || !bairro) continue;

  const chave = `${cidade}/${uf}`;
  mapa[chave] ??= [];

  // Dedup (sem acento/caixa)
  const exists = mapa[chave].some((b) => normalizeSimple(b) === normalizeSimple(bairro));
  if (!exists) {
    mapa[chave].push(bairro);
    validos++;
  }
}

// ---- ordena e salva ----
const saida = {};
for (const [cidadeUF, bairros] of Object.entries(mapa).sort((a, b) =>
  a[0].localeCompare(b[0], "pt-BR")
)) {
  saida[cidadeUF] = bairros.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

const outFile = path.resolve(__dirname, "..", "cidades_import.json");
fs.writeFileSync(outFile, JSON.stringify(saida, null, PRETTY ? 2 : 0), "utf8");

console.log(`✔ Linhas válidas: ${validos}`);
console.log(`✔ Cidades no JSON: ${Object.keys(saida).length}`);
console.log(`✅ JSON salvo em: ${outFile}`);

// ---- envio opcional ao servidor ----
if (args.post) {
  const url = args.post.endsWith("/") ? args.post.slice(0, -1) : args.post;
  const chunkSize = parseInt(args["post-chunk"] || "300", 10);
  const cookie = args.cookie || "";

  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;

  const cidades = Object.entries(saida);
  console.log(`🔄 Enviando ${cidades.length} cidades em lotes de ${chunkSize} para ${url}/api/admin/geo/import`);

  let loteIdx = 0;
  for (let i = 0; i < cidades.length; i += chunkSize) {
    const lote = Object.fromEntries(cidades.slice(i, i + chunkSize));
    const res = await fetch(url + "/api/admin/geo/import", {
      method: "POST",
      headers,
      body: JSON.stringify(lote),
    });

    if (!res.ok) {
      console.error(`✖ Falha no lote ${loteIdx + 1}: HTTP ${res.status}`);
      process.exit(1);
    }
    console.log(`✔ Lote ${++loteIdx} enviado com sucesso`);
  }
  console.log("🎉 Importação completa!");
}
