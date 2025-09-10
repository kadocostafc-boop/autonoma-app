// ============================================================================
// Autônoma.app • server.js (CONSOLIDADO)
// Data: 2025-09-08
// - Páginas públicas + PWA + SEO
// - Admin (login obrigatório) + export CSV + métricas/gráficos (endpoints JSON)
// - Painel do Profissional (login via token WhatsApp, Radar on/off, raio, cidades extras)
// - Busca com ranking (planos + distância + Radar)
// - Perfil público (/perfil.html?id=... e /profissional/:id)
// - Página Avaliar: GET /avaliar/:id  (POST já existia: /profissional/:id/avaliar)
// - Top10 semanal (visitas/chamadas/avaliações)
// - Denúncias
// - Pagamentos (stub Pix/Cartão) + taxas configuráveis
// - QR Code (/api/qr)
// - Favoritos (servidor) com cookie anônimo FAV_UID
// - Compat: /api/profissionais/:id
// - Frase WhatsApp nos JSONs (waMessageDefault) e /api/whatsapp-msg
// - Respeita .env: PRIMARY_HOST, FORCE_HTTPS, SECURE_COOKIES, REDIRECTS_DISABLED
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

// ----------------------------------------------------------------------------
// App base
// ----------------------------------------------------------------------------
const app = express();
app.set("trust proxy", 1);
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

// ----------------------------------------------------------------------------
const ROOT          = __dirname;
const PUBLIC_DIR    = path.join(ROOT, "public");
const DATA_DIR      = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOAD_DIR    = path.join(DATA_DIR, "uploads");
const DB_FILE       = path.join(DATA_DIR, "profissionais.json");
const BAIRROS_FILE  = path.join(DATA_DIR, "bairros.json");
const CIDADES_FILE  = path.join(DATA_DIR, "cidades.json");
const SERVICOS_FILE = path.join(DATA_DIR, "servicos.json");
const DENUNCIAS_FILE= path.join(DATA_DIR, "denuncias.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");
const METRICS_FILE  = path.join(DATA_DIR, "metrics.json");

[PUBLIC_DIR, DATA_DIR, UPLOAD_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); });

function readJSON(file, fallback){ try{ return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : fallback; }catch{ return fallback; } }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }

// Inicia arquivos essenciais
if (!fs.existsSync(DB_FILE))         writeJSON(DB_FILE, []);
if (!fs.existsSync(DENUNCIAS_FILE))  writeJSON(DENUNCIAS_FILE, []);
if (!fs.existsSync(PAYMENTS_FILE))   writeJSON(PAYMENTS_FILE, []);
if (!fs.existsSync(METRICS_FILE))    writeJSON(METRICS_FILE, {});

// ----------------------------------------------------------------------------
// Admin / Sessão
// ----------------------------------------------------------------------------
const ADMIN_USER      = process.env.ADMIN_USER || "admin";
const ADMIN_PASS      = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ""; // se existir, tem prioridade
const SESSION_SECRET  = process.env.SESSION_SECRET || "troque-isto";

// Helpers
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
const weekKey = ()=>{  const d=new Date(); const onejan=new Date(d.getFullYear(),0,1);
  const day=Math.floor((d - onejan) / 86400000);
  const week=Math.ceil((day + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,"0")}`;};

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

// ----------------------------------------------------------------------------
// Middlewares
// ----------------------------------------------------------------------------
app.use(compression());
app.use(express.urlencoded({ extended:true }));
app.use(express.json({ limit:"1.2mb" }));
app.use(cookieParser());

// Canonical/HTTPS (respeita REDIRECTS_DISABLED)
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
// ---- Guardião do admin.html + rotas de login/admin (antes dos estáticos) ----

// Redireciona /admin -> login se não logado; se logado, vai para admin.html
app.get(['/admin', '/admin/'], (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin.html');
  return res.redirect('/admin-login.html');
});

// Protege acesso direto ao admin.html (se o usuário digitar a URL)
app.use((req, res, next) => {
  if (req.path === '/admin.html' && !(req.session?.isAdmin)) {
    return res.redirect('/admin-login.html');
  }
  next();
});

// Páginas de login do admin (layout novo em public/admin-login.html)
// Rota canônica:
app.get('/admin-login.html', (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'))
);

// Compatibilidade de caminhos antigos:
app.get(['/admin/login', '/admin_login.html', '/admin_login'], (_req, res) =>
  res.redirect(302, '/admin-login.html')
);

// POST do login do admin
app.post('/admin/login', loginLimiter, (req, res) => {
  const user = (req.body?.user || '').toString().trim();
  const pass = (req.body?.password || '').toString();

  const userOk = user === ADMIN_USER;
  let passOk = false;

  if (ADMIN_PASS_HASH) {
    try { passOk = bcrypt.compareSync(pass, ADMIN_PASS_HASH); } catch { passOk = false; }
  } else {
    passOk = pass === ADMIN_PASS; // padrão: admin / admin123 (pode trocar via .env)
  }

  if (userOk && passOk) {
    req.session.isAdmin = true;
    req.session.adminAt = Date.now();

    // Se foi fetch/AJAX, responde JSON; se foi form tradicional, redireciona
    const wantsJSON = (req.headers.accept || '').includes('application/json') || (req.headers['content-type'] || '').includes('json');
    if (wantsJSON) return res.json({ ok: true, redirect: '/admin.html' });
    return res.redirect('/admin.html');
  }

  const wantsJSON = (req.headers.accept || '').includes('application/json') || (req.headers['content-type'] || '').includes('json');
  if (wantsJSON) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

  return res.status(401).send(htmlMsg('Login inválido', 'Usuário/senha incorretos.', '/admin-login.html'));
});

// Logout (mantém)
app.post('/admin/logout', (req, res) => {
  if (req.session) req.session.isAdmin = false;
  res.redirect('/admin-login.html');
});

// Arquivos estáticos
app.use(express.static(PUBLIC_DIR, { maxAge:"7d", fallthrough: true }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge:"30d", immutable:true }));

// Evita cache dos endpoints /api/*
app.use(/^\/api\//, (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

// Sessões
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

// Limiter
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });
const reviewsLimiter = rateLimit({ windowMs: 5*60*1000,  max: 40, standardHeaders: true, legacyHeaders: false });

// ----------------------------------------------------------------------------
// GEO / AUTOCOMPLETE / GPS (base simples)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// HTML helpers
// ----------------------------------------------------------------------------
const htmlMsg = (title, text, backHref="/") =>
`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
<div class="wrap"><div class="card"><h1>${escapeHTML(title)}</h1><p class="meta">${escapeHTML(text||"")}</p><a class="btn" href="${escapeHTML(backHref)}">Voltar</a></div></div>`;

const htmlErrors = (title, list, backHref="/") =>
`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
<div class="wrap"><div class="card"><h1>${escapeHTML(title)}</h1><ul>${(list||[]).map(e=>`<li>${escapeHTML(e)}</li>`).join("")}</ul><a class="btn" href="${escapeHTML(backHref)}">Voltar</a></div></div>`;

// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Páginas estáticas e redirects
// ----------------------------------------------------------------------------
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
app.get("/perfil.html",      (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "perfil.html"))); // mantém perfil HTML

// Redirects legados/canônicos
app.get(["/perfil.html","/perfil"], (req,res)=>{
  const id = Number(req.query.id||"");
  if (id) return res.redirect(301, `/profissional/${id}`);
  return res.redirect(302, "/clientes.html");
});
app.get("/clientes", (_req,res)=> res.redirect(301, "/clientes.html"));
app.get("/cadastro", (_req,res)=> res.redirect(301, "/cadastro.html"));
// manter compat, mas agora /admin redireciona para /admin.html (protegido)
app.get("/admin.html", (req,_res,next)=> next()); // placeholder pra não conflitar com redirect abaixo
// --- Admin: guardião + login + dashboard -----------------------------------

// 1) Acessar /admin → manda para /admin/login
app.get("/admin", (req, res) => {
  if (req.session?.isAdmin) return res.redirect("/admin.html");
  return res.redirect(302, "/admin/login");
});

// 2) Página de login do admin (usa o layout novo em public/admin-login.html)
//    ATENÇÃO: o arquivo no disco é "admin-login.html" (com HÍFEN)
app.get("/admin/login", (req, res) => {
  // Se já estiver logado, pula direto para o dashboard
  if (req.session?.isAdmin) return res.redirect("/admin.html");
  return res.sendFile(path.join(PUBLIC_DIR, "admin-login.html"));
});

// 3) POST de login: usuário/senha fixos (ou .env)
//    Usuário: ADMIN_USER  (default: "admin")
//    Senha:   ADMIN_PASS  (default: "admin123")
//    Se ADMIN_PASS_HASH (bcrypt) existir, ele tem prioridade.
app.post("/admin/login", loginLimiter, (req, res) => {
  const user = (req.body?.user || "").toString().trim();
  const pass = (req.body?.password || "").toString();

  const userOk = user === ADMIN_USER;
  let passOk = false;
  if (ADMIN_PASS_HASH) {
    try { passOk = bcrypt.compareSync(pass, ADMIN_PASS_HASH); } catch { passOk = false; }
  } else {
    passOk = pass === ADMIN_PASS;
  }

  if (!userOk || !passOk) {
    return res.status(401).send(htmlMsg("Login inválido", "Usuário/senha incorretos.", "/admin/login"));
  }

  req.session.isAdmin = true;
  req.session.adminAt = Date.now();
  return res.redirect("/admin.html"); // destino final
});

// 4) Página do dashboard: só logado pode ver
app.get("/admin.html", (req, res) => {
  if (!(req.session?.isAdmin)) return res.redirect("/admin/login");
  // Se você tem um admin.html pronto em /public, sirva ele:
  return res.sendFile(path.join(PUBLIC_DIR, "admin.html")); 
  // (Se você gera HTML via string/SSR, pode manter sua versão anterior)
});

// 5) Logout
app.post("/admin/logout", (req, res) => {
  if (req.session) req.session.isAdmin = false;
  res.redirect("/admin/login");
});

// ----------------------------------------------------------------------------
// Banco (JSON) + migração/normalização
// ----------------------------------------------------------------------------
const readDB  = ()=> readJSON(DB_FILE, []);
const writeDB = (data)=> writeJSON(DB_FILE, data);

function computeVerified(p){
  return !!(p?.foto && isWhatsappValid(p.whatsapp) && p.cidade && p.bairro);
}

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
    if(typeof p.uber!=="object" || p.uber==null){
      p.uber = { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef: monthRefOf() }; changed=true;
    }
    if(!p.radar){
      p.radar = { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef: monthRefOf() }; changed=true;
    }
    if(!p.lastPos) p.lastPos = { lat:null, lng:null, at:null };
    if(typeof p.receiveViaApp!=="boolean") p.receiveViaApp=false;
  }
  if (changed) writeDB(db);
  console.log("✔ Base OK (ids/logs/planos/radar).");
})();

// ----------------------------------------------------------------------------
// Upload (multer)
// ----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits:{ fileSize: 3*1024*1024 },
  fileFilter: (_, file, cb) => file.mimetype?.startsWith("image/") ? cb(null,true) : cb(new Error("Apenas imagens (JPG/PNG)."))
});

// ----------------------------------------------------------------------------
// GEO utils + APIs (dinâmicos com arquivos)
// ----------------------------------------------------------------------------
function loadGeoMaps(){
  const bairrosMap = readJSON(BAIRROS_FILE, {}) || {};
  let cidades = readJSON(CIDADES_FILE, []);
  if (!Array.isArray(cidades)){ cidades = Object.keys(cidades||{}); }
  if (!cidades.length && bairrosMap && typeof bairrosMap==="object"){ cidades = Object.keys(bairrosMap); }
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

// ----------------------------------------------------------------------------
// Config de UI (frases/flags para o front)
// ----------------------------------------------------------------------------
const WHATSAPP_DEFAULT_MSG =
  "Olá! Vi seu perfil na Autônoma.app e gostaria de contratar seu serviço. Podemos conversar?";

app.get("/api/ui-config", (_req, res) => {
  res.json({
    ok: true,
    evaluateCTA: true,                 // para mostrar botão Avaliar no perfil
    whatsappTemplate: WHATSAPP_DEFAULT_MSG
  });
});

// ----------------------------------------------------------------------------
// Cadastro (com upload obrigatório de foto)
// ----------------------------------------------------------------------------
const CATS = ["Beleza","Construção","Manutenção","Tecnologia","Educação","Saúde","Pets","Eventos","Transporte","Outros"];

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
  (req,res,next)=> upload.single("foto")(req,res,(err)=> { if (err) return res.status(400).send(htmlMsg("Erro no upload", err.message, "/cadastro.html")); next(); }),
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
        uber: { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:monthRefOf() },
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

// ----------------------------------------------------------------------------
// Busca pública de profissionais
// ----------------------------------------------------------------------------
function isRecent(iso, mins=15){ if (!iso) return false; const t=new Date(iso).getTime(); if (!Number.isFinite(t)) return false; return (Date.now()-t) <= (mins*60*1000); }

app.get("/api/profissionais", (req, res) => {
  try{
    const db = readDB().filter(p => !p.excluido && !p.suspenso);
    // Filtros
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
    if (featured) {
      items = items.filter(p => p.verificado || (p.plano && p.plano !== 'free'));
    }
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
      items = items.filter(p => {
        const s = norm(p.servico || p.profissao || "");
        return s.includes(NS);
      });
    }
    if (minRating) {
      items = items.filter(p => {
        const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
        const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
        return rating >= minRating;
      });
    }
    if (photoOnly) {
      items = items.filter(p => !!p.foto);
    }

    // Distância, rating e score
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
      if (hasUserPos && Number.isFinite(plat) && Number.isFinite(plng)) {
        dist = haversineKm(userLat, userLng, plat, plng);
      }
      p._distKm = dist;

      // Score: plano > rating > proximidade > verificado
      const planoW = (p.plano === "premium") ? 3 : (p.plano === "pro") ? 2 : 1;
      const distW  = (dist==null) ? 0 : (dist < 2 ? 1.2 : dist < 5 ? 1.0 : 0.8);
      const verifW = p.verificado ? 0.4 : 0;
      p._score = (planoW * 2.5) + (p._rating * 1.5) + (distW) + verifW;
    }

    // Ordenação
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

    // Paginação
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

// ----------------- Perfil (APIs) -----------------
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

// Compat (antigo)
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

// -------------------- Avaliações --------------------
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

// Página de avaliação (HTML simples) -> /avaliar/:id
app.get("/avaliar/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x => Number(x.id)===id && !x.excluido);
  if (!p) return res.status(404).send(htmlMsg("Não encontrado","Profissional não localizado.","/clientes.html"));
  const avals = (p.avaliacoes||[]).slice().reverse().slice(0,30);
  const stars = (n)=>"★".repeat(n)+"☆".repeat(5-n);
  const itens = avals.map(a=>`<li><b>${escapeHTML(a.autor||"Cliente")}</b> • ${stars(Math.max(1,Math.min(5,Number(a.nota)||0)))}<br><span class="meta">${escapeHTML(new Date(a.at).toLocaleString())}</span><div>${escapeHTML(a.comentario||"")}</div></li>`).join("");
  res.send(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
  <div class="wrap">
    <div class="card">
      <h1>Avaliar ${escapeHTML(p.nome)}</h1>
      <form method="POST" action="/profissional/${p.id}/avaliar">
        <label>Seu nome</label>
        <input name="autor" placeholder="Opcional" />
        <label>Nota</label>
        <select name="nota" required>
          <option value="5">5 - Excelente</option>
          <option value="4">4 - Muito bom</option>
          <option value="3">3 - Bom</option>
          <option value="2">2 - Regular</option>
          <option value="1">1 - Ruim</option>
        </select>
        <label>Comentário</label>
        <textarea name="comentario" required minlength="5" placeholder="Conte como foi sua experiência"></textarea>
        <div class="row" style="gap:8px;margin-top:10px">
          <button class="btn" type="submit">Enviar avaliação</button>
          <a class="btn ghost" href="/perfil.html?id=${p.id}">Voltar ao perfil</a>
        </div>
      </form>
    </div>
    <div class="card">
      <h2>Comentários recentes</h2>
      <ul class="list">${itens || "<li class='meta'>Sem comentários ainda.</li>"}</ul>
    </div>
  </div>`);
});

// SSR leve /profissional/:id  -> redireciona para perfil.html
app.get("/profissional/:id", (req,res)=>{
  const idNum = Number(req.params.id || "0");
  if (!Number.isFinite(idNum) || idNum <= 0) return res.redirect("/clientes.html");
  return res.redirect(`/perfil.html?id=${idNum}`);
});

// ----------------------------------------------------------------------------
// Métricas/Tracking (visita, call, QR) — alimenta gráficos
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// QR CODE (WhatsApp ou texto)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Top 10 semanal (API)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Painel do Profissional — login por token (whatsapp) e preferências
// ----------------------------------------------------------------------------
app.get("/api/painel/me", (req, res) => {
  try {
    const db = readDB();
    let pro = null;
    // sessão
    if (req.session?.painel?.ok) {
      pro = db.find(p => Number(p.id) === Number(req.session.painel.proId) && !p.excluido);
    }
    // Authorization: Bearer <token> (whatsapp normalizado)
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
    const notas = (pro.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
    const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
    const fees = { cardPercent: FEE_CARD_PERCENT, pixPercent: FEE_PIX_PERCENT };
    return res.json({
      ok: true,
      id: pro.id,
      nome: pro.nome, foto: pro.foto || "",
      servico: pro.servico || pro.profissao || "",
      cidade: pro.cidade || "", bairro: pro.bairro || "",
      descricao: pro.descricao || "",
      whatsapp: pro.whatsapp || "", site: pro.site || "",
      atendimentos: pro.atendimentos || 0,
      avaliacoes: pro.avaliacoes || [],
      visitas: pro.visitas || 0, chamadas: pro.chamadas || 0,
      rating, verificado: !!pro.verificado, suspenso: !!pro.suspenso,
      plano: pro.plano || "free",
      raioKm: Number(pro.raioKm||0),
      cidadesExtras: Array.isArray(pro.cidadesExtras)? pro.cidadesExtras : [],
      radar: pro.radar || { on:false, until:null, lastOnAt:null },
      receiveViaApp: !!pro.receiveViaApp,
      fees
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

// Painel HTML com ?token= opcional -> cria sessão e limpa query
app.get("/painel.html", (req, res) => {
  const tokenRaw = req.query.token || "";
  if (tokenRaw) {
    const token = ensureBR(onlyDigits(tokenRaw));
    const db = readDB();
    const pro = db.find(p => ensureBR(onlyDigits(p.whatsapp)) === token && !p.excluido);
    if (pro) {
      req.session.painel = { ok:true, proId: pro.id, when: Date.now() };
      return res.redirect("/painel.html"); // limpa query
    }
  }
  if (!(req.session?.painel?.ok)) return res.redirect("/painel_login.html");
  return res.sendFile(path.join(PUBLIC_DIR, "painel.html"));
});

app.post("/api/painel/login", (req,res)=>{
  const token = ensureBR(onlyDigits(req.body?.token||""));
  if (!token) return res.status(400).json({ ok:false, error:"token" });
  const db = readDB();
  const pro = db.find(p => ensureBR(onlyDigits(p.whatsapp)) === token && !p.excluido);
  if (!pro) return res.status(401).json({ ok:false });
  req.session.painel = { ok:true, proId: pro.id, when: Date.now() };
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
      radar:p.radar||p.uber||{},
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
app.post("/api/painel/radar/toggle", (req,res)=>{
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok:false });
  const db = readDB(); const p = db.find(x=> Number(x.id)===s.proId); if (!p) return res.status(404).json({ ok:false });
  const want = !(p.radar?.on);
  const durHrs = p.radar?.until ? ( (Date.parse(p.radar.until)-Date.now())/3600e3 ) : null;
  req.body = { on: want, durationHours: durHrs };
  return app._router.handle(req,res, ()=>{}, "/api/painel/radar");
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
  }
);

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

// ----------------------------------------------------------------------------
// Pagamentos (stub simples)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Denúncias
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Favoritos (por cookie anônimo FAV_UID)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Admin — login novo (layout estático) + proteção/redirects
// ----------------------------------------------------------------------------

// Se não logado e tentar /admin  -> vai para /admin/login
app.get("/admin", (req,res)=>{
  if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login");
  // Se logado, ir para a versão estática do dashboard
  return res.redirect("/admin.html");
});

// Página de login Admin com o layout novo (arquivo estático)
app.get("/admin/login", (_req,res)=>{
  return res.sendFile(path.join(PUBLIC_DIR, "admin_login.html"));
});

// POST login (usuário/senha via .env; padrão admin/admin123)
// redireciona para /admin.html
app.post("/admin/login", loginLimiter, (req,res)=>{
  const user = trim(req.body?.user || req.body?.email || ""); // aceita "user" ou "email"
  const pass = String(req.body?.password || req.body?.pass || "");
  const userOk = user === (process.env.ADMIN_USER || "admin");
  let passOk = false;
  const ENV_HASH = process.env.ADMIN_PASS_HASH || "";
  if (ENV_HASH){
    try{ passOk = bcrypt.compareSync(pass, ENV_HASH); } catch{ passOk=false; }
  }else{
    const envPass = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "admin123");
    passOk = pass === envPass;
  }
  if (userOk && passOk){
    req.session.isAdmin = true;
    req.session.adminAt = Date.now();
    return res.redirect("/admin.html");
  }
  return res.status(401).send(htmlMsg("Login inválido","Usuário/senha incorretos.","/admin/login"));
});

// Logout
app.post("/admin/logout", (req,res)=>{ if (req.session) req.session.isAdmin = false; res.redirect("/admin/login"); });

// Guard leve para a página estática consultar (opcional pelo front)
app.get("/admin/guard", (req,res)=>{
  if (req.session?.isAdmin) return res.json({ ok:true });
  return res.status(401).json({ ok:false });
});

// Endpoints de métricas/exports que seu admin.html consome (respondem 401 se não logado)
function requireAdmin(req,res,next){ if (req.session?.isAdmin) return next(); return res.status(401).json({ ok:false }); }

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
    const c = (metr.call?.[d]||[]).length||0;
    const q = (metr.qr  ?.[d]||[]).length||0;
    days.push({ day:d, visits:v, calls:c, qrs:q });
  }
  return {
    ok:true,
    counters:{ total, ativos, suspensos, excluidos, verificados, mediaRating },
    last30: days
  };
}
function adminBuildList(query){
  const db = readDB().filter(p=>!p.excluido);
  const q = (query?.q||"").toString().trim();
  const cidade = (query?.cidade||"").toString().trim();
  const serv   = (query?.servico||query?.profissao||"").toString().trim();
  let items = db;
  if (q){
    const N = norm(q);
    items = items.filter(p =>
      norm(p.nome).includes(N) ||
      norm(p.bairro||"").includes(N) ||
      norm(p.cidade||"").includes(N) ||
      norm(p.servico||p.profissao||"").includes(N));
  }
  if (cidade){
    const C = norm(cidade);
    items = items.filter(p => norm(p.cidade||"").includes(C));
  }
  if (serv){
    const S = norm(serv);
    items = items.filter(p => norm(p.servico||p.profissao||"").includes(S));
  }
  items.sort((a,b)=> Number(b.id)-Number(a.id));
  return items.map(p=>({
    id:p.id, nome:p.nome, servico:p.servico||p.profissao||"",
    cidade:p.cidade||"", bairro:p.bairro||"",
    visitas:p.visitas||0, chamadas:p.chamadas||0,
    rating: (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0,
    plano:p.plano||"free", verificado:!!p.verificado,
    suspenso: !!p.suspenso, excluido: !!p.excluido,
    avalCount: Array.isArray(p.avaliacoes)? p.avaliacoes.length : 0,
    foto: p.foto || ""
  }));
}

app.get("/api/admin/metrics", requireAdmin, (_req,res)=>{
  const s = adminBuildStats();
  // Formato que o admin.html novo espera
  const verified = { yes: s.counters.verificados, no: Math.max(0, s.counters.total - s.counters.verificados) };
  const dias = s.last30.map(d=>({ date:d.day, visitas:d.visits, chamadas:d.calls, cad: d.qrs })); // "cad" usando qrs como 3a série
  res.json({
    ativos: s.counters.ativos,
    suspended: s.counters.suspensos,
    excluidos: s.counters.excluidos,
    visitas: s.last30.reduce((a,b)=>a+b.visits,0),
    chamadas: s.last30.reduce((a,b)=>a+b.calls,0),
    mediaGeral: s.counters.mediaRating,
    verified,
    timeseries: { days: dias },
    top: { servicos: [] } // pode ser alimentado depois
  });
});
app.get("/api/admin/profissionais", requireAdmin, (req,res)=>{
  const page  = Math.max(1, Number(req.query.page||1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit||20)));
  const all = adminBuildList(req.query||{});
  const total = all.length;
  const start = (page-1)*limit;
  const end   = start + limit;
  res.json({ ok:true, total, page, pages: Math.max(1, Math.ceil(total/limit)), items: all.slice(start,end) });
});
app.post("/api/admin/recompute", requireAdmin, (_req,res)=>{
  const db = readDB();
  let changed = 0;
  for(const p of db){
    const v = computeVerified(p);
    if (p.verificado !== v){ p.verificado = v; changed++; }
  }
  writeDB(db);
  res.json({ ok:true, changed });
});
app.post("/api/admin/profissionais/:id/suspender", requireAdmin, (req,res)=>{
  const id = Number(req.params.id||"0"); const motivo = trim(req.body?.motivo||"");
  const db = readDB(); const p = db.find(x=> Number(x.id)===id); if (!p) return res.status(404).json({ ok:false });
  p.suspenso = true; p.suspensoEm = nowISO(); p.suspensoMotivo = motivo;
  writeDB(db); res.json({ ok:true });
});
app.post("/api/admin/profissionais/:id/ativar", requireAdmin, (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB(); const p = db.find(x=> Number(x.id)===id); if (!p) return res.status(404).json({ ok:false });
  p.suspenso = false; p.suspensoMotivo = ""; p.suspensoEm = null;
  writeDB(db); res.json({ ok:true });
});
app.delete("/api/admin/profissionais/:id", requireAdmin, (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB(); const p = db.find(x=> Number(x.id)===id); if (!p) return res.status(404).json({ ok:false });
  p.excluido = true; p.excluidoEm = nowISO();
  writeDB(db); res.json({ ok:true });
});
app.post("/api/admin/profissionais/:id/restaurar", requireAdmin, (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB(); const p = db.find(x=> Number(x.id)===id); if (!p) return res.status(404).json({ ok:false });
  p.excluido = false; p.excluidoEm = null;
  writeDB(db); res.json({ ok:true });
});

// Exportações diversas
app.get("/api/admin/export/csv", requireAdmin, (req,res)=>{
  const q = req.query || {};
  const list = adminBuildList(q);
  const header = ["id","nome","cidade","bairro","servico","plano","verificado","suspenso","excluido","rating","visitas","chamadas","avaliacoes"].join(",");
  const rows = list.map(p=>{
    const vals = [
      p.id, p.nome, p.cidade, p.bairro, p.servico, p.plano, p.verificado, p.suspenso, p.excluido,
      Number(p.rating||0).toFixed(2), p.visitas||0, p.chamadas||0, p.avalCount||0
    ];
    return vals.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",");
  });
  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=profissionais.csv");
  res.send(csv);
});
app.get("/api/admin/export", requireAdmin, (req,res)=>{
  const what = String(req.query.what||"all");
  if (what==="metrics"){
    const metr = readJSON(METRICS_FILE, {});
    res.setHeader("Content-Type","application/json; charset=utf-8");
    return res.send(JSON.stringify(metr,null,2));
  }
  if (what==="profissionais"){
    const db = readDB();
    const header = ["id","nome","whatsapp","cidade","bairro","servico","plano","raioKm","visitas","chamadas","rating"].join(",");
    const rows = db.filter(p=>!p.excluido).map(p=>{
      const rating = (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0;
      const vals = [p.id,p.nome,p.whatsapp,p.cidade,p.bairro,(p.servico||p.profissao||""),p.plano,(p.raioKm||0),(p.visitas||0),(p.chamadas||0),rating.toFixed(2)];
      return vals.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",");
    });
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition","attachment; filename=base_profissionais.csv");
    return res.send(csv);
  }
  // default: tudo cru
  const dump = {
    profissionais: readDB(),
    denuncias: readJSON(DENUNCIAS_FILE, []),
    payments: readJSON(PAYMENTS_FILE, []),
    metrics: readJSON(METRICS_FILE, {})
  };
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.send(JSON.stringify(dump,null,2));
});

// Pagamentos últimos (para admin.html)
app.get("/api/admin/payments", requireAdmin, (req,res)=>{
  const lim = Math.max(1, Math.min(50, Number(req.query.limit||10)));
  const list = readJSON(PAYMENTS_FILE, []).slice().reverse().slice(0, lim);
  res.json(list);
});

// ----------------------------------------------------------------------------
// Inicialização do servidor
// ----------------------------------------------------------------------------
const port = BASE_PORT;
app.listen(port, HOST, ()=>{
  console.log(`Autônoma.app rodando em http://localhost:${port}`);
});
