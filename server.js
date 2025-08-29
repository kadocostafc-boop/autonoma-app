// ============================================================================
// Autônoma.app • server.js (FINAL UNIFICADO)
// Data: 2025-09-01
// - Páginas públicas + PWA + SEO
// - Admin (métricas/denúncias/export CSV)
// - Painel do Profissional (login por token/WhatsApp, Radar on/off, raio, cidades extras)
// - Busca com ranking (planos + distância + Radar)
// - Top10 semanal (visitas/chamadas/avaliações)
// - Denúncias
// - Pagamentos híbridos (stub Pix/Cartão) + taxa 4% (configurável)
// ============================================================================

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");
const crypto  = require("crypto");
const compression = require("compression");

// ----------------------------------------------------------------------------
// App base
// ----------------------------------------------------------------------------
const app = express();
app.set("trust proxy", 1);

const HOST = "0.0.0.0";
const BASE_PORT = Number(process.env.PORT || 3000);
const MAX_TRIES = 11;

// Canonical/redirects
const PRIMARY_HOST = (process.env.PRIMARY_HOST || "").trim(); // ex.: "autonomaapp.com.br"
const FORCE_HTTPS  = String(process.env.FORCE_HTTPS || "false").toLowerCase() === "true";

// Taxas/checkout (padrões; podem ir pro .env)
const FEE_CARD_PERCENT = Number(process.env.FEE_CARD_PERCENT || 4);   // % do app em cartão
const FEE_PIX_PERCENT  = Number(process.env.FEE_PIX_PERCENT  || 0);   // % do app em Pix (se quiser cobrar)
const PIX_ENABLED      = String(process.env.PIX_ENABLED || "true") === "true";
const CARD_ENABLED     = String(process.env.CARD_ENABLED || "true") === "true";

// ----------------------------------------------------------------------------
// Pastas/arquivos
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
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");   // novo (stub)
const METRICS_FILE  = path.join(DATA_DIR, "metrics.json");    // opcional

[PUBLIC_DIR, DATA_DIR, UPLOAD_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); });

function readJSON(file, fallback){ try{ return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : fallback; }catch{ return fallback; } }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }

// Inicia arquivos essenciais se faltarem
if (!fs.existsSync(DB_FILE)) writeJSON(DB_FILE, []);
if (!fs.existsSync(DENUNCIAS_FILE)) writeJSON(DENUNCIAS_FILE, []);
if (!fs.existsSync(PAYMENTS_FILE))  writeJSON(PAYMENTS_FILE, []);
if (!fs.existsSync(METRICS_FILE))   writeJSON(METRICS_FILE, {});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const trim = (s)=> (s??"").toString().trim();
const norm = (s)=> (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const escapeHTML = (s="") => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const getIP = (req)=> (req.headers["x-forwarded-for"]||"").split(",")[0].trim() || req.socket?.remoteAddress || "";
const onlyDigits = (v)=> trim(v).replace(/\D/g,"");
const ensureBR   = (d)=> (d && /^\d{10,13}$/.test(d) ? (d.startsWith("55")? d : "55"+d) : d);
const isWhatsappValid = (w)=> { const d=onlyDigits(w); const br=ensureBR(d); return !!(br && /^\d{12,13}$/.test(br)); };
const nowISO = ()=> new Date().toISOString();
const monthRefOf = (d)=> (d||nowISO()).slice(0,7); // "YYYY-MM"
const weekKey = ()=>{
  const d = new Date();
  const onejan = new Date(d.getFullYear(),0,1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay()+1)/7);
  return `${d.getFullYear()}-W${String(week).padStart(2,"0")}`;
};

// Haversine
function haversineKm(aLat, aLng, bLat, bLng){
  if (![aLat,aLng,bLat,bLng].every(Number.isFinite)) return null;
  const R=6371, toRad = d=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const lat1=toRad(aLat), lat2=toRad(bLat);
  const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

// ----------------------------------------------------------------------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "troque-isto";

// Middlewares
app.use(compression());
app.use(express.urlencoded({ extended:true }));
app.use(express.json({ limit:"1.2mb" }));

// Canonical/HTTPS
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

app.use(express.static(PUBLIC_DIR, { maxAge:"7d" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge:"30d", immutable:true }));

// Sessões (admin + painel)
app.use(session({
  name: "sess",
  secret: SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{ httpOnly:true, sameSite:"lax", secure:(process.env.SECURE_COOKIES==="true") }
}));
const painelSession = session({
  name: "painel",
  secret: SESSION_SECRET + "_painel",
  resave:false,
  saveUninitialized:false,
  cookie:{ httpOnly:true, sameSite:"lax", secure:(process.env.SECURE_COOKIES==="true") }
});
app.use(painelSession);

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
  for(const p of db){
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

    // ---- Campos novos/planos/Radar (espelha 'uber' pra compatibilidade) ----
    if(!p.plano) p.plano = "free"; // free|pro|premium
    if(typeof p.raioKm!=="number") p.raioKm = 0; // 0 = desativado no Free
    if(!Array.isArray(p.cidadesExtras)) p.cidadesExtras=[];
    // objeto 'uber' legado
    if(typeof p.uber!=="object" || p.uber==null){
      p.uber = { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef: monthRefOf() };
      changed=true;
    } else {
      if(typeof p.uber.on!=="boolean") p.uber.on=false;
      if(!("until" in p.uber)) p.uber.until=null;
      if(!("lastOnAt" in p.uber)) p.uber.lastOnAt=null;
      if(typeof p.uber.monthlyUsed!=="number") p.uber.monthlyUsed=0;
      if(!p.uber.monthRef) p.uber.monthRef = monthRefOf();
    }
    // mostrar no painel como "radar"
    if(!p.radar){
      p.radar = {
        on: !!p.uber.on,
        until: p.uber.until||null,
        lastOnAt: p.uber.lastOnAt||null,
        monthlyUsed: p.uber.monthlyUsed||0,
        monthRef: p.uber.monthRef||monthRefOf()
      };
      changed=true;
    }
    if(!p.lastPos) p.lastPos = { lat:null, lng:null, at:null };
    if(typeof p.receiveViaApp!=="boolean") p.receiveViaApp=false; // recebe pelo app?
  }
  if (changed) writeDB(db);
  console.log("✔ Base OK (ids/logs/planos/radar).");
})();

// ----------------------------------------------------------------------------
// Upload (multer)
// ----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:   (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits:{ fileSize: 3*1024*1024 },
  fileFilter: (_, file, cb) => file.mimetype?.startsWith("image/") ? cb(null,true) : cb(new Error("Apenas imagens (JPG/PNG)."))
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
// Redirects legados/canônicos de rotas
// ----------------------------------------------------------------------------
app.get(["/perfil.html","/perfil"], (req,res)=>{
  const id = Number(req.query.id||"");
  if (id) return res.redirect(301, `/profissional/${id}`);
  return res.redirect(302, "/clientes.html");
});
app.get("/clientes", (_req,res)=> res.redirect(301, "/clientes.html"));
app.get("/cadastro", (_req,res)=> res.redirect(301, "/cadastro.html"));
app.get("/admin.html", (_req,res)=> res.redirect(302, "/admin"));

// ----------------------------------------------------------------------------
// Health / Diagnóstico
// ----------------------------------------------------------------------------
app.get("/healthz", (_req,res)=> res.type("text").send("ok"));
app.get("/admin/check", (req,res)=>{
  const info = {
    session: !!(req.session && req.session.isAdmin),
    total: readDB().length,
    dataDir: DATA_DIR,
    dbFile: DB_FILE,
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
// Páginas estáticas
// ----------------------------------------------------------------------------
app.get("/", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/clientes.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "clientes.html")));
app.get("/cadastro.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "cadastro.html")));
app.get("/favoritos.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "favoritos.html")));
app.get("/cadastro_sucesso.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "cadastro_sucesso.html")));
app.get("/denunciar.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "denunciar.html")));
app.get("/top10.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "top10.html")));
app.get("/planos.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "planos.html")));
app.get("/checkout.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "checkout.html")));
app.get("/painel_login.html", (_req,res)=> res.sendFile(path.join(PUBLIC_DIR, "painel_login.html")));
app.get("/painel.html", (req,res)=>{
  // auto-login via ?token= (beta)
  const token = onlyDigits(req.query.token||"");
  if (token){
    const db = readDB();
    const pro = db.find(p => ensureBR(onlyDigits(p.whatsapp)) === ensureBR(token));
    if (pro){
      req.session.painel = { ok:true, proId: pro.id, when: Date.now() };
      return res.redirect("/painel.html");
    }
  }
  if (!(req.session && req.session.painel && req.session.painel.ok)) return res.redirect("/painel_login.html");
  res.sendFile(path.join(PUBLIC_DIR, "painel.html"));
});

// Admin HTML protegido
app.get("/admin", (req,res)=>{ if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login"); res.sendFile(path.join(PUBLIC_DIR, "admin.html")); });
app.get("/admin/login", (_req,res)=>{
  res.send(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
  <div class="wrap"><div class="card" style="max-width:420px;margin:auto">
    <div style="text-align:center;margin-bottom:10px">
      <a href="/"><img src="/img/logo.png" alt="Autônoma.app" style="height:36px" onerror="this.style.display='none'"></a>
    </div>
    <h1 class="mt-0" style="text-align:center">Admin • Entrar</h1>
    <form method="POST" action="/admin/login" style="margin-top:8px">
      <label for="user">Usuário</label>
      <input id="user" name="user" type="text" required placeholder="Seu usuário de admin" />
      <label for="password">Senha</label>
      <input id="password" type="password" name="password" required placeholder="Sua senha" />
      <div class="row" style="margin-top:10px;justify-content:center;gap:8px">
        <button class="btn" type="submit">Entrar</button>
        <a class="btn ghost" href="/">Início</a>
      </div>
      <p class="meta" style="margin-top:8px;text-align:center">Defina ADMIN_USER e ADMIN_PASS no arquivo .env</p>
    </form>
  </div></div>`);
});
app.post("/admin/login", (req,res)=>{
  const user = trim(req.body.user);
  const pass = trim(req.body.password);
  if (user === ADMIN_USER && pass === ADMIN_PASS){
    req.session.isAdmin = true;
    req.session.adminUser = user;
    return res.redirect("/admin");
  }
  res.status(401).send(htmlMsg("Falha no login","Usuário ou senha incorretos.","/admin/login"));
});
app.get("/admin/logout", (req,res)=>{ req.session.destroy(()=> res.redirect("/admin/login")); });

// ----------------------------------------------------------------------------
// GEO utils (bairros/cidades/serviços)
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
  const q = norm(input);
  if (!q) return "";
  let hit = cidades.find(c => norm(c) === q);
  if (hit) return hit;
  hit = cidades.find(c => norm(c.split("/")[0]) === q);
  if (hit) return hit;
  hit = cidades.find(c => norm(c).startsWith(q) || norm(c.split("/")[0]).startsWith(q));
  if (hit) return hit;
  hit = cidades.find(c => norm(c).includes(q));
  return hit || input;
}
function getBairrosForCity(bairrosMap, cidadeEntrada){
  if (!cidadeEntrada) return [];
  const want = norm(cidadeEntrada);
  for (const k of Object.keys(bairrosMap)){
    if (norm(k) === want) return Array.isArray(bairrosMap[k]) ? bairrosMap[k] : [];
  }
  const cityOnly = norm(cidadeEntrada.split("/")[0]);
  for (const k of Object.keys(bairrosMap)){
    if (norm(k.split("/")[0]) === cityOnly) return Array.isArray(bairrosMap[k]) ? bairrosMap[k] : [];
  }
  for (const k of Object.keys(bairrosMap)){
    if (norm(k).includes(cityOnly)) return Array.isArray(bairrosMap[k]) ? bairrosMap[k] : [];
  }
  return [];
}

// GEO APIs
app.get("/api/geo/cidades", (_req,res)=>{ const { cidades } = loadGeoMaps(); res.json(cidades); });
app.get("/api/geo/cidades/suggest", (req,res)=>{
  const q = trim(req.query.q||""); if (!q) return res.json([]);
  const { cidades } = loadGeoMaps(); const qn = norm(q);
  const list = cidades.map(c=>({ val:c, n:norm(c) }));
  const starts = list.filter(x=> x.n.startsWith(qn) || x.n.split("/")[0].startsWith(qn));
  const contains = list.filter(x=> x.n.includes(qn) && !(x.n.startsWith(qn) || x.n.split("/")[0].startsWith(qn)));
  res.json([...starts, ...contains].slice(0,10).map(x=>x.val));
});
app.get("/api/geo/bairros", (req,res)=>{
  const { bairrosMap } = loadGeoMaps();
  const cidade = trim(req.query.cidade||"");
  if (!cidade) return res.json([]);
  const cidadeUF = normalizeCidadeUF(cidade);
  res.json(getBairrosForCity(bairrosMap, cidadeUF));
});
app.get("/api/geo/bairros/suggest", (req,res)=>{
  const cidade = trim(req.query.cidade||"");
  const q = trim(req.query.q||"");
  if (!cidade || !q) return res.json([]);
  const { bairrosMap } = loadGeoMaps();
  const cidadeUF = normalizeCidadeUF(cidade);
  const lista = getBairrosForCity(bairrosMap, cidadeUF);
  const qn = norm(q);
  const arr = (Array.isArray(lista)?lista:[]).map(b=>({ b, n:norm(b) }));
  const starts = arr.filter(x=> x.n.startsWith(qn));
  const contains = arr.filter(x=> x.n.includes(qn) && !x.n.startsWith(qn));
  res.json([...starts, ...contains].slice(0,10).map(x=>x.b));
});
app.get("/api/geo/servicos", (_req,res)=>{ const { servicos } = loadGeoMaps(); res.json(servicos); });
app.get("/api/geo/servicos/suggest", (req,res)=>{
  const q = trim(req.query.q||""); if (!q) return res.json([]);
  const { servicos } = loadGeoMaps(); const qn = norm(q);
  const arr = (Array.isArray(servicos)?servicos:[]).map(s=>({ s, n:norm(s) }));
  const starts = arr.filter(x=> x.n.startsWith(qn));
  const contains = arr.filter(x=> x.n.includes(qn) && !x.n.startsWith(qn));
  res.json([...starts, ...contains].slice(0,10).map(x=>x.s));
});
app.get("/api/geo/closest-city", (req,res)=>{
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.json({ ok:false, error:"lat/lng inválidos" });
  const db = readDB().filter(p=>!p.suspenso && !p.excluido);
  const byCity = new Map();
  db.forEach(p=>{
    if (!p.cidade) return;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const list = byCity.get(p.cidade) || [];
    list.push({ lat:p.lat, lng:p.lng });
    byCity.set(p.cidade, list);
  });
  let best=null, bestAvg=Infinity;
  for (const [cidade, list] of byCity){
    if (!list.length) continue;
    const avg = list.reduce((acc,pt)=> acc + (haversineKm(lat,lng,pt.lat,pt.lng)||9999),0)/list.length;
    if (avg < bestAvg){ bestAvg=avg; best=cidade; }
  }
  if (!best) return res.json({ ok:false });
  res.json({ ok:true, cidade: normalizeCidadeUF(best) || best });
});

// ----------------------------------------------------------------------------
// Cadastro
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
  return { ok: e.length===0, errors:e, values:{
    nome, email, telefone, whatsapp, cidade, bairro,
    servico, profissao,
    experiencia: trim(body.experiencia),
    precoBase: trim(body.precoBase),
    site: trim(body.site),
    endereco: trim(body.endereco),
    descricao: trim(body.descricao),
    lat: lat==null? undefined : lat,
    lng: lng==null? undefined : lng
  }};
}
function isDuplicate(db, novo){
  return db.some(p => p.whatsapp===novo.whatsapp && norm(p.cidade)===norm(novo.cidade) && norm(p.bairro)===norm(novo.bairro) && !p.excluido);
}

app.post("/cadastrar",
  (req,res,next)=> upload.single("foto")(req,res,(err)=> { if (err) return res.status(400).send(htmlMsg("Erro no upload", err.message, "/cadastro.html")); next(); }),
  (req,res)=>{
    try{
      const { ok, errors, values } = validateCadastro(req.body);
      if (!ok) return res.status(400).send(htmlErrors("Dados inválidos", errors, "/cadastro.html"));
      const db = readDB();
      if (isDuplicate(db, values)){
        return res.status(400).send(htmlMsg("Cadastro duplicado","Já existe um profissional com o mesmo WhatsApp neste bairro/cidade.","/cadastro.html"));
      }
      const foto = (req.file?.filename) ? `/uploads/${req.file.filename}` : "";
      const novo = {
        id: db.length ? db[db.length-1].id + 1 : 1,
        createdAt: nowISO(),
        ...values,
        foto,
        atendimentos: 0,
        avaliacoes: [],
        visitas: 0,
        chamadas: 0,
        visitsLog: [],
        callsLog: [],
        qrLog: [],
        suspenso: false,
        suspensoMotivo: "",
        suspensoEm: null,
        excluido: false,
        excluidoEm: null,
        plano: "free",
        raioKm: 0,
        cidadesExtras: [],
        uber: { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:monthRefOf() },
        radar: { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:monthRefOf() },
        lastPos: { lat:null, lng:null, at:null },
        receiveViaApp: false
      };
      novo.verificado = computeVerified(novo);
      db.push(novo);
      writeDB(db);
      req.session.lastCreatedProId = novo.id;
      res.redirect(`/profissional/${novo.id}`);
    } catch(err){
      res.status(500).send(htmlMsg("Erro", err.message||String(err), "/cadastro.html"));
    }
  }
);

// ----------------------------------------------------------------------------
// Busca pública de profissionais (com Radar/raio)
// ----------------------------------------------------------------------------
function isRecent(iso, mins=15){
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= (mins*60*1000);
}
function proLimits(p){
  if (p.plano==="premium") return { maxRaio:50, maxCidades:10, uberUnlimited:true, maxUberActivations:Infinity };
  if (p.plano==="pro")     return { maxRaio:30, maxCidades:3,  uberUnlimited:false, maxUberActivations:5 };
  return { maxRaio:0, maxCidades:0, uberUnlimited:false, maxUberActivations:0 };
}

app.get("/api/profissionais", (req,res)=>{
  const {
    q="", cidade="", bairro="", servico="",
    sort="score", dir="desc",
    minRating="", onlyVerified="", experienciaMin="",
    userLat="", userLng=""
  } = req.query;

  let page  = parseInt(req.query.page||"1",10);
  let limit = parseInt(req.query.limit||"20",10);
  if (!Number.isFinite(page) || page<1) page = 1;
  if (!Number.isFinite(limit) || limit<1 || limit>100) limit = 20;
  const uLat = userLat==="" ? null : Number(userLat);
  const uLng = userLng==="" ? null : Number(userLng);
  const hasUserPos = Number.isFinite(uLat) && Number.isFinite(uLng);

  const dbRaw = readDB().filter(p=>!p.suspenso && !p.excluido);
  const qn = norm(q), cn = norm(cidade), bn = norm(bairro), sn = norm(servico);

  let list = dbRaw.filter(p=>{
    const nome = norm(p.nome), prof = norm(p.profissao), cat = norm(p.servico), cid = norm(p.cidade), bai = norm(p.bairro);
    const okQ = qn ? (nome.includes(qn)||prof.includes(qn)||cat.includes(qn)) : true;
    const okServ = sn ? cat.includes(sn) : true;

    // Local: se usuário escolhe texto cidade/bairro, respeitamos filtro textual
    let okLocal = true;
    if (cn || bn){
      okLocal = cid.includes(cn) && (bn ? bai.includes(bn) : true);
    }

    return okQ && okServ && okLocal;
  });

  // Enriquecimento: rating + distância + boosts de plano/radar
  list = list.map(p=>{
    const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
    const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;

    let dist = null;
    let refLat = null, refLng = null;
    const radarAtivo = (p.radar?.on || p.uber?.on) && isRecent((p.radar?.lastOnAt||p.uber?.lastOnAt), 15) &&
                       Number.isFinite(p.lastPos?.lat) && Number.isFinite(p.lastPos?.lng);
    if (hasUserPos){
      if (radarAtivo){ refLat = p.lastPos.lat; refLng = p.lastPos.lng; }
      else if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) { refLat = p.lat; refLng = p.lng; }
      if (refLat!=null && refLng!=null) dist = haversineKm(uLat,uLng,refLat,refLng);
    }

    // score base: rating + atendimentos + verificado + plano + radar + distância
    const base = (rating*2) + (p.atendimentos||0)*0.02 + (p.verificado?0.5:0);
    const wPlano = p.plano==="premium" ? 1.2 : p.plano==="pro" ? 1.1 : 1.0;
    const wRadar = radarAtivo ? 1.25 : 1.0;
    let wDist = 1.0;
    if (dist!=null) {
      if (dist<=2) wDist = 1.25;
      else if (dist<=5) wDist = 1.15;
      else if (dist<=10) wDist = 1.05;
      else if (dist<=20) wDist = 0.95;
      else wDist = 0.9;
    }
    const score = base * wPlano * wRadar * wDist;

    return { ...p, rating, distanceKm: dist, score };
  });

  // Filtros extras
  const mR = Number(minRating);
  if (Number.isFinite(mR) && mR>=1 && mR<=5){ list = list.filter(p => (p.rating||0) >= mR); }
  if (String(onlyVerified)==="true"){ list = list.filter(p => !!p.verificado); }
  const eMin = Number(experienciaMin);
  if (Number.isFinite(eMin) && eMin>0){
    list = list.filter(p => {
      const num = Number(String(p.experiencia||"").replace(/\D/g,""));
      return Number.isFinite(num) ? num>=eMin : true;
    });
  }

  // Ordenação
  const dirMul = (String(dir).toLowerCase()==="asc") ? 1 : -1;
  list.sort((a,b)=>{
    if (sort==="distance" && a.distanceKm!=null && b.distanceKm!=null){
      return dirMul * ((a.distanceKm)-(b.distanceKm));
    }
    // default: score
    return dirMul * ((a.score||0)-(b.score||0));
  });

  const total = list.length;
  const start = (page-1)*limit;
  const end   = start+limit;
  res.json({
    total, page, limit,
    items: list.slice(start,end).map(p => ({
      id:p.id, nome:p.nome, foto:p.foto||"",
      servico:p.servico||p.profissao||"",
      cidade:p.cidade||"", bairro:p.bairro||"",
      rating:p.rating||0, avaliacoes: (p.avaliacoes||[]).length,
      atendimentos: p.atendimentos||0,
      distanceKm: p.distanceKm,
      verificado: !!p.verificado,
      plano: p.plano||"free",
      badge: p.plano==="premium"?"PREMIUM":(p.plano==="pro"?"PRO":"")
    }))
  });
});

// Perfil JSON (usado por perfil.html)
app.get("/api/profissional/:id", (req,res)=>{
  const id = Number(req.params.id||"0");
  const db = readDB();
  const p = db.find(x=> Number(x.id)===id && !x.excluido);
  if (!p) return res.status(404).json({ ok:false });
  const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
  const rating = notas.length ? notas.reduce((a,b)=>a+b,0)/notas.length : 0;
  res.json({
    id:p.id, nome:p.nome, foto:p.foto||"", servico:p.servico||p.profissao||"",
    cidade:p.cidade||"", bairro:p.bairro||"", descricao:p.descricao||"",
    whatsapp:p.whatsapp||"", site:p.site||"",
    atendimentos:p.atendimentos||0,
    avaliacoes:p.avaliacoes||[],
    rating,
    verificado: !!p.verificado,
    suspenso: !!p.suspenso,
    plano: p.plano||"free",
    badge: p.plano==="premium"?"PREMIUM":(p.plano==="pro"?"PRO":""),
    canEvaluate: true
  });
});

// POST avaliação (form <perfil>)
app.post("/profissional/:id/avaliar", (req,res)=>{
  const id = Number(req.params.id||"0");
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

// SSR leve /profissional/:id (redireciona ao perfil.html)
app.get("/profissional/:id", (req,res)=>{
const idNum = Number(id || "0");
if (!Number.isFinite(idNum) || idNum <= 0) return res.redirect("/clientes.html");
return res.redirect(`/perfil.html?id=${idNum}`);
});

// ----------------------------------------------------------------------------
// Métricas/Tracking (visita, call, QR)
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
    arr.push({ id: arr.length? arr[arr.length-1].id+1 : 1, proId, motivo, detalhes, at: nowISO(), ip:getIP(req), resolved:false });
    writeJSON(DENUNCIAS_FILE, arr);
    appendMetric("report", { proId, at: nowISO() });
    res.json({ ok:true });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// ----------------------------------------------------------------------------
// Top 10 semanal (API)
// ----------------------------------------------------------------------------
function scoreTop10(p){
  const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
  const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length) : 0;
  const calls = (p.callsLog||[]).filter(x => weekKey()===(new Date(x.at)).toISOString().slice(0,4)+"-W"+String(Math.ceil((((new Date(x.at))-new Date((new Date(x.at)).getFullYear(),0,1))/86400000 + new Date((new Date(x.at)).getFullYear(),0,1).getDay()+1)/7)).padStart(2,"0")).length;
  const visits = (p.visitsLog||[]).filter(x => (new Date(x.at)).toISOString().slice(0,10) >= (new Date(Date.now()-6*86400000)).toISOString().slice(0,10)).length;
  return (calls*2) + (visits*0.5) + (rating*3) + (p.verificado?0.5:0) + (p.plano==="premium"?1:(p.plano==="pro"?0.5:0));
}

app.get("/api/top10", (req,res)=>{
  const cidade = norm(trim(req.query.cidade||""));
  const serv = norm(trim(req.query.servico||""));
  const db = readDB().filter(p=>!p.suspenso && !p.excluido);
  let list = db;
  if (cidade) list = list.filter(p => norm(p.cidade).includes(cidade));
  if (serv)   list = list.filter(p => norm(p.servico||p.profissao).includes(serv));
  list = list.map(p => ({ ...p, topScore: scoreTop10(p) }))
             .sort((a,b)=> (b.topScore)-(a.topScore))
             .slice(0,10)
             .map(p => ({
               id:p.id, nome:p.nome, foto:p.foto||"",
               servico:p.servico||p.profissao||"", cidade:p.cidade||"", bairro:p.bairro||"",
               atendimentos:p.atendimentos||0,
               rating: (p.avaliacoes||[]).length ? (p.avaliacoes.reduce((a,c)=>a+Number(c.nota||0),0)/(p.avaliacoes.length)) : 0,
               badge: p.plano==="premium"?"PREMIUM":(p.plano==="pro"?"PRO":"")
             }));
  res.json({ ok:true, week: weekKey(), items:list });
});

// ----------------------------------------------------------------------------
// Painel do Profissional — Sessão/Estado/Login
// ----------------------------------------------------------------------------
app.get("/api/painel/state", (req,res)=>{
  const s = (req.session && req.session.painel) ? req.session.painel : null;
  if (!s || !s.ok || !s.proId) return res.json({ ok:false });
  const db = readDB();
  const p = db.find(x=> Number(x.id)===Number(s.proId));
  if (!p) return res.json({ ok:false });
  res.json({ ok:true, pro:{ id:p.id, nome:p.nome, plano:p.plano, raioKm:p.raioKm, cidadesExtras:p.cidadesExtras||[], radar:p.radar||p.uber||{}, receiveViaApp: !!p.receiveViaApp } });
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

// Atualiza posição em tempo real (Radar)
app.post("/api/painel/pos", (req,res)=>{
  const s = req.session?.painel;
  if (!s?.ok || !s?.proId) return res.status(401).json({ ok:false });
  const { lat, lng } = req.body || {};
  const latN = Number(lat), lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return res.status(400).json({ ok:false, error:"lat/lng" });
  const db = readDB();
  const p = db.find(x=> Number(x.id)===s.proId);
  if (!p) return res.status(404).json({ ok:false });
  p.lastPos = { lat: latN, lng: lngN, at: nowISO() };
  writeDB(db);
  res.json({ ok:true });
});

// Liga/desliga Radar e timers (inclui auto-off)
app.post("/api/painel/radar", (req,res)=>{
  const s = req.session?.painel;
  if (!s?.ok || !s?.proId) return res.status(401).json({ ok:false });
  const { on, durationHours } = req.body || {};
  const db = readDB();
  const p = db.find(x=> Number(x.id)===s.proId);
  if (!p) return res.status(404).json({ ok:false });

  // reset mensal
  const nowRef = monthRefOf();
  if ((p.radar?.monthRef||p.uber?.monthRef) !== nowRef){
    p.radar.monthRef = nowRef; p.radar.monthlyUsed = 0;
    if (p.uber){ p.uber.monthRef = nowRef; p.uber.monthlyUsed = 0; }
  }

  const lim = proLimits(p);
  p.radar ||= { on:false, until:null, lastOnAt:null, monthlyUsed:0, monthRef:nowRef };
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
    p.radar.on = false;
    p.radar.until = null;
  }
  writeDB(db);
  res.json({ ok:true, radar:p.radar });
});

// Ajustes de plano/raio/cidades extras/receber pelo app
app.post("/api/painel/settings", (req,res)=>{
  const s = req.session?.painel;
  if (!s?.ok || !s?.proId) return res.status(401).json({ ok:false });
  const db = readDB();
  const p = db.find(x=> Number(x.id)===s.proId);
  if (!p) return res.status(404).json({ ok:false });

  let { raioKm, cidadesExtras, receiveViaApp } = req.body||{};
  const lim = proLimits(p);
  // raio
  if (raioKm!=null){
    const r = Number(raioKm);
    if (Number.isFinite(r) && r>=0){
      p.raioKm = Math.min(r, lim.maxRaio);
    }
  }
  // cidades extras
  if (Array.isArray(cidadesExtras)){
    const clean = cidadesExtras.map(c=> normalizeCidadeUF(String(c||""))).filter(Boolean);
    p.cidadesExtras = clean.slice(0, lim.maxCidades);
  }
  // receber pelo app?
  if (typeof receiveViaApp === "boolean") p.receiveViaApp = receiveViaApp;

  writeDB(db);
  res.json({ ok:true, pro:{ id:p.id, plano:p.plano, raioKm:p.raioKm, cidadesExtras:p.cidadesExtras, receiveViaApp:p.receiveViaApp } });
});

// ----------------------------------------------------------------------------
// Checkout/Pagamentos (STUB) — Pix/Cartão + taxas
// ----------------------------------------------------------------------------
function newPaymentId(){ return crypto.randomBytes(10).toString("hex"); }

app.get("/api/checkout/options", (_req,res)=>{
  res.json({
    ok:true,
    pix: PIX_ENABLED, card: CARD_ENABLED,
    fees: { cardPercent:FEE_CARD_PERCENT, pixPercent:FEE_PIX_PERCENT }
  });
});

// cria intenção de pagamento
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
    const pay = {
      pid: newPaymentId(),
      proId: id,
      method: m,
      amount: amt,
      feesPercent,
      appFee,
      toPro,
      status: "pending",
      createdAt: nowISO()
    };
    store.push(pay);
    writeJSON(PAYMENTS_FILE, store);
    res.json({ ok:true, payment: pay });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// simula confirmação (apenas DEV/BETA)
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

// dados do pagamento
app.get("/api/checkout/payment/:pid", (req,res)=>{
  const pid = String(req.params.pid||"");
  const store = readJSON(PAYMENTS_FILE, []);
  const it = store.find(x=> x.pid===pid);
  if (!it) return res.status(404).json({ ok:false });
  res.json({ ok:true, payment:it });
});

// link direto de checkout por profissional
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
// Admin APIs (protetas)
// ----------------------------------------------------------------------------
function requireAdmin(req,res,next){ if (req.session?.isAdmin) return next(); return res.status(401).json({ ok:false }); }

app.get("/api/admin/denuncias", requireAdmin, (_req,res)=> res.json(readJSON(DENUNCIAS_FILE, [])));

app.post("/api/admin/denuncias/:id/resolve", requireAdmin, (req,res)=>{
  const id = Number(req.params.id||"0");
  const arr = readJSON(DENUNCIAS_FILE, []);
  const it = arr.find(x=> Number(x.id)===id);
  if (!it) return res.status(404).json({ ok:false });
  it.resolved = true; it.resolvedAt = nowISO();
  writeJSON(DENUNCIAS_FILE, arr);
  res.json({ ok:true });
});

app.get("/admin/export.csv", requireAdmin, (_req,res)=>{
  const db = readDB();
  const header = ["id","nome","whatsapp","cidade","bairro","servico","profissao","plano","raioKm","atendimentos","visitas","chamadas","rating"].join(",");
  const lines = db.map(p=>{
    const notas = (p.avaliacoes||[]).map(a=>Number(a.nota)).filter(n=>n>=1&&n<=5);
    const rating = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(2) : "0";
    return [p.id, `"${(p.nome||"").replace(/"/g,'""')}"`, `"${p.whatsapp||""}"`,
      `"${(p.cidade||"").replace(/"/g,'""')}"`, `"${(p.bairro||"").replace(/"/g,'""')}"`,
      `"${(p.servico||"").replace(/"/g,'""')}"`, `"${(p.profissao||"").replace(/"/g,'""')}"`,
      p.plano||"free", p.raioKm||0, p.atendimentos||0, p.visitas||0, p.chamadas||0, rating
    ].join(",");
  });
  const csv = [header, ...lines].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition","attachment; filename=profissionais.csv");
  res.send(csv);
});

// ----------------------------------------------------------------------------
// CRON leve: auto-desligar Radar quando 'until' expirar (a cada request)
// ----------------------------------------------------------------------------
app.use((req,_res,next)=>{
  try{
    const db = readDB();
    let changed=false;
    const now = Date.now();
    for(const p of db){
      if (p?.radar?.on && p.radar.until){
        const t = Date.parse(p.radar.until);
        if (Number.isFinite(t) && now > t){
          p.radar.on = false; p.radar.until = null; changed=true;
        }
      }
      // reset mensal
      const ref = monthRefOf();
      if (p?.radar && p.radar.monthRef !== ref){ p.radar.monthRef=ref; p.radar.monthlyUsed=0; changed=true; }
    }
    if (changed) writeDB(db);
  }catch{}
  next();
});

// ----------------------------------------------------------------------------
// Inicialização (porta dinâmica 3000..3010)
// ----------------------------------------------------------------------------
function listenTry(port, tries){
  const server = app.listen(port, HOST, ()=>{
    console.log(`✅ Autônoma.app rodando em http://localhost:${port}  (PID ${process.pid})`);
  });
  server.on("error", (err)=>{
    if (tries>0){
      const nextP = port+1;
      console.log(`Porta ${port} ocupada. Tentando ${nextP}...`);
      listenTry(nextP, tries-1);
    }else{
      console.error("Falha ao abrir porta:", err);
      process.exit(1);
    }
  });
}
listenTry(BASE_PORT, MAX_TRIES);