// ============================================================================
// Autônoma.app • server.js
// Data: 2025-09-11
// - Páginas públicas + PWA + SEO
// - Admin (login obrigatório) + export CSV + métricas/gráficos (endpoints JSON)
// - Painel do Profissional (login via token WhatsApp, Radar on/off, raio, cidades extras)
// - Busca com ranking (planos + distância + Radar)
// - Perfil público (/perfil.html?id=... e /profissional/:id)
// - Página Avaliar: GET /avaliar/:id  (POST também em /profissional/:id/avaliar)
// - Top10 semanal (visitas/chamadas/avaliações)
// - Denúncias
// - Pagamentos (stub Pix/Cartão) + taxas configuráveis
// - QR Code (/api/qr)
// - Favoritos (cookie anônimo FAV_UID)
// - Frase WhatsApp nos JSONs (/api/ui-config)
// - Respeita .env: PRIMARY_HOST, FORCE_HTTPS, SECURE_COOKIES, REDIRECTS_DISABLED, DATA_DIR
// ============================================================================
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const compression = require("compression");
const QRCode  = require("qrcode");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");

const app = express();
app.set("trust proxy", 1);

// =========================[ Config ]==========================
const HOST = "0.0.0.0";
const BASE_PORT = Number(process.env.PORT || 3000);

// Canonical/redirects
const PRIMARY_HOST       = (process.env.PRIMARY_HOST || "").trim();
const FORCE_HTTPS        = String(process.env.FORCE_HTTPS || "false").toLowerCase() === "true";
const REDIRECTS_DISABLED = String(process.env.REDIRECTS_DISABLED || "false").toLowerCase() === "true";

// Taxas/checkout
const FEE_CARD_PERCENT = Number(process.env.FEE_CARD_PERCENT || 4);
const FEE_PIX_PERCENT  = Number(process.env.FEE_PIX_PERCENT  || 0);
const PIX_ENABLED      = String(process.env.PIX_ENABLED || "true") === "true";
const CARD_ENABLED     = String(process.env.CARD_ENABLED || "true") === "true";

// Pastas/arquivos (suporta DATA_DIR=/data na Railway)
const ROOT       = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const DB_FILE        = path.join(DATA_DIR, "profissionais.json");
const BAIRROS_FILE   = path.join(DATA_DIR, "bairros.json");
const CIDADES_FILE   = path.join(DATA_DIR, "cidades.json");
const SERVICOS_FILE  = path.join(DATA_DIR, "servicos.json");
const DENUNCIAS_FILE = path.join(DATA_DIR, "denuncias.json");
const PAYMENTS_FILE  = path.join(DATA_DIR, "payments.json");
const METRICS_FILE   = path.join(DATA_DIR, "metrics.json");

[PUBLIC_DIR, DATA_DIR, UPLOAD_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); });

function readJSON(file, fallback){ try{ return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : fallback; } catch{ return fallback; } }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }

// Inicia arquivos essenciais
if (!fs.existsSync(DB_FILE))         writeJSON(DB_FILE, []);
if (!fs.existsSync(DENUNCIAS_FILE))  writeJSON(DENUNCIAS_FILE, []);
if (!fs.existsSync(PAYMENTS_FILE))   writeJSON(PAYMENTS_FILE, []);
if (!fs.existsSync(METRICS_FILE))    writeJSON(METRICS_FILE, {});

// Admin / Sessão
const ADMIN_USER      = process.env.ADMIN_USER || "admin";
const ADMIN_PASS      = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ""; // se existir, tem prioridade
const SESSION_SECRET  = process.env.SESSION_SECRET || "troque-isto";

// =========================[ Helpers ]==========================
const trim = (s)=> (s??"").toString().trim();
const norm = (s)=> (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const escapeHTML = (s="") => String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
  .replace(/'/g,"&#39;");
const getIP = (req)=> (req.headers["x-forwarded-for"]||"").split(",")[0].trim() || req.socket?.remoteAddress || "";
const onlyDigits = (v)=> trim(v).replace(/\D/g,"");
const ensureBR  = (d)=> (d && /^\d{10,13}$/.test(d) ? (d.startsWith("55")? d : "55"+d) : d);
const isWhatsappValid = (w)=> { const d=onlyDigits(w); const br=ensureBR(d); return !!(br && /^\d{12,13}$/.test(br)); };
const nowISO = ()=> new Date().toISOString();
const monthRefOf = (d)=> (d||nowISO()).slice(0,7); // "YYYY-MM"
function weekKey (){
  const d=new Date();
  const onejan=new Date(d.getFullYear(),0,1);
  const day=Math.floor((d - onejan) / 86400000);
  const week=Math.ceil((day + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,"0")}`;
}

// Haversine
function haversineKm(aLat, aLng, bLat, bLng){
  if (![aLat,aLng,bLat,bLng].every(Number.isFinite)) return null;
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const lat1=toRad(aLat), lat2=toRad(bLat);
  const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

// Frase padrão WhatsApp
function buildWaMessage(p){
  const nome = p?.nome ? ` ${p.nome}` : "";
  const serv = (p?.servico || p?.profissao || "seu serviço");
  return `Olá${nome}, vi seu perfil na Autônoma.app e gostaria de contratar ${serv}. Podemos conversar?`;
}

// =========================[ Middlewares ]=====================
app.use(compression());
app.use(express.urlencoded({ extended:true }));
app.use(express.json({ limit:"1.2mb" }));
app.use(cookieParser());

// Canonical/HTTPS
if (!REDIRECTS_DISABLED){
  app.use((req,res,next)=>{
    try{
      const hostNow = (req.headers.host||"").toLowerCase();
      const isHttps = (req.protocol==="https") || (req.headers["x-forwarded-proto"]==="https");
      if (PRIMARY_HOST){
        const target = PRIMARY_HOST.toLowerCase();
        if (hostNow && hostNow !== target) {
          const url = `http${FORCE_HTTPS?"s":(isHttps?"s":"")}://${target}${req.originalUrl}`;
          return res.redirect(301, url);
        }
      }
      if (FORCE_HTTPS && !isHttps){
        const host = hostNow || PRIMARY_HOST || "localhost";
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    }catch{}
    next();
  });
}

// Estático
app.use(express.static(PUBLIC_DIR, { maxAge:"7d", fallthrough: true }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge:"30d", immutable:true }));

// No-cache para /api/*
app.use(/^\/api\//, (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});
// No-cache para /api/admin/*
app.use(/^\/api\/admin\//, (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});

// Sessões (alinhado a SECURE_COOKIES)
app.use(session({
  name: "aut_sess",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: (process.env.SECURE_COOKIES === "true") ? "none" : "lax",
    secure: (process.env.SECURE_COOKIES === "true")
  }
}));

// Limiters
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });
const reviewsLimiter = rateLimit({ windowMs: 5*60*1000,  max: 40, standardHeaders: true, legacyHeaders: false });

// =========================[ GEO / AUTOCOMPLETE ]=====================
const CIDADES_BASE = [
  { nome: "Rio de Janeiro/RJ", lat: -22.9068, lng: -43.1729, bairros: ["Copacabana","Ipanema","Botafogo","Tijuca","Barra da Tijuca","Leblon","Centro"] },
  { nome: "São Paulo/SP",      lat: -23.5505, lng: -46.6333, bairros: ["Pinheiros","Vila Mariana","Moema","Tatuapé","Santana","Itaim Bibi","Centro"] },
  { nome: "Belo Horizonte/MG", lat: -19.9167, lng: -43.9345, bairros: ["Savassi","Lourdes","Funcionários","Pampulha","Centro","Cidade Nova"] },
  { nome: "Brasília/DF",       lat: -15.7939, lng: -47.8828, bairros: ["Asa Sul","Asa Norte","Lago Sul","Lago Norte","Sudoeste","Noroeste"] },
  { nome: "Salvador/BA",       lat: -12.9711, lng: -38.5108, bairros: ["Barra","Ondina","Rio Vermelho","Pituba","Itapuã","Stella Maris"] },
  { nome: "Porto Alegre/RS",   lat: -30.0346, lng: -51.2177, bairros: ["Moinhos de Vento","Centro","Cidade Baixa","Petrópolis","Tristeza"] },
  { nome: "Curitiba/PR",       lat: -25.4284, lng: -49.2733, bairros: ["Batel","Centro","Água Verde","Bigorrilho","Cabral","Portão"] },
  { nome: "Recife/PE",         lat: -8.0476,  lng: -34.8770, bairros: ["Boa Viagem","Casa Forte","Graças","Espinheiro","Pina","Boa Vista"] },
  { nome: "Fortaleza/CE",      lat: -3.7319,  lng: -38.5267, bairros: ["Meireles","Aldeota","Praia de Iracema","Praia do Futuro","Centro"] },
  { nome: "Manaus/AM",         lat: -3.1190,  lng: -60.0217, bairros: ["Adrianópolis","Centro","Ponta Negra","Flores","Parque 10"] },
];

const SERVICOS_BASE = [
  "Eletricista","Hidráulico","Pintor","Marceneiro","Diarista","Pedreiro","Técnico em informática",
  "Manicure","Cabeleireiro","Encanador","Chaveiro","Jardinheiro","Fotógrafo","Personal Trainer"
];

app.get('/api/geo/cidades', (_req, res) => { try{ res.json(CIDADES_BASE.map(c => c.nome)); }catch{ res.json([]); }});
app.get('/api/geo/cidades/suggest', (req, res) => {
  try{
    const q = trim(req.query.q||""); if (!q) return res.json([]);
    const QQ = norm(q);
    const out = CIDADES_BASE.map(c=>c.nome)
      .filter(c => norm(c).includes(QQ) || norm(c.split("/")[0]).includes(QQ))
      .slice(0, 20);
    res.json(out);
  }catch{ res.json([]); }
});
app.get('/api/geo/servicos', (_req, res) => { try{ res.json(SERVICOS_BASE); }catch{ res.json([]); }});
app.get('/api/geo/bairros', (req, res) => {
  const cidade = String(req.query.cidade || '').trim().toLowerCase();
  if (!cidade) return res.json([]);
  const item = CIDADES_BASE.find(c => c.nome.toLowerCase() === cidade);
  return res.json(item ? item.bairros : []);
});
app.get('/api/geo/bairros/suggest', (req, res) => {
  const cidade = String(req.query.cidade || '').trim().toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!cidade || !q) return res.json([]);
  const item = CIDADES_BASE.find(c => c.nome.toLowerCase() === cidade);
  if (!item) return res.json([]);
  const out = item.bairros.filter(b => b.toLowerCase().includes(q)).slice(0, 15);
  return res.json(out);
});
app.get('/api/geo/servicos/suggest', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const out = SERVICOS_BASE.filter(s => s.toLowerCase().includes(q)).slice(0, 15);
  return res.json(out);
});
app.get('/api/geo/closest-city', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.json({ ok:false, error:"coords_invalid" });
  let best = null, bestD = Infinity;
  for (const c of CIDADES_BASE) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d!=null && d < bestD) { best = c; bestD = d; }
  }
  if (!best) return res.json({ ok:false });
  return res.json({ ok:true, cidade: best.nome, distKm: Math.round(bestD*10)/10 });
});

// =========================[ HTML helpers ]=====================
const htmlMsg = (title, text, backHref="/") =>
`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
<div class="wrap"><div class="card"><h1>${escapeHTML(title)}</h1><p class="meta">${escapeHTML(text||"")}</p><a class="btn" href="${escapeHTML(backHref)}">Voltar</a></div></div>`;

const htmlErrors = (title, list, backHref="/") =>
`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
<div class="wrap"><div class="card"><h1>${escapeHTML(title)}</h1><ul>${(list||[]).map(e=>`<li>${escapeHTML(e)}</li>`).join("")}</ul><a class="btn" href="${escapeHTML(backHref)}">Voltar</a></div></div>`;

// =========================[ Health/diag ]======================
app.get("/healthz", (_req,res)=> res.type("text").send("ok"));
app.get("/admin/check", (req,res)=>{
  const info = {
    session: !!(req.session && req.session.isAdmin),
    total: readJSON(DB_FILE, []).length,
    dataDir: DATA_DIR, dbFile: DB_FILE,
    uploadsExists: fs.existsSync(UPLOAD_DIR),
    bairrosExists: fs.existsSync(BAIRROS_FILE),
    cidadesExists: fs.existsSync(CIDADES_FILE),
    servicosExists: fs.existsSync(SERVICOS_FILE),
    denunciasExists: fs.existsSync(DENUNCIAS_FILE),
    paymentsExists: fs.existsSync(PAYMENTS_FILE),
    metricsExists: fs.existsSync(METRICS_FILE),
  };
  res.send(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
  <div class="wrap"><div class="card"><h1>Diagnóstico</h1><pre>${escapeHTML(JSON.stringify(info,null,2))}</pre>
  <a class="btn" href="/">Início</a></div></div>`);
});

// =====================[ Páginas/redirects ]====================
app.get("/",                 (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/clientes.html",    (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "clientes.html")));
app.get("/cadastro.html",    (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "cadastro.html")));
app.get("/favoritos.html",   (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "favoritos.html")));
app.get("/cadastro_sucesso.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "cadastro_sucesso.html")));
app.get("/denunciar.html",   (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "denunciar.html")));
app.get("/top10.html",       (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "top10.html")));
app.get("/planos.html",      (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "planos.html")));
app.get("/checkout.html",    (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "checkout.html")));
app.get("/painel_login.html",(_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "painel_login.html")));
app.get("/perfil.html",      (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "perfil.html")));

// Redirects legados/canônicos
app.get(["/perfil.html","/perfil"], (req,res)=>{
  const id = Number(req.query.id||"");
  if (id) return res.redirect(301, `/profissional/${id}`);
  return res.redirect(302, "/clientes.html");
});
app.get("/clientes", (_req,res)=> res.redirect(301, "/clientes.html"));
app.get("/cadastro", (_req,res)=> res.redirect(301, "/cadastro.html"));

// =========================[ Banco (JSON) ]=====================
const readDB  = ()=> readJSON(DB_FILE, []);
const writeDB = (data)=> writeJSON(DB_FILE, data);

// Verificado (regra pragmática para UX boa)
function computeVerified(p){
  return !!(p?.foto && isWhatsappValid(p.whatsapp) && p.cidade && p.bairro);
}

// Migração/normalização inicial
(function fixDB(){
  const db = readDB();
  let changed=false;
  let nextId = db.reduce((m,p)=>Math.max(m, Number(p.id||0)),0)+1;
  for (const p of db){
    if(!p.id){ p.id=nextId++; changed=true; }
    if(typeof p.atendimentos!=="number"){ p.atendimentos=0; changed=true; }
    if(!Array.isArray(p.avaliacoes)){ p.avaliacoes=[]; changed=true; }
    if(!p.createdAt){ p.createdAt=nowISO(); changed=true; }
    if(typeof p.visitas!=="number"){ p.visitas=0; changed=true; }
    if(typeof p.chamadas!=="number"){ p.chamadas=0; changed=true; }
    if(!Array.isArray(p.visitsLog)) p.visitsLog=[];
    if(!Array.isArray(p.callsLog))  p.callsLog=[];
    if(!Array.isArray(p.qrLog))     p.qrLog=[];
    if(typeof p.suspenso!=="boolean"){ p.suspenso=false; changed=true; }
    if(!p.suspensoMotivo) p.suspensoMotivo="";
    if(!p.suspensoEm && p.suspenso) p.suspensoEm=nowISO();
    if(typeof p.excluido!=="boolean"){ p.excluido=false; changed=true; }
    if(!p.excluidoEm && p.excluido) p.excluidoEm=nowISO();
    if(p.lat!=null && typeof p.lat!=="number"){ p.lat=Number(p.lat); changed=true; }
    if(p.lng!=null && typeof p.lng!=="number"){ p.lng=Number(p.lng); changed=true; }
    const newVer = computeVerified(p);
    if(p.verificado!==newVer){ p.verificado=newVer; changed=true; }
    if(!p.plano) p.plano = "free";
    if(typeof p.raioKm!=="number") p.raioKm = 0;
    if(!Array.isArray(p.cidadesExtras)) p.cidadesExtras=[];
    if(!p.radar){ p.radar = { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef: monthRefOf() }; changed=true; }
    if(!p.lastPos) p.lastPos = { lat:null, lng:null, at:null };
    if(typeof p.receiveViaApp!=="boolean") p.receiveViaApp=false;
    // PIN (login do profissional)
if (!p.pinHash) p.pinHash = null;                 // hash do PIN (bcrypt)
if (typeof p.mustSetPin !== "boolean") p.mustSetPin = false; // força definir PIN no 1º login
  }
  if (changed) writeDB(db);
  console.log("✔ Base OK (ids/logs/planos/radar/verificado).");
})();

// =========================[ Upload (multer) ]==================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits:{ fileSize: 3*1024*1024 },
  fileFilter: (_, file, cb) => file.mimetype?.startsWith("image/") ? cb(null,true) : cb(new Error("Apenas imagens (JPG/PNG)."))
});
// =========================[ GEO utils + arquivos ]==============
function loadGeoMaps(){
  const bairrosMap = readJSON(BAIRROS_FILE, {}) || {};
  let cidades = readJSON(CIDADES_FILE, []);
  if (!Array.isArray(cidades)){ cidades = Object.keys(cidades||{}); }
  if (!cidades.length && bairrosMap && typeof bairrosMap==="object"){
    cidades = Object.keys(bairrosMap);
  }
  cidades = (cidades||[]).filter(Boolean).sort((a,b)=> a.localeCompare(b,"pt-BR"));

  const baseServ = [
    "Eletricista","Encanador","Diarista","Passadeira","Marido de aluguel",
    "Pintor","Pedreiro","Gesseiro","Marceneiro","Serralheiro","Montador de móveis",
    "Técnico de informática","Desenvolvedor","Designer","Fotógrafo","Videomaker","DJ","Garçom","Segurança",
    "Cabeleireiro","Manicure","Maquiadora","Esteticista","Personal trainer","Professor particular","Babá",
    "Cuidador de idosos","Jardinagem","Climatização (ar-condicionado)","Refrigeração","Soldador","Telhadista",
    "Vidraceiro","Chaveiro","Marketing digital","Social media","Consultor","Advogado","Contador"
  ];
  const servExtra = readJSON(SERVICOS_FILE, []);
  const fromDB = new Set(readDB().map(p => (p.servico||p.profissao||"").toString().trim()).filter(Boolean));
  const servicos = Array.from(new Set([...baseServ, ...(Array.isArray(servExtra)?servExtra:[]), ...Array.from(fromDB)]
                        .map(s=>s.trim()).filter(Boolean))).sort((a,b)=> a.localeCompare(b,"pt-BR"));

  return { bairrosMap, cidades, servicos };
}
function normalizeCidadeUF(input){
  const { cidades } = loadGeoMaps();
  const q = norm(input); if (!q) return "";
  let hit = cidades.find(c => norm(c) === q); if (hit) return hit;
  hit = cidades.find(c => norm(c.split("/")[0]) === q); if (hit) return hit;
  hit = cidades.find(c => norm(c).startsWith(q) || norm(c.split("/")[0]).startsWith(q)); if (hit) return hit;
  hit = cidades.find(c => norm(c).includes(q));
  return hit || input;
}

// =========================[ UI config ]========================
const WHATSAPP_DEFAULT_MSG =
  "Olá! Vi seu perfil na Autônoma.app e gostaria de contratar seu serviço. Podemos conversar?";
app.get("/api/ui-config", (_req, res) => {
  res.json({ ok: true, evaluateCTA: true, whatsappTemplate: WHATSAPP_DEFAULT_MSG });
});

// =========================[ Cadastro ]=========================
function validateCadastro(body){
  const e=[];
  const nome = trim(body.nome);
  if (!nome || nome.length<2 || nome.length>80) e.push("Nome é obrigatório (2–80).");

  const cidadeInput = trim(body.cidade);
  const cidade = normalizeCidadeUF(cidadeInput);
  const bairro = trim(body.bairro);
  if(!cidade) e.push("Cidade é obrigatória.");
  if(!bairro) e.push("Bairro é obrigatório.");

  const servico   = trim(body.servico);
  const profissao = trim(body.profissao);
  if(!servico && !profissao) e.push("Informe Categoria ou Profissão.");

  const email = trim(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.push("E-mail inválido.");

  const telefone = ensureBR(onlyDigits(body.telefone));
  const whatsapp = ensureBR(onlyDigits(body.whatsapp));
  if (!whatsapp || !/^\d{12,13}$/.test(whatsapp)) e.push("WhatsApp inválido (use DDD).");
  if (telefone && !/^\d{12,13}$/.test(telefone)) e.push("Telefone inválido (use DDD).");

  let lat = (body.lat ?? "").toString().trim();
  let lng = (body.lng ?? "").toString().trim();
  lat = lat === "" ? null : Number(lat);
  lng = lng === "" ? null : Number(lng);
  if (lat!=null && !(Number.isFinite(lat) && lat>=-90 && lat<=90)) e.push("Latitude inválida.");
  if (lng!=null && !(Number.isFinite(lng) && lng>=-180 && lng<=180)) e.push("Longitude inválida.");

  return {
    ok: e.length===0, errors:e,
    values:{
      nome, email, telefone, whatsapp, cidade, bairro,
      servico, profissao, experiencia: trim(body.experiencia),
      precoBase: trim(body.precoBase), site: trim(body.site),
      endereco: trim(body.endereco), descricao: trim(body.descricao),
      lat: lat==null? undefined : lat,
      lng: lng==null? undefined : lng
    }
  };
}
function isDuplicate(db, novo){
  return db.some(p =>
    p.whatsapp===novo.whatsapp &&
    norm(p.cidade)===norm(novo.cidade) &&
    norm(p.bairro)===norm(novo.bairro) &&
    !p.excluido
  );
}

app.post("/cadastrar",
  (req,res,next)=> upload.single("foto")(req,res,(err)=> {
    if (err) return res.status(400).send(htmlMsg("Erro no upload", err.message, "/cadastro.html"));
    next();
  }),
  (req,res)=>{
    try{
      const { ok, errors, values } = validateCadastro(req.body);
      if (!req.file?.filename) errors.push("Foto é obrigatória.");
      if (!ok || errors.length) return res.status(400).send(htmlErrors("Dados inválidos", errors, "/cadastro.html"));

      const db = readDB();
      if (isDuplicate(db, values)){
        return res.status(400).send(htmlMsg("Cadastro duplicado","Já existe um profissional com o mesmo WhatsApp neste bairro/cidade.","/cadastro.html"));
      }

      const foto = `/uploads/${req.file.filename}`;
      const novo = {
        id: db.length ? db[db.length-1].id + 1 : 1,
        createdAt: nowISO(),
        ...values,
        foto,
        atendimentos: 0, avaliacoes: [], visitas: 0, chamadas: 0,
        visitsLog: [], callsLog: [], qrLog: [],
        suspenso: false, suspensoMotivo: "", suspensoEm: null,
        excluido: false, excluidoEm: null,
        plano: "free", raioKm: 0, cidadesExtras: [],
        radar:{ on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:monthRefOf() },
        lastPos:{ lat:null, lng:null, at:null },
        receiveViaApp:false
      };
      novo.verificado = computeVerified(novo);
      db.push(novo); writeDB(db);

      req.session.lastCreatedProId = novo.id;
      res.redirect(`/profissional/${novo.id}`);
    } catch(err){
      res.status(500).send(htmlMsg("Erro", err.message||String(err), "/cadastro.html"));
    }
  }
);

// =========================[ Busca pública ]====================
function isRecent(iso, mins=15){
  if (!iso) return false; const t=new Date(iso).getTime(); if (!Number.isFinite(t)) return false;
  return (Date.now()-t) <= (mins*60*1000);
}
app.get("/api/profissionais", (req, res) => {
  try{
    const db = readDB().filter(p => !p.excluido && !p.suspenso);
    const cidade    = trim(req.query.cidade || "");
    const bairro    = trim(req.query.bairro || "");
    const servicoQ  = trim(req.query.servico || "");
    const minRating = Number(req.query.minRating || 0);
    const featured  = String(req.query.featured || "").trim() === "1";
    const photoOnly = String(req.query.photoOnly || "").trim() === "1";
    const userLat   = Number(req.query.userLat);
    const userLng   = Number(req.query.userLng);
    const hasUserPos = Number.isFinite(userLat) && Number.isFinite(userLng);

    let items = db;
    if (featured) items = items.filter(p => p.verificado || (p.plano && p.plano !== 'free'));
    if (cidade) {
      const alvo = normalizeCidadeUF(cidade);
      const N = norm(alvo);
      items = items.filter(p => norm(p.cidade||"") === N || norm(p.cidade||"").includes(N));
    }
    if (bairro) {
      const NB = norm(bairro);
      items = items.filter(p => norm(p.bairro||"").includes(NB));
    }
    if (servicoQ) {
      const NS = norm(servicoQ);
      items = items.filter(p => norm(p.servico || p.profissao || "").includes(NS));
    }
    if (minRating) {
      items = items.filter(p => {
        const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
        const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
        return rating >= minRating;
      });
    }
    if (photoOnly) items = items.filter(p => !!p.foto);

    for (const p of items) {
      const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
      p._rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;

      let plat = Number(p.lat); let plng = Number(p.lng);
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
        if (p.lastPos && Number.isFinite(p.lastPos.lat) && Number.isFinite(p.lastPos.lng)) {
          plat = Number(p.lastPos.lat); plng = Number(p.lastPos.lng);
        } else { plat = null; plng = null; }
      }
      let dist = null;
      if (hasUserPos && Number.isFinite(plat) && Number.isFinite(plng)) dist = haversineKm(userLat, userLng, plat, plng);
      p._distKm = dist;

      const planoW = (p.plano === "premium") ? 3 : (p.plano === "pro") ? 2 : 1;
      const distW  = (dist==null) ? 0 : (dist < 2 ? 1.2 : dist < 5 ? 1.0 : 0.8);
      const verifW = p.verificado ? 0.4 : 0;
      p._score = (planoW * 2.5) + (p._rating * 1.5) + (distW) + verifW;
    }

    const sort = String(req.query.sort || "score");
    const dir  = String(req.query.dir || "desc").toLowerCase() === "asc" ? 1 : -1;
    items.sort((a,b)=>{
      if (sort === "dist") {
        const da = (a._distKm==null ? Infinity : a._distKm);
        const dbb= (b._distKm==null ? Infinity : b._distKm);
        return (da - dbb) * dir;
      }
      return ((a._score||0) - (b._score||0)) * dir;
    });

    const page  = Math.max(1, Number(req.query.page||1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit||20)));
    const total = items.length;
    const start = (page-1)*limit;
    const end   = start + limit;

    const out = items.slice(start, end).map(p => ({
      id: p.id,
      nome: p.nome,
      servico: p.servico || p.profissao || "",
      cidade: p.cidade || "",
      bairro: p.bairro || "",
      foto: p.foto || "",
      whatsapp: p.whatsapp || "",
      rating: Number(p._rating||0),
      avaliacoes: Array.isArray(p.avaliacoes) ? p.avaliacoes.length : Number(p.avaliacoes||0),
      atendimentos: Number(p.atendimentos||0),
      precoBase: p.precoBase || p.preco || "",
      lat: p.lat ?? (p.lastPos?.lat ?? null),
      lng: p.lng ?? (p.lastPos?.lng ?? null),
      distanceKm: (p._distKm!=null && isFinite(p._distKm)) ? Math.round(p._distKm*10)/10 : null,
      plano: p.plano || "free",
      verificado: !!p.verificado
    }));

    res.json({ ok:true, total, items: out });
  }catch(e){
    console.error("ERR /api/profissionais", e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// =========================[ Perfil (APIs) ]====================
app.get("/api/profissionais/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok:false, error:"id inválido" });
  const db = readDB();
  const p = db.find(x => Number(x.id) === id && !x.excluido);
  if (!p) return res.status(404).json({ ok:false });

  const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
  const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;

  res.json({
    ok: true,
    id: p.id,
    nome: p.nome,
    foto: p.foto || "",
    servico: p.servico || p.profissao || "",
    cidade: p.cidade || "",
    bairro: p.bairro || "",
    descricao: p.descricao || "",
    whatsapp: p.whatsapp || "",
    site: p.site || "",
    atendimentos: p.atendimentos || 0,
    avaliacoes: p.avaliacoes || [],
    rating,
    verificado: !!p.verificado,
    suspenso: !!p.suspenso,
    plano: p.plano || "free",
    badge: p.plano==="premium"?"PREMIUM":(p.plano==="pro"?"PRO":""),
    distanceKm: (typeof p.distanceKm === "number") ? p.distanceKm : null
  });
});

// Compat
app.get("/api/profissional/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  if (!Number.isFinite(id) || id <= 0) { return res.status(400).json({ ok: false, error: "id inválido" }); }
  const db = readDB();
  const p = db.find(x => Number(x.id) === id && !x.excluido);
  if (!p) return res.status(404).json({ ok: false });

  const notas = (p.avaliacoes || []).map(a => Number(a.nota)).filter(n => n >= 1 && n <= 5);
  const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
  const experiencia = (typeof p.experiencia === "number")
    ? p.experiencia
    : Number(String(p.experiencia||"").replace(/\D/g,"")) || null;

  res.json({
    ok: true,
    id: p.id,
    nome: p.nome,
    foto: p.foto || "",
    servico: p.servico || p.profissao || "",
    cidade: p.cidade || "",
    bairro: p.bairro || "",
    descricao: p.descricao || "",
    whatsapp: p.whatsapp || "",
    site: p.site || "",
    atendimentos: p.atendimentos || 0,
    avaliacoes: p.avaliacoes || [],
    rating,
    verificado: !!p.verificado,
    suspenso: !!p.suspenso,
    plano: p.plano || "free",
    badge: p.plano === "premium" ? "PREMIUM" : (p.plano === "pro" ? "PRO" : ""),
    canEvaluate: true,
    experiencia,
    distanceKm: typeof p.distanceKm === "number" ? p.distanceKm : null
  });
});

// =========================[ Avaliações ]=======================
app.get("/api/avaliacoes/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  if (!Number.isFinite(id) || id<=0) return res.status(400).json({ ok:false, error:"id inválido" });

  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (!p) return res.status(404).json({ ok:false, error:"não encontrado" });

  const page = Math.max(1, Number(req.query.page||1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit||20)));

  const list = Array.isArray(p.avaliacoes)? p.avaliacoes : [];
  const total = list.length;
  const start = (page-1)*limit;
  const end   = start + limit;
  const slice = list.slice(start,end);

  res.json({ ok:true, total, items:slice });
});

// Anti-spam por cookie/IP
function ensureReviewCookie(req,res){
  const raw = req.cookies || {};
  if (raw && raw.rev_uid) return raw.rev_uid;
  const uid = crypto.randomBytes(12).toString("hex");
  res.cookie("rev_uid", uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.SECURE_COOKIES === "true"),
    maxAge: 180*24*3600*1000,
    path: "/"
      });
  return uid;
}
app.post("/api/avaliacoes", reviewsLimiter, (req,res)=>{
  try{
    const proId = Number(req.body?.proId||"0");
    const nota = Number(req.body?.nota||0);
    const comentario = trim(req.body?.comentario||"");
    const autor = trim(req.body?.autor||"Cliente");

    if (!Number.isFinite(proId) || proId<=0) return res.status(400).json({ ok:false, error:"proId inválido" });
    if (!(nota>=1 && nota<=5)) return res.status(400).json({ ok:false, error:"nota inválida" });
    if (comentario.length < 5) return res.status(400).json({ ok:false, error:"comentário muito curto" });

    const db = readDB();
    const p = db.find(x=> Number(x.id)===proId && !x.excluido);
    if (!p) return res.status(404).json({ ok:false, error:"profissional não encontrado" });

    const uid = ensureReviewCookie(req,res);
    const ip = getIP(req);
    // Bloqueio: mesmo cookie/ip em 12h
    const twelveH = Date.now()-12*3600*1000;
    const recent = (p.avaliacoes||[]).some(a=>{
      const t = Date.parse(a.at||"");
      return a.meta && (a.meta.ip===ip || a.meta.uid===uid) && Number.isFinite(t) && t>=twelveH;
    });
    if (recent) return res.status(429).json({ ok:false, error:"aguarde para avaliar novamente" });

    (p.avaliacoes ||= []).push({
      autor, nota, comentario,
      at: nowISO(),
      meta: { ip, uid }
    });
    writeDB(db);

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// POST (compat do formulário)
app.post("/profissional/:id/avaliar", (req,res)=>{
  const id = Number(req.params.id || "0");
  try{
    const autor = trim(req.body.autor);
    const nota = Number(req.body.nota);
    const comentario = trim(req.body.comentario);
    if (!(nota>=1 && nota<=5) || comentario.length<5){
      return res.status(400).send(htmlMsg("Erro","Nota/comentário inválidos.","/clientes.html"));
    }
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id && !x.excluido);
    if (!p) return res.status(404).send(htmlMsg("Erro","Profissional não encontrado.","/clientes.html"));

    (p.avaliacoes ||= []).push({ autor, nota, comentario, at: nowISO(), ip:getIP(req) });
    writeDB(db);

    return res.redirect(`/perfil.html?id=${id}&ok=1`);
  }catch(e){
    return res.status(500).send(htmlMsg("Erro", String(e), `/perfil.html?id=${id}`));
  }
});

// Página de avaliação (HTML) — mantida
app.get("/avaliar/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x => Number(x.id)===id && !x.excluido);
  if (!p) {
    return res.status(404).send(htmlMsg("Não encontrado","Profissional não localizado.","/clientes.html"));
  }
  const avals = (p.avaliacoes||[]).slice().reverse().slice(0,30);
  const stars = (n)=>"★".repeat(n)+"☆".repeat(5-n);
  const itens = avals.map(a=>{
    const nota = Math.max(1, Math.min(5, Number(a.nota)||0));
    const when = a.at ? new Date(a.at).toLocaleString() : "";
    return `
      <li class="cmt">
        <div class="cmt-head">
          <strong>${escapeHTML(a.autor||"Cliente")}</strong>
          <span class="stars" aria-label="nota ${nota} de 5">${stars(nota)}</span>
        </div>
        <div class="cmt-body">${escapeHTML(a.comentario||"")}</div>
        <div class="cmt-meta">${escapeHTML(when)}</div>
      </li>`;
  }).join("");

  res.send(`<!doctype html><html lang="pt-br"><head>
  <meta charset="utf-8" />
  <title>Avaliar ${escapeHTML(p.nome)} • Autônoma.app</title>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <link rel="stylesheet" href="/css/app.css" />
  <style>
    :root{
      --bg1:#0e3a8a; --bg2:#1d4ed8; --card:#ffffff;
      --txt:#0b1220; --muted:#6b7280; --line:#e5e7eb;
      --brand:#1d4ed8; --brand-2:#2563eb; --radius:16px;
    } *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      color:var(--txt);background:linear-gradient(135deg,var(--bg1),var(--bg2));}
    .wrap{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:var(--card);border-radius:var(--radius);box-shadow:0 10px 30px rgba(0,0,0,.15);max-width:980px;width:100%;overflow:hidden}
    .card-head{padding:24px 24px 0;color:#fff;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.02))}
    .title{font-size:22px;font-weight:700;margin:0 0 8px}
    .subtitle{margin:0 0 16px;color:#e5e7eb}
    .pro{display:flex;gap:12px;align-items:center}
    .pro img{width:56px;height:56px;border-radius:14px;object-fit:cover;border:2px solid rgba(255,255,255,.35)}
    .badge{font-size:12px;border:1px solid rgba(255,255,255,.4);color:#fff;padding:4px 8px;border-radius:999px}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:0;border-top:1px solid var(--line);background:#fff}
    .col{padding:22px}.col+.col{border-left:1px solid var(--line)}
    h2{font-size:18px;margin:0 0 14px}
    label{display:block;font-weight:600;margin:12px 0 6px}
    input[type="text"],select,textarea{
      width:100%;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font:inherit;outline:none;
    }
    textarea{min-height:120px;resize:vertical}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
    .btn{appearance:none;border:none;background:var(--brand);color:#fff;padding:12px 16px;border-radius:12px;
      font-weight:700;cursor:pointer}
    .btn:hover{background:var(--brand-2)}
    .btn.ghost{background:#fff;color:var(--brand);border:1px solid var(--brand)}
    .meta{color:var(--muted);font-size:13px}
    ul.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
    .cmt{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#fff}
    .cmt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    .stars{color:#f59e0b;letter-spacing:2px}
    .cmt-body{line-height:1.45}
    .cmt-meta{margin-top:6px;color:var(--muted);font-size:12px}
    .foot{padding:18px 22px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;background:#fafafa}
    .foot a{color:var(--brand);text-decoration:none;font-weight:600}
    @media (max-width: 900px){
      .grid{grid-template-columns:1fr}
      .col+.col{border-left:none;border-top:1px solid var(--line)}
    }
  </style></head><body>
  <div class="wrap">
    <div class="card">
      <div class="card-head" style="background:linear-gradient(135deg,var(--bg1),var(--bg2));">
        <div class="pro">
          <img alt="Foto de ${escapeHTML(p.nome)}" src="${escapeHTML(p.foto||"/img/placeholder.png")}" />
          <div>
            <h1 class="title">Avaliar ${escapeHTML(p.nome)}</h1>
            <p class="subtitle">${escapeHTML(p.servico||p.profissao||"")} • ${escapeHTML(p.bairro||"")} — ${escapeHTML(p.cidade||"")}</p>
            ${p.verificado ? `<span class="badge">VERIFICADO</span>` : ``}
          </div>
        </div>
      </div>
      <div class="grid">
        <div class="col">
          <h2>Deixe sua avaliação</h2>
          <form method="POST" action="/profissional/${p.id}/avaliar" novalidate>
            <label for="autor">Seu nome</label>
            <input id="autor" name="autor" type="text" placeholder="Opcional" />
            <label for="nota">Nota</label>
            <select id="nota" name="nota" required>
              <option value="5">5 - Excelente</option>
              <option value="4">4 - Muito bom</option>
              <option value="3">3 - Bom</option>
              <option value="2">2 - Regular</option>
              <option value="1">1 - Ruim</option>
            </select>
            <label for="comentario">Comentário</label>
            <textarea id="comentario" name="comentario" minlength="5" required placeholder="Conte como foi sua experiência"></textarea>
            <div class="row">
              <button class="btn" type="submit">Enviar avaliação</button>
              <a class="btn ghost" href="/perfil.html?id=${p.id}">Voltar ao perfil</a>
            </div>
            <p class="meta">Ao enviar, você concorda com os Termos de Uso.</p>
          </form>
        </div>
        <div class="col">
          <h2>Comentários recentes</h2>
          <ul class="list">
            ${itens || `<li class="meta" style="padding:6px 0">Sem comentários ainda.</li>`}
          </ul>
        </div>
      </div>
      <div class="foot">
        <a href="/clientes.html">← Voltar para a busca</a>
        <span class="meta">Autônoma.app</span>
      </div>
    </div>
  </div></body></html>`);
});

// SSR leve /profissional/:id
app.get("/profissional/:id", (req,res)=>{
  const idNum = Number(req.params.id || "0");
  if (!Number.isFinite(idNum) || idNum <= 0) return res.redirect("/clientes.html");
  return res.redirect(`/perfil.html?id=${idNum}`);
});

// =======================[ Métricas/Tracking ]===================
function appendMetric(key, payload){
  const metr = readJSON(METRICS_FILE, {});
  const day = (new Date()).toISOString().slice(0,10);
  metr[key] ||= {};
  metr[key][day] ||= [];
  metr[key][day].push(payload);
  writeJSON(METRICS_FILE, metr);
}
app.post("/api/track/visit/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (p){
    p.visitas = (p.visitas||0)+1;
    (p.visitsLog ||= []).push({ at: nowISO(), ip:getIP(req) });
    writeDB(db);
    appendMetric("visit", { id, at: nowISO() });
  }
  res.json({ ok:true });
});
app.post("/api/track/call/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (p){
    p.chamadas = (p.chamadas||0)+1;
    (p.callsLog ||= []).push({ at: nowISO(), ip:getIP(req) });
    writeDB(db);
    appendMetric("call", { id, at: nowISO() });
  }
  res.json({ ok:true });
});
app.post("/api/track/qr/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (p){
    (p.qrLog ||= []).push({ at: nowISO(), ip:getIP(req) });
    writeDB(db);
    appendMetric("qr", { id, at: nowISO() });
  }
  res.json({ ok:true });
});

// ===========================[ QR CODE ]=========================
app.get("/api/qr", async (req, res) => {
  try{
    let text = "";
    if (req.query.phone) {
      const d = String(req.query.phone).replace(/\D/g,"");
      if (!d) return res.status(400).json({ ok:false, error:"phone inválido" });
      const msg = String(req.query.text||"").trim();
      text = "https://wa.me/" + d + (msg?`?text=${encodeURIComponent(msg)}`:"");
    } else if (req.query.text) {
      text = String(req.query.text);
    } else {
      return res.status(400).json({ ok:false, error:"informe text ou phone" });
    }
    res.type("png");
    await QRCode.toFileStream(res, text, { width: 256, margin: 1 });
  }catch(e){
    res.status(500).json({ ok:false, error: String(e) });
  }
});

// =========================[ Top 10 semanal ]====================
function weekKeyFor(d){
  const dt = new Date(d);
  const y = dt.getFullYear();
  const onejan = new Date(y,0,1);
  const day = Math.floor((dt - onejan)/86400000);
  const wk = Math.ceil((day + onejan.getDay() + 1) / 7);
  return `${y}-W${String(wk).padStart(2,"0")}`;
}
function scoreTop10(p){
  const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
  const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length) : 0;
  const thisWeek = weekKeyFor(new Date());
  const calls = (p.callsLog||[]).filter(x=> weekKeyFor(x.at)===thisWeek ).length;
  const sevenAgo = Date.now() - 6*86400000;
  const visits = (p.visitsLog||[]).filter(x=> Date.parse(x.at)>=sevenAgo ).length;
  const planBoost = p.plano==="premium" ? 1 : (p.plano==="pro" ? 0.5 : 0);
  return (calls*2) + (visits*0.5) + (rating*3) + (p.verificado?0.5:0) + planBoost;
}
app.get("/api/top10", (req,res)=>{
  const cidade = norm(trim(req.query.cidade||""));
  const serv   = norm(trim(req.query.servico||""));
  const db = readDB().filter(p=>!p.suspenso && !p.excluido);
  let list = db;
  if (cidade) list = list.filter(p => norm(p.cidade).includes(cidade));
  if (serv)   list = list.filter(p => norm(p.servico||p.profissao).includes(serv));
  list = list.map(p => ({ ...p, topScore: scoreTop10(p) }))
             .sort((a,b)=> (b.topScore)-(a.topScore))
             .slice(0,10)
             .map(p => ({
               id: p.id, nome:p.nome, foto:p.foto||"",
               servico:p.servico||p.profissao||"",
               cidade:p.cidade||"", bairro:p.bairro||"",
               atendimentos:p.atendimentos||0,
               rating: (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0,
               badge: p.plano==="premium"?"PREMIUM":(p.plano==="pro"?"PRO":"")
             }));
  res.json({ ok:true, week: weekKey(), items:list });
});
// ===== WhatsApp sender (STUB) =====
// Troque este stub por integração real (Meta WhatsApp Cloud API / provedor)
// Por enquanto, só loga o texto. Isso já habilita o fluxo de reset.
async function sendWhatsAppMessage(toDigits55, text){
  console.log("[WHATSAPP][STUB] ->", toDigits55, "MSG:", text);
  // TODO: integrar com a API real (por ex. Meta Cloud API)
  return true;
}
function random6(){ return String(Math.floor(100000 + Math.random()*900000)); }
// ========= Reset de PIN por WhatsApp =========

// 1) Solicitar código: cria um token 6 dígitos e envia via WhatsApp
app.post("/api/painel/reset-pin/request", async (req,res)=>{
  try{
    const phoneRaw = String(req.body?.phone||"").trim();
    const phoneDigits = ensureBR(onlyDigits(phoneRaw));
    if (!/^\d{12,13}$/.test(phoneDigits)){
      return res.status(400).json({ ok:false, error:"phone_required" });
    }
    const db = readDB();
    const p = db.find(x => ensureBR(onlyDigits(x.whatsapp||"")) === phoneDigits && !x.excluido);
    if (!p) return res.status(404).json({ ok:false, error:"not_found" });

    const code = random6();
    const expiresAt = Date.now() + 10*60*1000; // 10 minutos
    p.pinReset = { code, expiresAt, sentAt: Date.now() };
    writeDB(db);

    const msg = `Autônoma.app\nSeu código para redefinir PIN é: ${code}\nVálido por 10 minutos.\nSe não foi você, ignore.`;
    await sendWhatsAppMessage(phoneDigits, msg);

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});
// 2) Confirmar reset: valida código e define novo PIN
app.post("/api/painel/reset-pin/confirm", (req,res)=>{
  try{
    const phoneRaw = String(req.body?.phone||"").trim();
    const code = String(req.body?.code||"").trim();
    const newPin = String(req.body?.newPin||"").trim();

    const phoneDigits = ensureBR(onlyDigits(phoneRaw));
    if (!/^\d{12,13}$/.test(phoneDigits)) return res.status(400).json({ ok:false, error:"phone_required" });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok:false, error:"code_invalid" });
    if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ ok:false, error:"pin_invalid_format" });

    const db = readDB();
    const p = db.find(x => ensureBR(onlyDigits(x.whatsapp||"")) === phoneDigits && !x.excluido);
    if (!p) return res.status(404).json({ ok:false, error:"not_found" });

    const pr = p.pinReset || {};
    if (!pr.code || !pr.expiresAt) return res.status(400).json({ ok:false, error:"no_request" });
    if (Date.now() > Number(pr.expiresAt)) return res.status(400).json({ ok:false, error:"code_expired" });
    if (String(pr.code) !== code) return res.status(400).json({ ok:false, error:"code_invalid" });

    // define novo PIN
    const saltRounds = 10;
    try{
      p.pinHash = bcrypt.hashSync(newPin, saltRounds);
    }catch(e){
      return res.status(500).json({ ok:false, error:"hash_error" });
    }
    p.mustSetPin = false;
    p.pinReset = null;
    writeDB(db);

    // cria sessão painel
    if (!req.session) req.session = {};
    req.session.painel = { ok:true, proId: p.id, when: Date.now() };

    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});
// =====================[ Painel do Profissional ]================
app.get("/api/painel/me", (req, res) => {
  try {
    const db = readDB();
    let pro = null;

    if (req.session?.painel?.ok) {
      pro = db.find(p => Number(p.id) === Number(req.session.painel.proId) && !p.excluido);
    }
    if (!pro) {
      const auth = String(req.headers.authorization || "");
      if (auth.startsWith("Bearer ")) {
        const tok = ensureBR(onlyDigits(auth.slice(7)));
        if (tok && /^\d{12,13}$/.test(tok)) {
          pro = db.find(p => ensureBR(onlyDigits(p.whatsapp)) === tok && !p.excluido);
          if (pro) req.session.painel = { ok:true, proId: pro.id, when: Date.now() };
        }
      }
    }
    if (!pro) return res.status(401).json({ ok:false });

    const notas  = (pro.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
    const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
    const fees = { cardPercent: FEE_CARD_PERCENT, pixPercent: FEE_PIX_PERCENT };

    return res.json({
      ok: true,
      id: pro.id,
      nome: pro.nome,
      foto: pro.foto || "",
      servico: pro.servico || pro.profissao || "",
      cidade: pro.cidade || "",
      bairro: pro.bairro || "",
      descricao: pro.descricao || "",
      whatsapp: pro.whatsapp || "",
      site: pro.site || "",
      atendimentos: pro.atendimentos || 0,
      avaliacoes: pro.avaliacoes || [],
      visitas: pro.visitas || 0,
      chamadas: pro.chamadas || 0,
      rating,
      verificado: !!pro.verificado,
      suspenso: !!pro.suspenso,
      plano: pro.plano || "free",
      raioKm: Number(pro.raioKm||0),
      cidadesExtras: Array.isArray(pro.cidadesExtras) ? pro.cidadesExtras : [],
      radar: pro.radar || { on:false, until:null, lastOnAt:null },
      receiveViaApp: !!pro.receiveViaApp,
      needPinSetup: !!pro.mustSetPin || !pro.pinHash,
      fees
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

// Painel HTML com ?token= opcional
// Painel HTML (somente com sessão válida; sem login por token)
app.get("/painel.html", (req, res) => {
  if (!(req.session?.painel?.ok)) return res.redirect("/painel_login.html");
  return res.sendFile(path.join(PUBLIC_DIR, "painel.html"));
});

// === Login do Painel: requer WhatsApp + PIN de 6 dígitos ===
app.post("/api/painel/login", loginLimiter, (req, res) => {
  try {
    const phone = ensureBR(onlyDigits(req.body?.phone || req.body?.token || ""));
    const pin   = String(req.body?.pin || "").trim();
    if (!phone) return res.status(400).json({ ok:false, error:"phone_required" });

    const db  = readDB();
    const pro = db.find(p => ensureBR(onlyDigits(p.whatsapp)) === phone && !p.excluido);
    if (!pro)  return res.status(401).json({ ok:false, error:"not_found" });

    // se não tem PIN cadastrado ainda -> exigir configuração
    if (!pro.pinHash) {
      pro.mustSetPin = true;
      writeDB(db);
      return res.status(409).json({ ok:false, error:"pin_not_set", needPinSetup:true });
    }

    // formato do PIN
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ ok:false, error:"pin_invalid_format" });
    }

    // valida PIN
    const ok = bcrypt.compareSync(pin, pro.pinHash);
    if (!ok) return res.status(401).json({ ok:false, error:"pin_incorrect" });

    // sucesso -> cria sessão do painel
    req.session.painel = { ok:true, proId: pro.id, when: Date.now() };
    return res.json({ ok:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
});
// Definir ou trocar PIN (somente logado)
// Regras: PIN = 6 dígitos, guarda hash com bcrypt
app.post("/api/painel/set-pin", (req, res) => {
  const s = req.session?.painel;
  if (!s?.ok || !s.proId) return res.status(401).json({ ok:false });

  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ ok:false, error:"pin_format" });

  const db = readDB();
  const p = db.find(x => Number(x.id) === Number(s.proId));
  if (!p) return res.status(404).json({ ok:false });

  const salt = bcrypt.genSaltSync(10);
  p.pinHash = bcrypt.hashSync(pin, salt);
  p.mustSetPin = false;

  writeDB(db);
  res.json({ ok:true });
});
app.post("/api/painel/logout", (req,res)=>{ if (req.session) req.session.painel=null; res.json({ ok:true }); });

app.get("/api/painel/state", (req,res)=>{
  const s = (req.session && req.session.painel) ? req.session.painel : null;
  if (!s || !s.ok || !s.proId) return res.json({ ok:false });
  const db = readDB();
  const p = db.find(x=> Number(x.id)===Number(s.proId));
  if (!p) return res.json({ ok:false });
  res.json({
    ok:true,
    pro:{
      id:p.id, nome:p.nome, plano:p.plano,
      raioKm:p.raioKm, cidadesExtras:p.cidadesExtras||[],
      radar:p.radar||{},
      receiveViaApp: !!p.receiveViaApp
    }
  });
});

function proLimits(p){
  if (p.plano==="premium") return { maxRaio:50, maxCidades:10, uberUnlimited:true, maxUberActivations:Infinity };
  if (p.plano==="pro")     return { maxRaio:30, maxCidades:3,  uberUnlimited:false, maxUberActivations:5 };
  return { maxRaio:0, maxCidades:0, uberUnlimited:false, maxUberActivations:0 };
}


app.post("/api/painel/radar", (req,res)=>{
  const s = req.session?.painel;
  if (!s?.ok || !s?.proId) return res.status(401).json({ ok:false });
  const { on, durationHours } = req.body || {};
  const db = readDB();
  const p = db.find(x=> Number(x.id)===s.proId);
  if (!p) return res.status(404).json({ ok:false });

  const nowRef = monthRefOf();
  p.radar ||= { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:nowRef };
  if (p.radar.monthRef !== nowRef){ p.radar.monthRef=nowRef; p.radar.monthlyUsed=0; }
  const lim = proLimits(p);

  if (on===true){
    if (p.plano==="free") return res.status(403).json({ ok:false, error:"Somente Pro/Premium" });
    if (!lim.uberUnlimited && (p.radar.monthlyUsed||0) >= (lim.maxUberActivations||0)){
      return res.status(403).json({ ok:false, error:"Limite mensal" });
    }
    p.radar.on = true;
    p.radar.lastOnAt = nowISO();
    p.radar.monthlyUsed = (p.radar.monthlyUsed||0)+1;
    const dur = Number(durationHours);
    p.radar.until = Number.isFinite(dur) && dur>0 ? new Date(Date.now()+dur*3600e3).toISOString() : null;
  } else if (on===false){
    p.radar.on = false; p.radar.until = null;
  }
  writeDB(db);
  res.json({ ok:true, radar:p.radar });
});

app.post("/api/painel/radar/autooff", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
  const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });
  const h = Number((req.body?.hours) ?? null);
  p.radar ||= { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:monthRefOf() };
  p.radar.until = (Number.isFinite(h) && h>0) ? new Date(Date.now()+h*3600e3).toISOString() : null;
  writeDB(db);
  res.json({ ok:true, radar:p.radar });
});

app.post("/api/painel/raio", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
  const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });
  const lim = proLimits(p);
  const r = Number(req.body?.raioKm||0);
  if (Number.isFinite(r) && r>=0){ p.raioKm = Math.min(r, lim.maxRaio); }
  writeDB(db);
  res.json({ ok:true, raioKm:p.raioKm });
});

app.post("/api/painel/cidades", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
  const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });
  const lim = proLimits(p);
  const action = String(req.body?.action||"");
  if (action==="add"){
    const cidade = normalizeCidadeUF(String(req.body?.cidade||"")); if (!cidade) return res.status(400).json({ ok:false });
    p.cidadesExtras ||= [];
    if (!p.cidadesExtras.includes(cidade) && p.cidadesExtras.length < lim.maxCidades) p.cidadesExtras.push(cidade);
  } else if (action==="set"){
    const list = Array.isArray(req.body?.list) ? req.body.list.map(c=> normalizeCidadeUF(String(c||""))).filter(Boolean) : [];
    p.cidadesExtras = list.slice(0, lim.maxCidades);
  }
  writeDB(db);
  res.json({ ok:true, cidadesExtras:p.cidadesExtras });
});

app.post("/api/painel/payment-prefs", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
  const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });
  const receiveViaApp = !!req.body?.receiveViaApp;
  p.receiveViaApp = receiveViaApp; writeDB(db);
  res.json({ ok:true, receiveViaApp });
});

app.post("/api/painel/update",
  (req,res,next)=> upload.single("foto")(req,res,(err)=> { if (err) return res.status(400).json({ ok:false, error:err.message }); next(); }),
  (req,res)=>{
    const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
    const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });

    const nome = trim(req.body?.nome||"");
    const descricao = trim(req.body?.descricao||"");
    const precoBase = trim(req.body?.precoBase||"");
    const site = trim(req.body?.site||"");
    if (nome) p.nome = nome;
    p.descricao = descricao;
    p.precoBase = precoBase;
    p.site = site;
    if (req.file?.filename) p.foto = `/uploads/${req.file.filename}`;
    writeDB(db);
    res.json({ ok:true });
  });

app.get("/api/painel/export.csv", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).type("text").send("login requerido");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===s.proId);
  if (!p) return res.status(404).type("text").send("não encontrado");

  const header = ["campo","valor"].join(",");
  const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
  const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(2) : "0";
  const lines = [
    ["id",p.id],["nome",p.nome],["whatsapp",p.whatsapp],["cidade",p.cidade],["bairro",p.bairro],
    ["servico",p.servico||p.profissao||""],["plano",p.plano],["raioKm",p.raioKm],
    ["atendimentos",p.atendimentos||0],["visitas",p.visitas||0],["chamadas",p.chamadas||0],["rating",rating]
  ].map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(","));
  const csv = [header, ...lines].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=meu_painel.csv");
  res.send(csv);
});

// ===========================[ Pagamentos ]=====================
function newPaymentId(){ return crypto.randomBytes(10).toString("hex"); }
app.get("/api/checkout/options", (_req,res)=>{
  res.json({ ok:true, pix: PIX_ENABLED, card: CARD_ENABLED, fees: { cardPercent:FEE_CARD_PERCENT, pixPercent:FEE_PIX_PERCENT } });
});
app.post("/api/checkout/intent", (req,res)=>{
  try{
    const { proId, amount, method } = req.body||{};
    const id = Number(proId||"0");
    const amt = Number(amount||0);
    const m = String(method||"").toLowerCase(); // 'pix' | 'card'
    if (!id || !(m==="pix"||m==="card") || !(amt>0)) return res.status(400).json({ ok:false });

    const db = readDB();
    const p = db.find(x=> Number(x.id)===id && !x.excluido);
    if (!p) return res.status(404).json({ ok:false });

    const feesPercent = (m==="card")?FEE_CARD_PERCENT:FEE_PIX_PERCENT;
    const appFee = Math.round(amt * (feesPercent/100) * 100) / 100;
    const toPro  = Math.max(0, Math.round((amt - appFee)*100)/100);

    const store = readJSON(PAYMENTS_FILE, []);
    const pay = { pid:newPaymentId(), proId:id, method:m, amount:amt, feesPercent, appFee, toPro, status:"pending", createdAt: nowISO() };
    store.push(pay); writeJSON(PAYMENTS_FILE, store);
    res.json({ ok:true, payment: pay });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});
app.post("/api/checkout/pay/:pid", (req,res)=>{
  const pid = String(req.params.pid||"");
  const store = readJSON(PAYMENTS_FILE, []);
  const it = store.find(x=> x.pid===pid);
  if (!it) return res.status(404).json({ ok:false });
  if (it.status!=="pending") return res.json({ ok:true, payment:it });
  it.status = "paid"; it.paidAt = nowISO();
  writeJSON(PAYMENTS_FILE, store);
  res.json({ ok:true, payment:it });
});
app.get("/api/checkout/payment/:pid", (req,res)=>{
  const pid = String(req.params.pid||"");
  const store = readJSON(PAYMENTS_FILE, []);
  const it = store.find(x=> x.pid===pid);
  if (!it) return res.status(404).json({ ok:false });
  res.json({ ok:true, payment:it });
});
app.get("/api/checkout/pro/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (!p) return res.status(404).json({ ok:false });
  res.json({
    ok:true,
    pro:{ id:p.id, nome:p.nome, receiveViaApp:!!p.receiveViaApp },
    options: { pix:PIX_ENABLED, card:CARD_ENABLED, fees:{ cardPercent:FEE_CARD_PERCENT, pixPercent:FEE_PIX_PERCENT } }
  });
});

// ===========================[ Denúncias ]======================
app.post("/api/denuncias", (req,res)=>{
  try{
    const body = req.body||{};
    const proId = Number(body.profissional||"0");
    const motivo = trim(body.motivo);
    const detalhes = trim(body.detalhes);
    if (!proId || !motivo) return res.status(400).json({ ok:false, error:"Dados inválidos" });

    const arr = readJSON(DENUNCIAS_FILE, []);
    arr.push({
      id: arr.length? arr[arr.length-1].id+1 : 1,
      proId, motivo, detalhes,
      at: nowISO(), ip:getIP(req),
      resolved:false
    });
    writeJSON(DENUNCIAS_FILE, arr);
    appendMetric("report", { proId, at: nowISO() });
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// =====================[ Favoritos (FAV_UID) ]==================
const FAV_FILE = path.join(DATA_DIR, "favorites.json");
if (!fs.existsSync(FAV_FILE)) writeJSON(FAV_FILE, {});
const readFavMap  = ()=> readJSON(FAV_FILE, {});
const writeFavMap = (m)=> writeJSON(FAV_FILE, m);

function parseCookies(req){
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(p=>{
    const i = p.indexOf("=");
    if (i>0){
      const k = p.slice(0,i).trim();
      const v = decodeURIComponent(p.slice(i+1).trim());
      out[k] = v;
    }
  });
  return out;
}
function setCookie(res, name, value, opts={}){
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge/1000)}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push(`Secure`);
  if (opts.httpOnly) parts.push(`HttpOnly`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function ensureFavUID(req, res){
  const cookies = parseCookies(req);
  let uid = cookies.FAV_UID || "";
  if (!uid){
    uid = crypto.randomBytes(12).toString("hex");
    setCookie(res, "FAV_UID", uid, { maxAge: 365*24*3600*1000, path:"/", sameSite:"Lax", secure:false });
  }
  return uid;
}

app.get("/api/favoritos", (req,res)=>{
  try{
    const uid = ensureFavUID(req,res);
    const map = readFavMap();
    const ids = Array.isArray(map[uid]) ? map[uid] : [];
    const db = readDB();
    const items = ids
      .map(id => db.find(p => Number(p.id)===Number(id) && !p.excluido))
      .filter(Boolean)
      .map(p=>{
        const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
        const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length) : 0;
        return {
          id: p.id,
          nome: p.nome,
          servico: p.servico || p.profissao || "",
          cidade: p.cidade || "",
          bairro: p.bairro || "",
          foto: p.foto || "",
          rating
        };
      });
    res.json({ ok:true, ids, items });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

app.post("/api/favoritos/toggle", (req,res)=>{
  try{
    const uid = ensureFavUID(req,res);
    const id = Number((req.body && req.body.id) || (req.query && req.query.id) || "0");
    if (!Number.isFinite(id) || id<=0) return res.status(400).json({ ok:false, error:"id inválido" });

    const db = readDB();
    const exists = db.some(p => Number(p.id)===id && !p.excluido);
    if (!exists) return res.status(404).json({ ok:false, error:"profissional não encontrado" });

    const map = readFavMap();
    const list = Array.isArray(map[uid]) ? map[uid] : [];
    const i = list.findIndex(x => Number(x)===id);
    let action = "";
    if (i>=0){ list.splice(i,1); action="removed"; } else { list.push(id); action="added"; }
    map[uid] = list;
    writeFavMap(map);
    res.json({ ok:true, action, ids:list });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});
app.delete("/api/favoritos/:id", (req,res)=>{
  try{
    const uid = ensureFavUID(req,res);
    const id = Number(req.params.id||"0");
    if (!Number.isFinite(id) || id<=0) return res.status(400).json({ ok:false, error:"id inválido" });
    const map = readFavMap();
    const list = Array.isArray(map[uid]) ? map[uid] : [];
    const i = list.findIndex(x => Number(x)===id);
    if (i>=0){ list.splice(i,1); map[uid]=list; writeFavMap(map); }
    res.json({ ok:true, ids:list });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// ===================[ Admin — login & dashboard ]=================
function requireAdmin(req,res,next){ if (req.session?.isAdmin) return next(); return res.status(401).json({ ok:false }); }

// /admin -> redireciona para /admin/login ou /admin.html
app.get("/admin", (req,res)=>{
  if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login");
  return res.redirect("/admin.html");
});

// GET /admin/login
app.get("/admin/login", (_req,res)=>{
  const file = path.join(PUBLIC_DIR, "admin-login.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  // fallback simples
  return res.send(`<!doctype html>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/css/app.css">
  <div class="wrap">
    <div class="card" style="max-width:420px;margin:auto">
      <h1>Admin • Entrar</h1>
      <form method="POST" action="/admin/login" style="margin-top:8px">
        <label for="usuario">Usuário</label>
        <input id="usuario" name="user" type="text" required placeholder="admin" />
        <label for="senha">Senha</label>
        <input id="senha" name="password" type="password" required placeholder="admin123" />
        <div class="row" style="margin-top:10px;gap:8px">
          <button class="btn" type="submit">Entrar</button>
          <a class="btn ghost" href="/">Início</a>
        </div>
      </form>
    </div>
  </div>`);
});

// POST /admin/login
app.post("/admin/login", loginLimiter, (req, res) => {
  const user = trim((req.body?.user ?? req.body?.usuario ?? "").toString());
  const pass = (req.body?.password ?? req.body?.senha ?? "").toString();
  const userOk = user === ADMIN_USER;
  let passOk = false;
  if (ADMIN_PASS_HASH) {
    try { passOk = bcrypt.compareSync(pass, ADMIN_PASS_HASH); }
    catch { passOk = false; }
  } else {
    passOk = pass === ADMIN_PASS;
  }
  if (userOk && passOk) {
    req.session.isAdmin = true;
    req.session.adminAt = Date.now();
    return res.redirect("/admin.html");
  }
  return res
    .status(401)
    .send(htmlMsg("Login inválido", "Usuário/senha incorretos.", "/admin/login"));
});

// Logout
app.post("/admin/logout", (req,res)=>{ if (req.session) req.session.isAdmin = false; res.redirect("/admin/login"); });

// /admin.html protegido
app.get("/admin.html", (req,res)=>{
  if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login");
  return res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// ---- helpers de stats p/ admin ----
function adminBuildStats(){
  const db = readDB().filter(p=>!p.excluido);
  const metr = readJSON(METRICS_FILE, {});
  const total = db.length;
  const ativos = db.filter(p=>!p.suspenso).length;
  const suspensos = db.filter(p=>p.suspenso).length;
  const excluidos = readDB().filter(p=>p.excluido).length;
  const verificados = db.filter(p=>computeVerified(p)).length;
  const mediaRating = (()=>{
    const arr = db.map(p=>{
      const ns=(p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
      return ns.length ? ns.reduce((a,b)=>a+b,0)/ns.length : 0;
    }).filter(x=>x>0);
    return arr.length ? Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*100)/100 : 0;
  })();
  const days = [];
  for(let i=29;i>=0;i--){
    const d = new Date(Date.now()-i*24*3600e3).toISOString().slice(0,10);
    const v = (metr.visit?.[d]||[]).length||0;
    const c = (metr.call ?. [d]||[]).length||0;
    const q = (metr.qr   ?. [d]||[]).length||0;
    days.push({ day:d, visits:v, calls:c, qrs:q });
  }
  return { ok:true, counters:{ total, ativos, suspensos, excluidos, verificados, mediaRating }, last30: days };
}
function adminBuildList(query){
  const db = readDB().filter(p=>!p.excluido);
  const q = (query?.q||"").toString().trim();
  const cidade = (query?.cidade||"").toString().trim();
  const serv   = (query?.servico||query?.profissao||"").toString().trim();

  let items = db;
  const N = (s)=> norm(String(s||""));

  if (q){
    const QQ = N(q);
    items = items.filter(p =>
      N(p.nome).includes(QQ) ||
      N(p.bairro||"").includes(QQ) ||
      N(p.cidade||"").includes(QQ) ||
      N(p.servico||p.profissao||"").includes(QQ));
  }
  if (cidade){
    const C = N(cidade);
    items = items.filter(p => N(p.cidade||"").includes(C));
  }
  if (serv){
    const S = N(serv);
    items = items.filter(p => N(p.servico||p.profissao||"").includes(S));
  }
  items.sort((a,b)=> Number(b.id)-Number(a.id));
  return items.map(p=>({
    id:p.id, nome:p.nome, servico:p.servico||p.profissao||"",
    cidade:p.cidade||"", bairro:p.bairro||"",
    visitas:p.visitas||0, chamadas:p.chamadas||0,
    rating: (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0,
    plano:p.plano||"free", verificado:!!p.verificado
  }));
}

// ---- APIs admin ----
// NOVO: sessão admin (para o front saber se está logado)
app.get("/api/admin/session", (_req,res)=>{
  const isAdmin = !!(_req.session && _req.session.isAdmin);
  res.json({ ok:true, isAdmin });
});

// já existia
app.get("/api/admin/stats", requireAdmin, (_req,res)=> res.json(adminBuildStats()));
app.get("/api/admin/list",  requireAdmin, (req,res)=> res.json({ ok:true, items: adminBuildList(req.query||{}) }));

// Lista de profissionais com filtros + paginação (já existia)
app.get("/api/admin/profissionais", requireAdmin, (req,res)=>{
  try{
    const q        = String(req.query.q||"").trim();
    const cidadeQ  = String(req.query.cidade||"").trim();
    const servQ    = String(req.query.servico||"").trim();
    const verifQ   = String(req.query.verificado||"all");
    const statusQ  = String(req.query.status||"all");
    const sort     = String(req.query.sort||"recent");
    const dirAsc   = String(req.query.dir||"desc").toLowerCase()==="asc";
    const page     = Math.max(1, Number(req.query.page||1));
    const limit    = Math.max(1, Math.min(50, Number(req.query.limit||20)));
    const N = (s)=> norm(String(s||""));

    let items = readDB().slice();

    // status
    if (statusQ==="ativos")      items = items.filter(p=> !p.excluido && !p.suspenso);
    else if (statusQ==="suspensos") items = items.filter(p=> p.suspenso && !p.excluido);
    else if (statusQ==="excluidos") items = items.filter(p=> p.excluido);
    // texto livre
    if (q){
      const QQ = N(q);
      items = items.filter(p=>
        N(p.nome).includes(QQ) ||
        N(p.bairro||"").includes(QQ) ||
        N(p.cidade||"").includes(QQ) ||
        N(p.servico||p.profissao||"").includes(QQ)
      );
    }
    // cidade
    if (cidadeQ){
      const C = N(cidadeQ);
      items = items.filter(p=> N(p.cidade||"").includes(C));
    }
    // serviço
    if (servQ){
      const S = N(servQ);
      items = items.filter(p=> N(p.servico||p.profissao||"").includes(S));
    }
    // verificado
    if (verifQ==="true")  items = items.filter(p=> computeVerified(p));
    if (verifQ==="false") items = items.filter(p=> !computeVerified(p));

    // campos auxiliares
    items = items.map(p=>{
      const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
      const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length) : 0;
      return {
        id: p.id, nome: p.nome, foto: p.foto||"",
        cidade: p.cidade||"", bairro: p.bairro||"",
        servico: p.servico || p.profissao || "",
        verificado: computeVerified(p),
        rating,
        avalCount: (p.avaliacoes||[]).length,
        visitas: p.visitas||0,
        chamadas: p.chamadas||0,
        plano: p.plano||"free",
        suspenso: !!p.suspenso,
        excluido: !!p.excluido
      };
    });

    // ordenação
    const cmpNum = (a,b,k)=> (Number(a[k]||0)-Number(b[k]||0));
    const cmpStr = (a,b,k)=> String(a[k]||"").localeCompare(String(b[k]||""), "pt-BR");
    items.sort((a,b)=>{
      let v=0;
      switch (sort){
        case "recent":     v = Number(b.id)-Number(a.id); break;
        case "nome":       v = cmpStr(a,b,"nome"); break;
        case "cidade":     v = cmpStr(a,b,"cidade"); break;
        case "servico":    v = cmpStr(a,b,"servico"); break;
        case "verificado": v = (a.verificado===b.verificado)?0:(a.verificado?1:-1); break;
        case "avaliacoes": v = cmpNum(a,b,"avalCount"); break;
        case "rating":     v = cmpNum(a,b,"rating"); break;
        case "visitas":    v = cmpNum(a,b,"visitas"); break;
        case "chamadas":   v = cmpNum(a,b,"chamadas"); break;
        default:           v = Number(b.id)-Number(a.id);
      }
      return dirAsc ? v : -v;
    });

    const total = items.length;
    const start = (page-1)*limit;
    const slice = items.slice(start, start+limit);
    res.json({ ok:true, total, page, pages: Math.max(1, Math.ceil(total/limit)), items: slice });
  }catch(e){
    console.error("ERR /api/admin/profissionais", e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// Ações: suspender / ativar / excluir / restaurar
app.post("/api/admin/profissionais/:id/suspender", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.suspenso = true;
    p.suspensoMotivo = trim(req.body?.motivo||"");
    p.suspensoEm = nowISO();
    writeDB(db);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});
app.post("/api/admin/profissionais/:id/ativar", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.suspenso = false;
    p.suspensoMotivo = "";
    writeDB(db);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});
app.delete("/api/admin/profissionais/:id", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.excluido = true;
    p.excluidoEm = nowISO();
    writeDB(db);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});
app.post("/api/admin/profissionais/:id/restaurar", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.excluido = false;
    p.excluidoEm = null;
    writeDB(db);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error:String(e) }); }
});

// Denúncias: lista e atualização
app.get("/api/admin/denuncias", requireAdmin, (req,res)=>{
  try{
    const statusQ = String(req.query.status||"all");
    const q = String(req.query.q||"").trim().toLowerCase();
    const page  = Math.max(1, Number(req.query.page||1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit||20)));

    const arr = readJSON(DENUNCIAS_FILE, []).slice();
    // normalizar campo status (legado)
    arr.forEach(d=>{
      if (!d.status){
        d.status = d.resolved===true ? "resolvida" : "aberta";
      }
      if (!d.createdAt) d.createdAt = d.at || nowISO();
    });

    let list = arr;
    if (statusQ!=="all"){
      list = list.filter(d=> String(d.status||"aberta")===statusQ);
    }
    if (q){
      list = list.filter(d=>{
        const txt = [
          d.motivo||"", d.detalhes||"",
          (d.profissionalNome||""),
          String(d.profissional||d.proId||"")
        ].join(" ").toLowerCase();
        return txt.includes(q);
      });
    }
    // Enriquecer com dados do profissional
    const db = readDB();
    list = list.map(d=>{
      const proId = Number(d.profissional||d.proId||0);
      const pro = db.find(p=> Number(p.id)===proId);
      return {
        id: d.id, createdAt: d.createdAt||d.at||"",
        motivo: d.motivo||"",
        status: d.status || "aberta",
        profissional: pro ? { id: pro.id, nome: pro.nome, cidade: pro.cidade||"", bairro: pro.bairro||"" } : {}
      };
    });

    list.sort((a,b)=> String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = list.length;
    const start = (page-1)*limit;
    const slice = list.slice(start, start+limit);
    res.json({ ok:true, total, page, pages: Math.max(1, Math.ceil(total/limit)), items: slice });
  }catch(e){
    console.error("ERR /api/admin/denuncias", e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});
app.post("/api/admin/denuncias/:id/status", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const status = String(req.body?.status||"").trim(); // aberta|em_analise|resolvida|descartada
    if (!["aberta","em_analise","resolvida","descartada"].includes(status)){
      return res.status(400).json({ ok:false, error:"status inválido" });
    }
    const arr = readJSON(DENUNCIAS_FILE, []);
    const it = arr.find(d=> Number(d.id)===id);
    if (!it) return res.status(404).json({ ok:false });
    it.status = status;
    if (status==="resolvida") it.resolved = true;
    writeJSON(DENUNCIAS_FILE, arr);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// NOVO: métricas para gráficos do admin + contadores do dia
app.get("/api/admin/metrics", requireAdmin, (_req,res)=>{
  try{
    const stats = adminBuildStats(); // counters + last30
    const metr  = readJSON(METRICS_FILE, {});
    const today = new Date().toISOString().slice(0,10);
    const todayVisits = (metr.visit?.[today]||[]).length || 0;
    const todayCalls  = (metr.call ?. [today]||[]).length || 0;
    const todayQrs    = (metr.qr   ?. [today]||[]).length || 0;

    // Formato para os mini-gráficos
    const series = {
      visits: stats.last30.map(d => ({ x:d.day, y:d.visits })),
      calls:  stats.last30.map(d => ({ x:d.day, y:d.calls  })),
      qrs:    stats.last30.map(d => ({ x:d.day, y:d.qrs    }))
    };

    res.json({
      ok:true,
      counters: stats.counters,   // total/ativos/suspensos/excluidos/verificados/mediaRating
      last30: stats.last30,       // [{day, visits, calls, qrs}]
      series,                      // {visits[], calls[], qrs[]}
      today: { visits: todayVisits, calls: todayCalls, qrs: todayQrs }
    });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// NOVO: listagem de pagamentos no admin (corrige 404 do /api/admin/payments)
app.get("/api/admin/payments", requireAdmin, (req,res)=>{
  try{
    const page  = Math.max(1, Number(req.query.page||1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit||20)));
    const q     = String(req.query.q||"").trim().toLowerCase();
    const status= String(req.query.status||"all"); // pending|paid|all
    const method= String(req.query.method||"all"); // pix|card|all

    let arr = readJSON(PAYMENTS_FILE, []).slice();

    if (status!=="all") arr = arr.filter(p => p.status===status);
    if (method!=="all") arr = arr.filter(p => p.method===method);
    if (q){
      arr = arr.filter(p => {
      const text = [p.pid, String(p.proId), p.method, p.status, String(p.amount||""), String(p.appFee||""), String(p.toPro||"")].join(" ").toLowerCase();
        return text.includes(q);
      });
    }

    // enriquecer com dados do profissional para exibir nome/cidade
    const db = readDB();
    const withPro = arr.map(it=>{
      const pro = db.find(x=> Number(x.id)===Number(it.proId));
      return {
        ...it,
        pro: pro ? { id: pro.id, nome: pro.nome, cidade: pro.cidade||"", bairro: pro.bairro||"" } : null
      };
    });

    // ordenar (mais recentes primeiro)
    withPro.sort((a,b)=> String(b.createdAt||"").localeCompare(String(a.createdAt||"")));

    const total = withPro.length;
    const start = (page-1)*limit;
    const items = withPro.slice(start, start+limit);

    res.json({ ok:true, total, page, pages: Math.max(1, Math.ceil(total/limit)), items });
  }catch(e){
    console.error("ERR /api/admin/payments", e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// =========================[ Exportações Admin ]===================

// Export com filtros atuais (CSV) — útil para tabelas do admin
app.get("/api/admin/export/csv", requireAdmin, (req,res)=>{
  try{
    // Reutiliza listagem com filtros
    const req2 = { ...req, method:"GET", url:"/api/admin/profissionais", query:req.query, session:req.session };
    let data = null;
    const res2 = { json(x){ data=x; } };
    app._router.handle(req2, res2, ()=>{});
    setTimeout(()=>{
      const d = data || {};
      const header = ["id","nome","cidade","bairro","servico","verificado","rating","avaliacoes","visitas","chamadas","plano","suspenso","excluido"].join(",");
      const rows = (d.items||[]).map(p=>{
        const vals = [p.id,p.nome,p.cidade,p.bairro,p.servico,p.verificado,(Number(p.rating)||0).toFixed(2),p.avalCount,p.visitas,p.chamadas,p.plano,p.suspenso,p.excluido];
        return vals.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",");
      });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition","attachment; filename=profissionais.csv");
      res.send(csv);
    },0);
  }catch(e){
    res.status(500).type("text").send("erro");
  }
});
// Admin: resetar PIN do profissional (obriga definir novamente no próximo login)
app.post("/api/admin/profissionais/:id/reset-pin", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.pinHash = null;
    p.mustSetPin = true;
    writeDB(db);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});
// Admin: resetar PIN do profissional (obriga definir novamente no próximo login)
app.post("/api/admin/profissionais/:id/reset-pin", requireAdmin, (req,res)=>{
  try{
    const id = Number(req.params.id||"0");
    const db = readDB();
    const p = db.find(x=> Number(x.id)===id);
    if (!p) return res.status(404).json({ ok:false });
    p.pinHash = null;
    p.mustSetPin = true;
    writeDB(db);
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});
// /api/admin/export?what=profissionais|payments|metrics
app.get("/api/admin/export", requireAdmin, (req,res)=>{
  try{
    const what = String(req.query.what||"profissionais");
    if (what==="payments"){
      const arr = readJSON(PAYMENTS_FILE, []);
      const header = ["pid","proId","method","status","amount","feesPercent","appFee","toPro","createdAt","paidAt"].join(",");
      const rows = arr.map(p=>{
        const vals = [p.pid,p.proId,p.method,p.status,p.amount,p.feesPercent,p.appFee,p.toPro,p.createdAt||"",p.paidAt||""];
        return vals.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",");
      });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition","attachment; filename=payments.csv");
      return res.send(csv);
    }
    if (what==="metrics"){
      const metr = readJSON(METRICS_FILE, {});
      // export básico: day, visits, calls, qrs
      const dayKeys = new Set([
        ...Object.keys(metr.visit||{}),
        ...Object.keys(metr.call ||{}),
        ...Object.keys(metr.qr   ||{})
      ]);
      const header = ["day","visits","calls","qrs"].join(",");
      const rows = Array.from(dayKeys).sort().map(d=>{
        const v=(metr.visit?.[d]||[]).length||0;
        const c=(metr.call ?. [d]||[]).length||0;
        const q=(metr.qr   ?. [d]||[]).length||0;
        return `"${d}",${v},${c},${q}`;
      });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition","attachment; filename=metrics.csv");
      return res.send(csv);
    }
    // default profissionais (sem filtro para export rápida)
    const db = readDB().filter(p=>!p.excluido);
    const header = ["id","nome","whatsapp","cidade","bairro","servico","plano","raioKm","visitas","chamadas","rating"].join(",");
    const rows = db.map(p=>{
      const rating = (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0;
      const vals = [p.id,p.nome,p.whatsapp,p.cidade,p.bairro,(p.servico||p.profissao||""),p.plano,(p.raioKm||0),(p.visitas||0),(p.chamadas||0),rating.toFixed(2)];
      return vals.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",");
    });
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition","attachment; filename=profissionais_all.csv");
    return res.send(csv);
  }catch(e){
    res.status(500).type("text").send("erro");
  }
});

// Dump completo (somente admin) — útil para backup/debug
app.get("/api/admin/_dump_all", requireAdmin, (_req,res)=>{
  const dump = {
    profissionais: readDB(),
    denuncias: readJSON(DENUNCIAS_FILE, []),
    payments: readJSON(PAYMENTS_FILE, []),
    metrics: readJSON(METRICS_FILE, {})
  };
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.send(JSON.stringify(dump,null,2));
});

// =========================[ Inicialização ]=====================
const port = BASE_PORT;
app.listen(port, HOST, ()=>{
  console.log(`Autônoma.app rodando em http://localhost:${port}`);
});