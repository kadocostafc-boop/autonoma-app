// server.js (produção-ready: PORT, 0.0.0.0, DATA_DIR, cache, compression, healthcheck)
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const compression = require("compression");
const os = require("os");

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = "0.0.0.0";

// ======== Diretórios base (DATA_DIR para produção com disco) ========
const ROOT     = __dirname;
// Se você montar um disco no Render em /data, basta definir DATA_DIR=/data.
// Em dev local, pode ficar em "."
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;

// Paths dependentes de DATA_DIR (persistência no Render)
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE    = path.join(DATA_DIR, "profissionais.json");
const BKP_DIR    = path.join(DATA_DIR, "backups");

// Static app (arquivos públicos)
const PUBLIC_DIR = path.join(ROOT, "public");

// Garante estrutura mínima
[PUBLIC_DIR, UPLOAD_DIR, BKP_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

// ===== Helpers =====
const CATS = ["Beleza","Construção","Manutenção","Tecnologia","Educação","Saúde","Pets","Eventos","Transporte","Outros"];
const trim = (s) => (s ?? "").toString().trim();
const onlyDigits = (v) => trim(v).replace(/\D/g, "");
const ensureBR = (d) => (d && /^\d{10,13}$/.test(d) ? (d.startsWith("55") ? d : "55"+d) : d);
const escapeHTML = (s="") => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const isURL = (u) => { if (!u) return false; try { const x = new URL(u.startsWith("http") ? u : "https://" + u); return !!x.hostname; } catch { return false; } };
const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ===== Validação =====
function validateCadastro(body, {isEdit=false} = {}) {
  const e = [];
  const nome = trim(body.nome);
  if (!nome || nome.length < 2 || nome.length > 80) e.push("Nome é obrigatório (2–80).");

  const profissao = trim(body.profissao);
  const servico = trim(body.servico);
  if (!profissao && !servico) e.push("Informe Profissão ou Categoria.");
  if (servico && !CATS.includes(servico)) e.push("Categoria inválida.");

  const cidade = trim(body.cidade);
  const bairro = trim(body.bairro);
  if (!cidade || cidade.length < 2 || cidade.length > 60) e.push("Cidade inválida.");
  if (!bairro || bairro.length < 2 || bairro.length > 60) e.push("Bairro inválido.");

  const telefone = ensureBR(onlyDigits(body.telefone));
  const whatsapp = ensureBR(onlyDigits(body.whatsapp));
  if (telefone && !/^\d{12,13}$/.test(telefone)) e.push("Telefone inválido (informe DDD e número).");
  if (whatsapp && !/^\d{12,13}$/.test(whatsapp)) e.push("WhatsApp inválido (informe DDD e número).");

  const email = trim(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.push("E-mail inválido.");

  const precoBase = trim(body.precoBase);
  if (precoBase && precoBase.length > 30) e.push("Preço base muito longo.");

  const experiencia = trim(body.experiencia);
  if (experiencia && experiencia.length > 60) e.push("Tempo de experiência muito longo.");

  const site = trim(body.site);
  if (site && !isURL(site)) e.push("Site/Instagram inválido.");

  const descricao = trim(body.descricao);
  if (descricao.length > 1000) e.push("Descrição muito longa (máx. 1000).");

  let atendimentos = null;
  if (isEdit && body.atendimentos !== undefined) {
    const n = Number(body.atendimentos);
    if (!Number.isFinite(n) || n < 0 || n > 1e7) e.push("Atendimentos inválido.");
    else atendimentos = Math.floor(n);
  }

  return { ok: e.length === 0, errors: e, values: {
    nome, email, telefone, whatsapp, experiencia, cidade, bairro, endereco: trim(body.endereco),
    servico: servico || (CATS.includes(profissao) ? profissao : servico),
    profissao, descricao, precoBase, site, atendimentos
  }};
}

// ===== Upload (Multer) =====
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:   (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => file.mimetype?.startsWith("image/") ? cb(null, true) : cb(new Error("Apenas imagens (JPG/PNG) são permitidas."))
});

// ===== DB + backups =====
const readDB  = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "[]"); } catch { return []; } };
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function listBackups() {
  const files = fs.readdirSync(BKP_DIR).filter(f => f.endsWith(".json"));
  return files.map(f => ({ name: f, path: path.join(BKP_DIR, f), mtime: fs.statSync(path.join(BKP_DIR, f)).mtimeMs }))
              .sort((a,b)=> b.mtime - a.mtime);
}
function rotateBackups(keep = 20) {
  const list = listBackups();
  if (list.length <= keep) return;
  list.slice(keep).forEach(({path: p}) => { try { fs.unlinkSync(p); } catch {} });
}
function backupNow(label = "auto") {
  try {
    const data = fs.readFileSync(DB_FILE, "utf8");
    const name = `db_${label}_${timestamp()}.json`;
    const out  = path.join(BKP_DIR, name);
    fs.writeFileSync(out, data, "utf8");
    rotateBackups(Number(process.env.BACKUP_KEEP || 20));
    return name;
  } catch (e) { return null; }
}
function writeDB(data) {
  backupNow("prewrite");
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
setInterval(() => { backupNow("daily"); }, 24 * 60 * 60 * 1000);
backupNow("startup");

// ===== Migração =====
function fixDB() {
  const db = readDB();
  let changed = false;
  const maxId = db.reduce((m, r) => Math.max(m, Number(r.id || 0)), 0);
  let nextId = maxId + 1;
  for (let i = 0; i < db.length; i++) {
    const p = db[i];
    if (!p.id) { p.id = nextId++; changed = true; }
    if (typeof p.atendimentos !== "number") { p.atendimentos = 0; changed = true; }
    if (!Array.isArray(p.avaliacoes)) { p.avaliacoes = []; changed = true; }
    if (typeof p.verificado !== "boolean") { p.verificado = false; changed = true; }
    if (!p.createdAt) { p.createdAt = new Date().toISOString(); changed = true; }
  }
  if (changed) { writeDB(db); console.log("✔ Base migrada."); } else { console.log("✔ Base já OK (ids presentes)."); }
}

// ===== Middlewares =====
app.set("trust proxy", 1); // importante p/ produção atrás de proxy
app.use(compression());
app.use(express.urlencoded({ extended: true }));

// Cache estático: public 7d / uploads 30d
app.use(express.static(PUBLIC_DIR, { maxAge: "7d", etag: true }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: !!process.env.SECURE_COOKIES }
}));

fixDB();

// ===== Helpers UI =====
function shell(title, content, backHref="/") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>${escapeHTML(title)}</title>
<style>
  :root{--bg:#f5f7fb;--card:#fff;--text:#1f2937;--muted:#6b7280;--brand:#2d6cdf}
  *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:var(--bg);color:var(--text)}
  .wrap{max-width:700px;margin:10vh auto;padding:20px}
  .card{background:var(--card);border:1px solid #e5e7eb;border-radius:14px;padding:18px;box-shadow:0 8px 20px rgba(0,0,0,.06)}
  h1{margin:0 0 10px} p{color:var(--muted)}
  a.btn{display:inline-block;margin-top:10px;background:#2d6cdf;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:700}
  @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style></head><body><div class="wrap"><div class="card">
<h1>${escapeHTML(title)}</h1>
<div>${content}</div>
<a class="btn" href="${backHref}">Voltar</a>
</div></div></body></html>`;
}
const html404 = () => shell("Página não encontrada (404)", "<p>A rota acessada não existe.</p>", "/");
const htmlError = (title, msg, back="/") => shell(title, `<p>${msg}</p>`, back);

// ===== Rotas principais (mantém tudo que fizemos) =====
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true })); // healthcheck p/ Render

// Cadastro com upload
app.post("/cadastrar",
  (req, res, next) => upload.single("foto")(req, res, (err) => {
    if (err) return res.status(400).send(htmlError("Erro no upload", escapeHTML(err.message), "/cadastro.html"));
    next();
  }),
  (req, res) => {
    try {
      const { ok, errors, values } = validateCadastro(req.body);
      if (!ok) return res.status(400).send(htmlError("Dados inválidos", `<ul>${errors.map(escapeHTML).map(s=>`<li>${s}</li>`).join("")}</ul>`, "/cadastro.html"));
      const fotoPath = req.file ? `/uploads/${req.file.filename}` : "";
      const db = readDB();
      const novo = { id: db.length ? db[db.length - 1].id + 1 : 1, createdAt: new Date().toISOString(), ...values, foto: fotoPath, atendimentos: 0, avaliacoes: [], verificado: false };
      db.push(novo);
      writeDB(db);
      return res.redirect("/profissionais");
    } catch (err) {
      return res.status(500).send(htmlError("Erro ao cadastrar", escapeHTML(err?.message || String(err)), "/cadastro.html"));
    }
  }
);

// Listagem /profissionais (com paginação, lazy, etc.) — (igual ao passo 7)
// (para encurtar, mantenha o seu atual — não precisa mudar nada aqui)

// Perfil + avaliações — (igual ao passo 7)
// API /api/profissionais — (igual ao passo 7)
// Admin + backups — (igual ao passo 5/7)

// Para manter a resposta objetiva, não repito essas rotas aqui.
// >>> Importante: você não precisa mexer nelas para publicar. <<<

// ===== Erros =====
app.use((req, res) => { res.status(404).send(html404()); });
app.use((err, req, res, _next) => {
  console.error("Erro não tratado:", err);
  res.status(500).send(htmlError("Erro interno (500)", escapeHTML(err?.message || String(err)), "/"));
});

// ===== Start =====
app.listen(PORT, HOST, () => {
  // Mostra links úteis no console (dev)
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name in nets) for (const i of nets[name]) if (i.family==="IPv4" && !i.internal) ips.push(i.address);
  console.log(`Autônoma.app rodando em http://localhost:${PORT}`);
  if (ips.length) console.log(`Acesso na rede: http://${ips[0]}:${PORT}`);
});
