// Autônoma.app • server.js
// Data base: 2025-09-11
// - Páginas públicas + PWA + SEO
// - Admin (login obrigatório) + export CSV + métricas/gráficos (endpoints JSON)
// - Painel do Profissional (login via token WhatsApp, Radar on/off, raio, cidades extras)
// - Busca com ranking (planos + distância + Radar)
// - Perfil público (/perfil.html?id=... e /profissional/:id)
// - Página Avaliar: GET /avaliar/:id (POST também em /profissional/:id/avaliar)
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

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const session = require("express-session");


const QRCode = require("qrcode");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const SibApiV3Sdk = require("sib-api-v3-sdk")
// const { PrismaClient } = require('@prisma/client');
// const prisma = new PrismaClient();

// ====== [ AUTONOMA • Helpers de Arquivo/Texto ] ======
// Pastas/arquivos base

function slugify(str='') {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}
function titleCase(str='') {
  return String(str).toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
}

// Hash seguro de senha com scrypt (usa seu crypto já importado)
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Função genérica para envio de e-mails
async function sendEmail(to, subject, text) {
  try {
    if (process.env.SMTP_DISABLED === "true") {
      // Usar a API da Brevo
      let defaultClient = SibApiV3Sdk.ApiClient.instance;
      let apiKey = defaultClient.authentications["api-key"];
      apiKey.apiKey = process.env.BREVO_API_KEY;

      let apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
      let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

      const senderEmailMatch = (process.env.SMTP_FROM || "").match(/<(.*)>/);
      const senderEmail = senderEmailMatch ? senderEmailMatch[1] : process.env.SMTP_FROM;
      const senderName = (process.env.SMTP_FROM || "").includes("<") ? process.env.SMTP_FROM.split("<")[0].trim() : "Autônoma.app";
      sendSmtpEmail.sender = { email: senderEmail, name: senderName };
      sendSmtpEmail.to = [{ email: to }];
      sendSmtpEmail.subject = subject;
      sendSmtpEmail.textContent = text;

      await apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log("E-mail enviado via Brevo API.");
      return true;
    } else {
      // Usar nodemailer para SMTP direto
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_SECURE === "true", // true para 465, false para 587
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || `Autônoma.app <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
      });
      console.log("E-mail enviado via SMTP.");
      return true;
    }
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    return false;
  }
}

const app = express();
app.use(express.json());
app.set("trust proxy", true);

// Configuração da Sessão
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    // Força Secure e SameSite=None em produção (Railway) para que o cookie persista
    secure: true,
    sameSite: "None",
    httpOnly: true,
    // CORREÇÃO FINAL: Especificar o domínio para garantir a persistência entre subdomínios/rotas
    domain: process.env.COOKIE_DOMAIN || '.autonomaapp.com.br',
  }
}));

// Middleware de autenticação (usando req.session.painel.proId)
function requireProAuth(req, res, next) {
  if (!req.session || !req.session.painel?.ok) {
    // 1. Salva a URL original para redirecionar após o login
    req.session.redirectTo = req.originalUrl;
    // 2. Redireciona para a página de login
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }
    return res.redirect('/painel_login.html'); // Redireciona páginas HTML
  }
  // Se autenticado, continua
  next();
}

// === Boot básico / deps ===
// ==== Healthcheck deve responder SEM redirecionar ====
app.get('/health', (_req, res) => res.type('text').send('ok'));
app.head('/health', (_req, res) => res.type('text').send('ok')); // extra segurança
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.head('/healthz', (_req, res) => res.type('text').send('ok'));

// =============[ Esqueci minha senha • POST /auth/pro/forgot ]=============
const RESET_DIR = path.join(process.env.DATA_DIR || "./data", "reset");
const RESET_DB  = path.join(RESET_DIR, "tokens.json");

// util: carrega/salva JSON simples
function loadJSONSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function saveJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// util: base URL (Railway/produção) para montar o link
function baseUrlFrom(req) {
  const envUrl = process.env.BASE_URL && String(process.env.BASE_URL).trim();
  if (envUrl) return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  const host = process.env.PRIMARY_HOST || req.headers.host || "";
  const proto = (process.env.FORCE_HTTPS === "true" || req.headers["x-forwarded-proto"] === "https") ? "https" : "http";
  return `${proto}://${host.replace(/^https?:\/\//, "")}`;
}

// util: valida e-mail
function isEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim()); }

// ROTA: solicita link de redefinição
app.post("/auth/pro/forgot", async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "").trim(); // aqui só aceitamos e-mail
    if (!isEmail(identifier)) {
      return res.status(400).json({ ok:false, error: "Digite um e-mail válido." });
    }

    const users = readJSON(DB_FILE, []);
    const user = users.find(u => u.email === identifier);
    if (!user) {
      return res.status(400).json({ ok:false, error: "E-mail não encontrado." });
    }

    // 1) gera token com expiração (2 horas)
    const token = crypto.randomBytes(24).toString("hex");
    const exp   = Date.now() + 2 * 60 * 60 * 1000; // +2h

    // 2) grava token no "banco" simples em disco
    const db = loadJSONSafe(RESET_DB);
    // limpeza básica de tokens expirados
    for (const [t, info] of Object.entries(db)) {
      if (!info?.exp || Date.now() > Number(info.exp)) delete db[t];
    }
    db[token] = { email: identifier, exp, userId: user.id };
    saveJSON(RESET_DB, db);

    // 3) monta link
    const url = `${baseUrlFrom(req)}/reset?token=${encodeURIComponent(token)}`;

    // 4) envia e-mail (usa seu helper sendMail)
    const subject = "Redefinir sua senha • Autônoma.app";
    const text =
`Olá!

Recebemos uma solicitação para redefinir sua senha no Autônoma.app.

Para continuar, acesse o link abaixo (válido por 2 horas):
${url}

Se você não fez essa solicitação, ignore este e-mail.

— Autônoma.app`;

    // -> IMPORTANTE: este helper precisa existir (você já criou acima)
    const ok = await sendEmail(identifier, subject, text);

    if (!ok) {
      return res.status(500).json({ ok:false, error:"Não foi possível enviar o e-mail. Tente novamente." });
    }

    // 5) resposta: em produção retornamos apenas ok; no dev, também retornamos o link
    const isDev = process.env.NODE_ENV !== "production";
    return res.json({ ok:true, ...(isDev ? { resetUrl: url } : {}) });

  } catch (err) {
    console.error("[forgot] erro:", err);
    return res.status(500).json({ ok:false, error:"Erro interno." });
  }
});
// =============[ Redefinir senha • POST /auth/pro/reset ]=============
app.post("/auth/pro/reset", async (req, res) => {
  const { token, senha } = req.body;
  if (!token || !senha) {
    return res.status(400).json({ ok: false, error: "Token e nova senha obrigatórios" });
  }

  const db = loadJSONSafe(RESET_DB);
  const resetInfo = db[token];
  const users = readJSON(DB_FILE, []);
  if (!resetInfo || resetInfo.exp < Date.now()) {
    return res.status(400).json({ ok: false, error: "Token inválido ou expirado" });
  }

  const user = users.find(u => u.id === resetInfo.userId);
  if (!user) {
    return res.status(400).json({ ok: false, error: "Token inválido ou expirado" });
  }

  // Hash da nova senha
  const bcrypt = require("bcryptjs");
   const hashedPassword = await bcrypt.hash(senha, 10);
  user.senha = hashedPassword;
 
  delete db[token];
  saveJSON(RESET_DB, db);
  
  writeJSON(DB_FILE, users);

  res.json({ ok: true, message: "Senha redefinida com sucesso" });
});
// ===== Rotas do Painel do Profissional (Protegidas) =====
// Rota /painel é protegida, redireciona para o painel.html (que também é protegido)
app.get(['/painel', '/pa'], requireProAuth, (_req, res) => {
  res.redirect(302, '/painel.html');
});

// Rota de Pagamento (Protegida)
app.get("/painel/pagamento", requireProAuth, (req, res) => {
  const plano = req.query.plano;
  
  // Se houver o parâmetro 'plano', serve a página de checkout de assinatura
  if (plano === 'pro' || plano === 'premium') {
    return res.sendFile(path.join(PUBLIC_DIR, "checkout-assinatura.html"));
  }
  
  // Caso contrário, serve a página de checkout padrão (para clientes pagando por serviço)
  res.sendFile(path.join(PUBLIC_DIR, "checkout.html"));
});
// ===== Forçar HTTPS e controlar redirects (exceto /health e /healthz) =====
const PRIMARY_HOST = String(process.env.PRIMARY_HOST || '')
  .replace(/^https?:\/\//, '')   // remove protocolo
  .replace(/\/.*$/, '');         // remove caminho

const FORCE_HTTPS        = String(process.env.FORCE_HTTPS        || 'false').toLowerCase() === 'true';
const REDIRECTS_DISABLED = String(process.env.REDIRECTS_DISABLED || 'false').toLowerCase() === 'true';
const SECURE_COOKIES     = String(process.env.SECURE_COOKIES     || 'false').toLowerCase() === 'true';

// Middleware ÚNICO de canonical + HTTPS (nunca mexe em /health ou /healthz)
if (!REDIRECTS_DISABLED) {
  app.use((req, res, next) => {
    const p = req.path;
    if (p === '/health' || p === '/healthz') return next();

    const hostNow = (req.headers.host || '').toLowerCase();
    const isHttps = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';

    // Canonical host
    if (PRIMARY_HOST && hostNow && hostNow !== PRIMARY_HOST.toLowerCase()) {
      const scheme = (FORCE_HTTPS || isHttps) ? 'https' : 'http';
      return res.redirect(301, `${scheme}://${PRIMARY_HOST}${req.originalUrl}`);
    }

    // Força HTTPS
    if (FORCE_HTTPS && !isHttps) {
      const host = hostNow || PRIMARY_HOST || 'localhost';
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }

    next();
  });
}
// ========== Helpers (único) ==========
const trim = (s) => (s ?? "").toString().trim();

const norm = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getIP = (req) =>
  (req.headers["x-forwarded-for"] || "")
    .toString()
    .split(",")[0]
    .trim() ||
  req.socket?.remoteAddress ||
  "";

// dígitos e telefone BR
const onlyDigits = (v) => trim(v).replace(/\D/g, "");
const ensureBR = (d) =>
  d && /^\d{10,13}$/.test(d) ? (d.startsWith("55") ? d : "55" + d) : d;

const isWhatsappValid = (w) => {
  const d = onlyDigits(w);
  const br = ensureBR(d);
  return !!(br && /^\d{12,13}$/.test(br));
};

// datas / período
const nowISO = () => new Date().toISOString();
const monthRefOf = (d) => (d || nowISO()).slice(0, 7); // "YYYY-MM"
function weekKey() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const day = Math.floor((d - onejan) / 86400000);
  const week = Math.ceil((day + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// distância haversine em KM
function haversineKm(aLat, aLng, bLat, bLng) {
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null;
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat),
    dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat),
    lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// frase padrão para contato por WhatsApp
function buildWaMessage(p) {
  const nome = p?.nome ? ` ${p.nome}` : "";
  const serv = p?.servico || p?.profissao || "seu serviço";
  const loc  = [p?.bairro, p?.cidade].filter(Boolean).join(" - ");
  const sufixo = loc ? ` (${loc})` : "";
  return `Olá${nome}, vi seu perfil na Autônoma.app${sufixo} e gostaria de saber mais sobre ${serv}.`;
}

// util do Asaas (quando o backend enviar telefone cru)
function toBRWith55(raw) {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d; // mantém como veio se fugir do esperado
}
// ========== /Helpers ==========
// ---- Helpers usados no Asaas ----
function toBRWith55(raw) {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d; // DDD + número
  return d;
}

// ===========================[ Rota: criar cliente no Asaas ]===========================
app.post('/api/pay/asaas/customer', express.json(), async (req, res) => {
  try {
    const { name, email, mobilePhone, cpfCnpj, proId } = req.body;
    // ...
    if (!name || !email) {
      return res.status(400).json({ ok:false, error:'name e email são obrigatórios' });
    }

    const payload = {
      name,
      email,
      mobilePhone: toBRWith55(mobilePhone || ""),
      cpfCnpj: cpfCnpj ? onlyDigits(cpfCnpj) : undefined
    };

    const customer = await asaasRequest('/customers', {
      method:'POST',
      body: JSON.stringify(payload)
    });

    // Se o caller informar proId, persistimos no JSON
    if (proId) {
      try {
        // carrega seu banco JSON
        const dbPath = DATA_FILE; // você já tem const DATA_FILE no seu server.js
        const raw = fs.existsSync(dbPath) ? fs.readFileSync(dbPath,'utf8') : '{"profissionais":[]}' ;
        const json = raw ? JSON.parse(raw) : { profissionais: [] };

        const idx = (json.profissionais||[]).findIndex(p => String(p.id) === String(proId));
        if (idx >= 0) {
          json.profissionais[idx].asaasCustomerId = customer.id;
          fs.writeFileSync(dbPath, JSON.stringify(json, null, 2));
        }
      } catch (e) {
        console.error('[Asaas][persist] falha ao salvar asaasCustomerId:', e.message);
        // não bloqueia a resposta — o cliente foi criado no Asaas
      }
    }

    return res.json({ ok:true, customerId: customer.id, customer });
  } catch (e) {
    console.error('[Asaas][customer] erro:', e.message);
    return res.status(400).json({ ok:false, error: e.message });
  }
});

// =========================[ Asaas Client ]=========================
const fetch = require("node-fetch");

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_ENV = process.env.ASAAS_ENV || "sandbox";
const ASAAS_BASE_URL =
  ASAAS_ENV === "prod"
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/api/v3";

// Função auxiliar para chamar a API do Asaas
async function asaasRequest(endpoint, options = {}) {
  const res = await fetch(`${ASAAS_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ASAAS_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro Asaas ${res.status}: ${err}`);
  }
  return res.json();
}

// ============================================================================
// INTEGRAÇÃO DE MONETIZAÇÃO (Rotas e Funções)
// ============================================================================

// === Funções e Constantes do asaas-payment.js ===
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

// Preços dos planos (em reais)
const PLAN_PRICES = {
  pro: 29.90,
  premium: 49.90,
};

// Benefícios por plano
const PLAN_BENEFITS = {
  free: {
    destaque: false,
    raioKm: 0,
    cidadesExtras: 3,
    fotosMax: 1,
    leadsMax: 3,
    metricas: false,
    top10: false,
  },
  pro: {
    destaque: 'medium',
    raioKm: 30,
    cidadesExtras: 5,
    fotosMax: 5,
    leadsMax: 15,
    metricas: 'basic',
    top10: false,
  },
  premium: {
    destaque: 'high',
    raioKm: 50,
    cidadesExtras: 10,
    fotosMax: 10,
    leadsMax: -1, // ilimitado
    metricas: 'advanced',
    top10: true,
  },
};

// Função auxiliar para chamar API Asaas
async function asaasRequest(endpoint, options = {}) {
  // Reintroduzir as constantes de configuração do Asaas no escopo da função
  const ASAAS_KEY = process.env.ASAAS_API_KEY;
  const ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox';
  const ASAAS_BASE_URL =
    ASAAS_ENV === 'prod'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';
  
  const url = `${ASAAS_BASE_URL}${endpoint}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ASAAS_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro Asaas ${res.status}: ${err}`);
  }

  return res.json();
}





// === Rotas do asaas-payment.js ===

// POST /api/pay/asaas/checkout
app.post('/api/pay/asaas/checkout', express.json(), requireProAuth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    const usuarioId = req.session.painel.proId;

    if (!PLAN_PRICES[plan]) {
      return res.status(400).json({
        ok: false,
        error: 'Plano inválido. Use "pro" ou "premium".',
      });
    }

    // Aqui você buscaria os dados do usuário do banco de dados
    // Por enquanto, vamos usar dados da sessão (simplificado)
    const pro = readDB().find(p => p.id === usuarioId) || {};
    const email = pro.email;
    const nome = pro.nome;

    if (!email || !nome) {
      return res.status(400).json({
        ok: false,
        error: 'Dados do usuário incompletos (e-mail ou nome)',
      });
    }

    // 1) Criar ou obter customer no Asaas
    let customerId = pro.asaasCustomerId;

    if (!customerId) {
      const customer = await asaasRequest('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: nome,
          email: email,
          mobilePhone: pro.whatsapp || '',
          cpfCnpj: pro.cpf || '',
        }),
      });
      customerId = customer.id;
      // TODO: Salvar customerId no banco de dados (JSON)
      const db = readDB();
      const idx = db.findIndex(p => p.id === usuarioId);
      if (idx !== -1) {
        db[idx].asaasCustomerId = customerId;
        writeDB(db);
      }
    }

    // 2) Criar assinatura no Asaas
    const value = PLAN_PRICES[plan];
    const description = plan === 'premium' ? 'Plano Premium Mensal' : 'Plano Pro Mensal';
    const today = new Date().toISOString().slice(0, 10);

    const subscription = await asaasRequest('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        value,
        cycle: 'MONTHLY',
        nextDueDate: today,
        description,
        notificationEnabled: true,
      }),
    });

    // 3) Obter link de pagamento
    let paymentUrl = null;
    try {
      const payments = await asaasRequest(
        `/payments?subscription=${subscription.id}&status=PENDING&limit=1`,
        { method: 'GET' }
      );
      const payment = payments?.data?.[0];
      paymentUrl = payment?.invoiceUrl || payment?.bankSlipUrl || null;
    } catch (e) {
      console.error('Erro ao obter URL de pagamento:', e.message);
    }

    // 4) Salvar assinatura no banco de dados (JSON)
    const db = readDB();
    const idx = db.findIndex(p => p.id === usuarioId);
    if (idx !== -1) {
      db[idx].asaasSubscriptionId = subscription.id;
      db[idx].plano = plan;              // 'pro' ou 'premium'
      db[idx].statusAssinatura = 'pendente';   // aguardando pagamento
      writeDB(db);
    }

    return res.json({
      ok: true,
      subscriptionId: subscription.id,
      paymentUrl: paymentUrl,
      redirectUrl: paymentUrl || `https://dashboard.asaas.com/subscription/${subscription.id}`,
    });
  } catch (e) {
    console.error('[Asaas][checkout] erro:', e.message);
    return res.status(400).json({
      ok: false,
      error: e.message,
    });
  }
});

// POST /api/pay/asaas/webhook
app.post('/api/pay/asaas/webhook', express.json(), async (req, res) => {
  try {
    // Validar token do webhook
    const token = req.headers['asaas-access-token'];
    if (token !== ASAAS_WEBHOOK_TOKEN) {
      console.warn('[Asaas] Webhook com token inválido:', token);
      return res.status(401).json({ ok: false, error: 'Token inválido' });
    }

    const event = req.body;
    console.log('[Asaas] Webhook recebido:', event.event);

    const eventType = event.event;
    const subscriptionId = event.subscription || event.payment?.subscription;
    const payment = event.payment || {};

    // Encontrar profissional pela assinatura
    const db = readDB();
    const profIndex = db.findIndex(p => p.asaasSubscriptionId === subscriptionId);
    
    if (profIndex === -1) {
      console.warn(`[Asaas] Profissional não encontrado para subscription: ${subscriptionId}`);
      return res.json({ ok: true });
    }

    const prof = db[profIndex];

    // Tratar eventos
    switch (eventType) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        console.log('✅ Pagamento confirmado:', payment.id);
        // Atualizar status
        prof.statusAssinatura = 'ativa';
        prof.plano = prof.plano === 'free' ? 'pro' : prof.plano; // Garante que o plano é ativado
        prof.validadePlano = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        break;

      case 'PAYMENT_OVERDUE':
        console.log('⚠️ Pagamento atrasado:', payment.id);
        prof.statusAssinatura = 'pendente';
        break;

      case 'PAYMENT_REFUNDED':
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELED':
        console.log('❌ Assinatura cancelada/estornada:', subscriptionId);
        // Voltar para plano free
        prof.plano = 'free';
        prof.statusAssinatura = 'cancelada';
        prof.validadePlano = null;
        prof.asaasSubscriptionId = null;
        break;

      default:
        console.log('📘 Evento ignorado:', eventType);
    }
    
    // Salvar no banco
    db[profIndex] = prof;
    writeDB(db);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Asaas] Erro no webhook:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/plano/cancelar
app.post('/api/plano/cancelar', express.json(), requireProAuth, async (req, res) => {
  try {
    const usuarioId = req.session.painel.proId;

    const db = readDB();
    const profIndex = db.findIndex(p => p.id === usuarioId);

    if (profIndex === -1) {
      return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
    }

    const prof = db[profIndex];

    if (!prof.asaasSubscriptionId) {
      return res.status(404).json({ ok: false, error: 'Nenhuma assinatura ativa encontrada' });
    }

    // Cancelar no Asaas
    await asaasRequest(`/subscriptions/${prof.asaasSubscriptionId}`, {
      method: 'DELETE',
    });

    // Atualizar no banco
    prof.plano = 'free';
    prof.statusAssinatura = 'cancelada';
    prof.validadePlano = null;
    prof.asaasSubscriptionId = null;

    db[profIndex] = prof;
    writeDB(db);

    return res.json({
      ok: true,
      message: 'Assinatura cancelada com sucesso',
    });
  } catch (e) {
    console.error('[Plano] Erro ao cancelar:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// GET /api/plano/status
app.get('/api/plano/data', requireProAuth, async (req, res) => {
  try {
    const usuarioId = req.session.painel.proId;

    const profissional = readDB().find(p => p.id === usuarioId);

    if (!profissional) {
      return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
    }

    const benefits = PLAN_BENEFITS[profissional.plano] || PLAN_BENEFITS.free;

    return res.json({
      ok: true,
      plano: profissional.plano,
      statusAssinatura: profissional.statusAssinatura,
      validadePlano: profissional.validadePlano,
      beneficios: benefits,
      limiteLeads: benefits.leadsMax,
      leadsUsados: profissional.totalLeadsMes || 0,
    });
  } catch (e) {
    console.error('[Plano] Erro ao obter status:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// GET /api/plano/beneficios/:plan
app.get('/api/plano/beneficios/:plan', (req, res) => {
  const plan = req.params.plan.toLowerCase();
  const benefits = PLAN_BENEFITS[plan];

  if (!benefits) {
    return res.status(404).json({
      ok: false,
      error: 'Plano não encontrado',
    });
  }

  return res.json({
    ok: true,
    plano: plan,
    preco: PLAN_PRICES[plan] || 0,
    beneficios: benefits,
  });
});

// ============================================================================
// === Funções e Constantes do payment-fee.js ===
// ============================================================================

const TAX_RATE = 0.04; // 4%

// Função para verificar e fazer downgrade automático (chamada pelo webhook)
async function checkAndDowngradePlan(usuarioId) {
  try {
    // TODO: Implementar com Prisma
    // const profissional = await prisma.profissional.findUnique({
    //   where: { usuarioId },
    // });

    // if (!profissional) return null;

    // // Se o plano expirou, downgrade para Free
    // if (profissional.validadePlano && new Date(profissional.validadePlano) < new Date()) {
    //   const updated = await prisma.profissional.update({
    //     where: { usuarioId },
    //     data: {
    //       plano: 'free',
    //       statusAssinatura: 'cancelada',
    //       validadePlano: null,
    //       limiteLeadsMes: 3,
    //       totalLeadsMes: 0,
    //     },
    //   });

    //   console.log(`✅ Profissional ${usuarioId} downgrade para Free (plano expirou)`);
    //   return updated;
    // }

    return null;
  } catch (e) {
    console.error('[Downgrade] Erro:', e.message);
    throw e;
  }
}

// Função para resetar leads mensais (chamada diariamente ou quando necessário)
async function resetMonthlyLeads() {
  try {
    // TODO: Implementar com Prisma
    // const now = new Date();
    // const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // // Resetar leads de todos os profissionais no primeiro dia do mês
    // const updated = await prisma.profissional.updateMany({
    //   where: {
    //     criadoEm: { lt: firstDayOfMonth },
    //   },
    //   data: {
    //     totalLeadsMes: 0,
    //   },
    // });

    // console.log(`✅ Leads mensais resetados para ${updated.count} profissionais`);
    // return updated;

    return null;
  } catch (e) {
    console.error('[ResetLeads] Erro:', e.message);
    throw e;
  }
}

// Função para calcular taxa de pagamento
function calculatePaymentFee(valor, metodo = 'app') {
  const valorNumerico = parseFloat(valor);
  
  if (metodo === 'whatsapp') {
    return {
      valor: valorNumerico,
      taxa: 0,
      valorComTaxa: valorNumerico,
      taxaPercentual: 0,
    };
  }

  const taxa = valorNumerico * TAX_RATE;
  return {
    valor: valorNumerico,
    taxa: parseFloat(taxa.toFixed(2)),
    valorComTaxa: parseFloat((valorNumerico + taxa).toFixed(2)),
    taxaPercentual: 4,
  };
}

// === Rotas do payment-fee.js ===

// POST /api/pagamento/processar
app.post('/api/pagamento/processar', express.json(), requireProAuth, async (req, res) => {
  try {
    const { profissionalId, valor, metodo } = req.body || {};
    const usuarioId = req.session.painel.proId;

    if (!profissionalId || !valor || !metodo) {
      return res.status(400).json({
        ok: false,
        error: 'Informe profissionalId, valor e metodo (pix|cartao|whatsapp)',
      });
    }

    const valorNumerico = parseFloat(valor);
    if (isNaN(valorNumerico) || valorNumerico <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'Valor inválido',
      });
    }

    let taxa = 0;
    let valorComTaxa = valorNumerico;

    // Aplicar taxa apenas se o método não é WhatsApp direto
    if (metodo !== 'whatsapp') {
      taxa = valorNumerico * TAX_RATE;
      valorComTaxa = valorNumerico + taxa;
    }

    // TODO: Salvar pagamento no banco (JSON/Prisma)
    // const pagamento = await prisma.pagamentoViaApp.create({...});

    return res.json({
      ok: true,
      pagamento: {
        valor: valorNumerico,
        taxa: taxa,
        valorComTaxa: valorComTaxa,
        metodo: metodo,
        taxaPercentual: metodo === 'whatsapp' ? 0 : 4,
        descricao: metodo === 'whatsapp' 
          ? 'Sem taxa - Contato direto via WhatsApp'
          : `Taxa de ${(TAX_RATE * 100).toFixed(0)}% aplicada ao pagamento via app`,
      },
    });
  } catch (e) {
    console.error('[Pagamento] Erro ao processar:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// GET /api/pagamento/simular
app.get('/api/pagamento/simular', (req, res) => {
  try {
    const { valor, metodo } = req.query || {};

    if (!valor || !metodo) {
      return res.status(400).json({
        ok: false,
        error: 'Informe valor e metodo (pix|cartao|whatsapp)',
      });
    }

    const valorNumerico = parseFloat(valor);
    if (isNaN(valorNumerico) || valorNumerico <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'Valor inválido',
      });
    }

    const simulacao = calculatePaymentFee(valorNumerico, metodo);

    return res.json({
      ok: true,
      simulacao: {
        ...simulacao,
        taxa: parseFloat(simulacao.taxa.toFixed(2)),
        valorComTaxa: parseFloat(simulacao.valorComTaxa.toFixed(2)),
        descricao: simulacao.taxaPercentual === 0 
          ? 'Sem taxa - Contato direto via WhatsApp'
          : `Taxa de 4% aplicada ao pagamento via app`,
      },
    });
  } catch (e) {
    console.error('[Pagamento] Erro ao simular:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// GET /api/pagamento/historico
app.get('/api/pagamento/historico', requireProAuth, async (req, res) => {
  try {
    const usuarioId = req.session.painel.proId;

    // TODO: Implementar com Prisma
    // const pagamentos = await prisma.pagamentoViaApp.findMany({
    //   where: { usuarioId },
    //   orderBy: { criadoEm: 'desc' },
    //   take: 50,
    // });

    return res.json({
      ok: true,
      pagamentos: [], // TODO: retornar pagamentos reais
    });
  } catch (e) {
    console.error('[Pagamento] Erro ao obter histórico:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// ============================================================================
// === Middleware de Autorização por Plano (plan-authorization.js) ===
// ============================================================================

// As constantes PLAN_LIMITS, getPlanLimit, requirePlanFeature, requireMetricsAccess,
// e requireTop10Access foram removidas daqui para evitar declaração duplicada,
// pois o erro indica que elas já existem no escopo global do server.js original.

// =========================[ Assinaturas Pro/Premium ]=========================

// Criar assinatura (Pro/Premium) + salvar no banco (status pending)
app.post('/api/pay/asaas/subscription/create', express.json(), async (req, res) => {
  try {
    const { customerId, plan, proId } = req.body || {};
    const PLAN_PRICES = { pro: 29.90, premium: 49.90 };
    if (!customerId || !PLAN_PRICES[plan]) {
      return res.status(400).json({ ok:false, error:'Informe customerId e plan (pro|premium).' });
    }

    const value = PLAN_PRICES[plan];
    const description = plan === 'premium' ? 'Plano Premium Mensal' : 'Plano Pro Mensal';
    const today = new Date().toISOString().slice(0,10);

    const sub = await asaasRequest('/subscriptions', {
      method:'POST',
      body: JSON.stringify({
        customer: customerId,
        value,
        cycle: "MONTHLY",
        nextDueDate: today,
        description
      })
    });

    // salva no seu JSON
    try {
      const raw = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE,'utf8') : '{"profissionais":[]}';
      const db  = raw ? JSON.parse(raw) : { profissionais: [] };
      const idx = (db.profissionais||[]).findIndex(p => String(p.id) === String(proId));
      if (idx >= 0) {
        db.profissionais[idx].asaasSubscriptionId = sub.id;
        db.profissionais[idx].plano = plan;              // 'pro' ou 'premium'
        db.profissionais[idx].statusPlano = 'pending';   // aguardando pagamento
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
      }
    } catch (e) {
      console.error('[Assinatura][persist] falha ao salvar:', e.message);
    }

    // tenta obter link da primeira cobrança
    async function getFirstPaymentUrlForSubscription(subId){
      try {
        const list = await asaasRequest(`/payments?subscription=${subId}&status=PENDING&limit=1`, { method:'GET' });
        const p = list?.data?.[0];
        return p ? (p.invoiceUrl || p.bankSlipUrl || p.transactionReceiptUrl || null) : null;
      } catch { return null; }
    }
    const payUrl = await getFirstPaymentUrlForSubscription(sub.id);

    return res.json({ ok:true, subscriptionId: sub.id, url: payUrl });
  } catch (e) {
    console.error('[Asaas][subscription] erro:', e.message);
    return res.status(400).json({ ok:false, error: e.message });
  }
});


/// =========================[ Arquivos / Banco JSON ]==========================
// Removidas funções loadDB/saveDB para forçar o uso do fallback JSON.
const DATA_FILE = process.env.DATA_FILE || "/data/profissionais.json";


// --- GET: lista avaliações do profissional (mais recentes primeiro) ---
app.get("/api/profissional/:id/avaliacoes", (req, res) => {
  const id = String(req.params.id);
  const db = loadDB();
  const prof = db.find((p) => String(p.id) === id);
  if (!prof) return res.status(404).json({ ok: false, error: "Profissional não encontrado" });

  const list = Array.isArray(prof.avaliacoes) ? prof.avaliacoes : [];
  const norm = list.map((a) => ({
      nome: a.nome || a.autor || a.cliente || "Cliente",
      nota: Number(a.nota ?? a.rating ?? a.estrelas ?? a.score ?? 0),
      texto: a.texto || a.comentario || a.comment || a.mensagem || "",
      ts: a.ts || a.createdAt || a.data || Date.now(),
    }))
    .sort((a, b) => Number(b.ts) - Number(a.ts));

  res.json(norm);
});

// --- POST: cria nova avaliação (usado pela tela /avaliar) ---
app.post("/api/profissional/:id/avaliar", express.json(), (req, res) => {
  const id = String(req.params.id);
  const { nome, nota, texto } = req.body || {};

  if (!texto && nota == null) {
    return res.status(400).json({ ok: false, error: "Informe ao menos texto ou nota" });
  }
  const db = loadDB();
  const prof = db.find((p) => String(p.id) === id);
  if (!prof) return res.status(404).json({ ok: false, error: "Profissional não encontrado" });

  if (!Array.isArray(prof.avaliacoes)) prof.avaliacoes = [];
  prof.avaliacoes.push({
    nome: String(nome || "Cliente"),
    nota: Number(nota ?? 0),
    texto: String(texto || ""),
    ts: Date.now(),
  });

  saveDB(db);
  res.json({ ok: true });
});

// ====================== WhatsApp Cloud API (templates) ======================

async function sendWhatsAppTemplate(to) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WA_PHONE_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to, // número E.164 (ex: 5521971891276)
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    console.log("[WHATSAPP][RESP]", resp.status, data);
  } catch (err) {
    console.error("[WHATSAPP][ERRO]", err);
  }
}

// rota de teste: acessando /wa/test envia o template para o número abaixo
app.get("/wa/test", async (_req, res) => {
  await sendWhatsAppTemplate("5521971891276");
  res.send("Mensagem de teste (TEMPLATE) enviada para o seu WhatsApp!");
});

app.get("/wa/template", async (req, res) => {
  try {
    const to = String(req.query.to || "5521971891276").replace(/\D/g, "");
    const url = `https://graph.facebook.com/v22.0/${process.env.WA_PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "teste_autonoma",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Kadu" }] }],
      },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    console.log("[WHATSAPP][RESP]", r.status, body);
    if (!r.ok) return res.status(500).send("Falha ao enviar template. Veja os logs.");
    res.send("✅ Mensagem template enviada! Veja seu WhatsApp.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Erro interno.");
  }
});

// ===== Envio de template de PIN (WhatsApp) =====
async function sendPinTemplate(toDigits55, code) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WA_PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: String(toDigits55),
    type: "template",
    template: {
      name: "pin_login",
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: String(code) }] }],
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  console.log("[WHATSAPP][TEMPLATE][RESP]", r.status, body);

  if (!r.ok) {
    const txt = `Autônoma.app\nSeu código para entrar é: ${code}\nNão compartilhe.`;
    console.warn("[WHATSAPP] Template falhou — enviando fallback TEXT");
    await sendWhatsAppMessage(toDigits55, txt);
    return false;
  }
  return true;
}

app.get("/wa/pin", async (req, res) => {
  try {
    const to = String(req.query.to || "").replace(/\D/g, "");
    const code = String(req.query.code || "").replace(/\D/g, "");
    if (!/^\d{12,13}$/.test(to)) return res.status(400).send("Parâmetro ?to=55DDDNUMERO inválido.");
    if (!/^\d{4,8}$/.test(code)) return res.status(400).send("Parâmetro ?code= deve ser numérico (4–8 dígitos).");
    const ok = await sendPinTemplate(to, code);
    res.send(ok ? "✅ Template enviado (veja seu WhatsApp)." : "⚠️ Enviado via fallback de texto.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Erro interno.");
  }
});
// Taxas/checkout
const FEE_CARD_PERCENT = Number(process.env.FEE_CARD_PERCENT || 4);
const FEE_PIX_PERCENT = Number(process.env.FEE_PIX_PERCENT || 0);
const PIX_ENABLED = String(process.env.PIX_ENABLED || "true") === "true";
const CARD_ENABLED = String(process.env.CARD_ENABLED || "true") === "true";

// Pastas/arquivos
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const DB_FILE = path.join(DATA_DIR, "profissionais.json");
const BAIRROS_FILE = path.join(DATA_DIR, "bairros.json");
const CIDADES_FILE = path.join(DATA_DIR, "cidades.json");
const SERVICOS_FILE = path.join(DATA_DIR, "servicos.json");
const DENUNCIAS_FILE = path.join(DATA_DIR, "denuncias.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");
const METRICS_FILE = path.join(DATA_DIR, "metrics.json");

[PUBLIC_DIR, DATA_DIR, UPLOAD_DIR].forEach((p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// === Helpers de JSON (robustos) ===
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const txt = fs.readFileSync(file, 'utf8');
    return txt ? JSON.parse(txt) : fallback;
  } catch (e) {
    console.warn('[readJSON]', file, e.message || e);
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    // garante a pasta antes de gravar
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[writeJSON]', file, e);
    return false;
  }
}
// Inicia arquivos essenciais
if (!fs.existsSync(DB_FILE)) writeJSON(DB_FILE, []);
if (!fs.existsSync(DENUNCIAS_FILE)) writeJSON(DENUNCIAS_FILE, []);
if (!fs.existsSync(PAYMENTS_FILE)) writeJSON(PAYMENTS_FILE, []);
if (!fs.existsSync(METRICS_FILE)) writeJSON(METRICS_FILE, {});

// Admin / Sessão
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ""; // se existir, tem prioridade
const SESSION_SECRET = process.env.SESSION_SECRET || "troque-isto";



// =========================[ Middlewares ]=====================
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1.2mb" }));
app.use(cookieParser());

// Canonical/HTTPS
if (!REDIRECTS_DISABLED) {
  app.use((req, res, next) => {
    try {
      const hostNow = (req.headers.host || "").toLowerCase();
      const isHttps = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";

      if (PRIMARY_HOST) {
        const target = PRIMARY_HOST.toLowerCase();
        if (hostNow && hostNow !== target) {
          const url = `http${FORCE_HTTPS ? "s" : isHttps ? "s" : ""}://${target}${req.originalUrl}`;
          return res.redirect(301, url);
        }
      }
      if (FORCE_HTTPS && !isHttps) {
        const host = hostNow || PRIMARY_HOST || "localhost";
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    } catch {}
    next();
  });
}
// === Redirects curtos para o login do painel ===
// Use 302 durante os testes para evitar cache do navegador.
// (Depois que tudo estiver ok, você pode trocar para 301.)
app.get(['/painel', '/painel/', '/pa', '/pa/'], (_req, res) => {
  res.redirect(302, '/painel_login.html');
});
// Estático
app.use(express.static(PUBLIC_DIR, { maxAge: "7d", fallthrough: true }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

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
app.use(
  session({
    name: "aut_sess",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.SECURE_COOKIES === "true" ? "none" : "lax",
      secure: process.env.SECURE_COOKIES === "true",
    },
  })
);

// Limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const reviewsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

// =========================[ GEO / AUTOCOMPLETE ]=====================
const CIDADES_BASE = [
  {
    nome: "Rio de Janeiro/RJ",
    lat: -22.9068,
    lng: -43.1729,
    bairros: ["Copacabana", "Ipanema", "Botafogo", "Tijuca", "Barra da Tijuca", "Leblon", "Centro"],
  },
  {
    nome: "São Paulo/SP",
    lat: -23.5505,
    lng: -46.6333,
    bairros: ["Pinheiros", "Vila Mariana", "Moema", "Tatuapé", "Santana", "Itaim Bibi", "Centro"],
  },
  {
    nome: "Belo Horizonte/MG",
    lat: -19.9167,
    lng: -43.9345,
    bairros: ["Savassi", "Lourdes", "Funcionários", "Pampulha", "Centro", "Cidade Nova"],
  },
  {
    nome: "Brasília/DF",
    lat: -15.7939,
    lng: -47.8828,
    bairros: ["Asa Sul", "Asa Norte", "Lago Sul", "Lago Norte", "Sudoeste", "Noroeste"],
  },
  {
    nome: "Salvador/BA",
    lat: -12.9711,
    lng: -38.5108,
    bairros: ["Barra", "Ondina", "Rio Vermelho", "Pituba", "Itapuã", "Stella Maris"],
  },
  {
    nome: "Porto Alegre/RS",
    lat: -30.0346,
    lng: -51.2177,
    bairros: ["Moinhos de Vento", "Centro", "Cidade Baixa", "Petrópolis", "Tristeza"],
  },
  {
    nome: "Curitiba/PR",
    lat: -25.4284,
    lng: -49.2733,
    bairros: ["Batel", "Centro", "Água Verde", "Bigorrilho", "Cabral", "Portão"],
  },
  {
    nome: "Recife/PE",
    lat: -8.0476,
    lng: -34.877,
    bairros: ["Boa Viagem", "Casa Forte", "Graças", "Espinheiro", "Pina", "Boa Vista"],
  },
  {
    nome: "Fortaleza/CE",
    lat: -3.7319,
    lng: -38.5267,
    bairros: ["Meireles", "Aldeota", "Praia de Iracema", "Praia do Futuro", "Centro"],
  },
  {
    nome: "Manaus/AM",
    lat: -3.119,
    lng: -60.0217,
    bairros: ["Adrianópolis", "Centro", "Ponta Negra", "Flores", "Parque 10"],
  },
];

const SERVICOS_BASE = [
  "Eletricista",
  "Hidráulico",
  "Pintor",
  "Marceneiro",
  "Diarista",
  "Pedreiro",
  "Técnico em informática",
  "Manicure",
  "Cabeleireiro",
  "Encanador",
  "Chaveiro",
  "Jardinheiro",
  "Fotógrafo",
  "Personal Trainer",
];

app.get("/api/geo/cidades", (_req, res) => {
  try {
    res.json(CIDADES_BASE.map((c) => c.nome));
  } catch {
    res.json([]);
  }
});

app.get("/api/geo/cidades/suggest", (req, res) => {
  try {
    const q = trim(req.query.q || "");
    if (!q) return res.json([]);
    const QQ = norm(q);
    const out = CIDADES_BASE.map((c) => c.nome)
      .filter((c) => norm(c).includes(QQ) || norm(c.split("/")[0]).includes(QQ))
      .slice(0, 20);
    res.json(out);
  } catch {
    res.json([]);
  }
});

app.get("/api/geo/servicos", (_req, res) => {
  try {
    res.json(SERVICOS_BASE);
  } catch {
    res.json([]);
  }
});

app.get("/api/geo/bairros", (req, res) => {
  const cidade = String(req.query.cidade || "").trim().toLowerCase();
  if (!cidade) return res.json([]);
  const item = CIDADES_BASE.find((c) => c.nome.toLowerCase() === cidade);
  return res.json(item ? item.bairros : []);
});

app.get("/api/geo/bairros/suggest", (req, res) => {
  const cidade = String(req.query.cidade || "").trim().toLowerCase();
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!cidade || !q) return res.json([]);
  const item = CIDADES_BASE.find((c) => c.nome.toLowerCase() === cidade);
  if (!item) return res.json([]);
  const out = item.bairros.filter((b) => b.toLowerCase().includes(q)).slice(0, 15);
  return res.json(out);
});

app.get("/api/geo/servicos/suggest", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);
  const out = SERVICOS_BASE.filter((s) => s.toLowerCase().includes(q)).slice(0, 15);
  return res.json(out);
});

app.get("/api/geo/closest-city", (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.json({ ok: false, error: "coords_invalid" });
  let best = null,
    bestD = Infinity;
  for (const c of CIDADES_BASE) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d != null && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (!best) return res.json({ ok: false });
  return res.json({ ok: true, cidade: best.nome, distKm: Math.round(bestD * 10) / 10 });
});

// =========================[ HTML helpers ]=====================
const htmlMsg = (title, text, backHref = "/") =>
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><div class="wrap"><div class="card"><h1>${escapeHTML(
    title
  )}</h1><p class="meta">${escapeHTML(text || "")}</p><a class="btn" href="${escapeHTML(backHref)}">Voltar</a></div></div>`;

const htmlErrors = (title, list, backHref = "/") =>
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><div class="wrap"><div class="card"><h1>${escapeHTML(
    title
  )}</h1><ul>${(list || []).map((e) => `<li>${escapeHTML(e)}</li>`).join("")}</ul><a class="btn" href="${escapeHTML(
    backHref
  )}">Voltar</a></div></div>`;
// =========================[ Health/diag ]======================

app.get("/admin/check", (req, res) => {
  const info = {
    session: !!(req.session && req.session.isAdmin),
    total: readJSON(DB_FILE, []).length,
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
  res.send(
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><div class="wrap"><div class="card"><h1>Diagnóstico</h1><pre>${escapeHTML(
      JSON.stringify(info, null, 2)
    )}</pre><a class="btn" href="/">Início</a></div></div>`
  );
});

// =====================[ Páginas/redirects ]====================
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/clientes.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "clientes.html")));
app.get("/cadastro.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "cadastro.html")));
app.get("/favoritos.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "favoritos.html")));
app.get("/reset", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "reset.html")));

app.get("/cadastro_sucesso.html", (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "cadastro_sucesso.html"))
);
app.get("/denunciar.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "denunciar.html")));
app.get("/top10.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "top10.html")));
app.get("/planos.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "planos.html")));
app.get("/checkout.html", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "checkout.html")));
app.get("/painel_login.html", (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "painel_login.html"))
);
app.get("/perfil.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "perfil.html")));

// Redirects legados/canônicos
app.get(["/perfil.html", "/perfil"], (req, res) => {
  const id = Number(req.query.id || "");
  if (id) return res.redirect(301, `/profissional/${id}`);
  return res.redirect(302, "/clientes.html");
});
app.get("/clientes", (_req, res) => res.redirect(301, "/clientes.html"));
app.get("/cadastro", (_req, res) => res.redirect(301, "/cadastro.html"));

// =========================[ Banco (JSON) ]=====================
const readDB = () => readJSON(DB_FILE, []);
const writeDB = (data) => writeJSON(DB_FILE, data);

// Verificado (regra pragmática para UX boa)
function computeVerified(p) {
  return !!(p?.foto && isWhatsappValid(p.whatsapp) && p.cidade && p.bairro);
}

// Migração/normalização inicial
(function fixDB() {
  const db = readDB();
  let changed = false;
  let nextId = db.reduce((m, p) => Math.max(m, Number(p.id || 0)), 0) + 1;

  for (const p of db) {
    if (!p.id) {
      p.id = nextId++;
      changed = true;
    }
    if (typeof p.atendimentos !== "number") {
      p.atendimentos = 0;
      changed = true;
    }
    if (!Array.isArray(p.avaliacoes)) {
      p.avaliacoes = [];
      changed = true;
    }
    if (!p.createdAt) {
      p.createdAt = nowISO();
      changed = true;
    }
    if (typeof p.visitas !== "number") {
      p.visitas = 0;
      changed = true;
    }
    if (typeof p.chamadas !== "number") {
      p.chamadas = 0;
      changed = true;
    }
    if (!Array.isArray(p.visitsLog)) p.visitsLog = [];
    if (!Array.isArray(p.callsLog)) p.callsLog = [];
    if (!Array.isArray(p.qrLog)) p.qrLog = [];

    if (typeof p.suspenso !== "boolean") {
      p.suspenso = false;
      changed = true;
    }
    if (!p.suspensoMotivo) p.suspensoMotivo = "";
    if (!p.suspensoEm && p.suspenso) p.suspensoEm = nowISO();

    if (typeof p.excluido !== "boolean") {
      p.excluido = false;
      changed = true;
    }
    if (!p.excluidoEm && p.excluido) p.excluidoEm = nowISO();

    if (p.lat != null && typeof p.lat !== "number") {
      p.lat = Number(p.lat);
      changed = true;
    }
    if (p.lng != null && typeof p.lng !== "number") {
      p.lng = Number(p.lng);
      changed = true;
    }

    const newVer = computeVerified(p);
    if (p.verificado !== newVer) {
      p.verificado = newVer;
      changed = true;
    }

    if (!p.plano) p.plano = "free";
    if (typeof p.raioKm !== "number") p.raioKm = 0;
    if (!Array.isArray(p.cidadesExtras)) p.cidadesExtras = [];
    if (!p.radar) {
      p.radar = { on: false, until: null, lastOnAt: null, monthlyUsed: 0, monthRef: monthRefOf() };
      changed = true;
    }
    if (!p.lastPos) p.lastPos = { lat: null, lng: null, at: null };
    if (typeof p.receiveViaApp !== "boolean") p.receiveViaApp = false;

    // PIN (login do profissional)
    if (!p.pinHash) p.pinHash = null;
    if (typeof p.mustSetPin !== "boolean") p.mustSetPin = false;
  }
  if (changed) writeDB(db);
  console.log("✔ Base OK (ids/logs/planos/radar/verificado).");
})();

// =========================[ Upload (multer) ]==================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype?.startsWith("image/") ? cb(null, true) : cb(new Error("Apenas imagens (JPG/PNG).")),
});

// =========================[ GEO utils + arquivos ]==============
function loadGeoMaps() {
  const bairrosMap = readJSON(BAIRROS_FILE, {}) || {};
  let cidades = readJSON(CIDADES_FILE, []);
  if (!Array.isArray(cidades)) {
    cidades = Object.keys(cidades || {});
  }
  if (!cidades.length && bairrosMap && typeof bairrosMap === "object") {
    cidades = Object.keys(bairrosMap);
  }
  cidades = (cidades || []).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const baseServ = [
    "Eletricista",
    "Encanador",
    "Diarista",
    "Passadeira",
    "Marido de aluguel",
    "Pintor",
    "Pedreiro",
    "Gesseiro",
    "Marceneiro",
    "Serralheiro",
    "Montador de móveis",
    "Técnico de informática",
    "Desenvolvedor",
    "Designer",
    "Fotógrafo",
    "Videomaker",
    "DJ",
    "Garçom",
    "Segurança",
    "Cabeleireiro",
    "Manicure",
    "Maquiadora",
    "Esteticista",
    "Personal trainer",
    "Professor particular",
    "Babá",
    "Cuidador de idosos",
    "Jardinagem",
    "Climatização (ar-condicionado)",
    "Refrigeração",
    "Soldador",
    "Telhadista",
    "Vidraceiro",
    "Chaveiro",
    "Marketing digital",
    "Social media",
    "Consultor",
    "Advogado",
    "Contador",
  ];
  const servExtra = readJSON(SERVICOS_FILE, []);
  const fromDB = new Set(
    readDB()
      .map((p) => (p.servico || p.profissao || "").toString().trim())
      .filter(Boolean)
  );
  const servicos = Array.from(
    new Set([...baseServ, ...(Array.isArray(servExtra) ? servExtra : []), ...Array.from(fromDB)].map((s) =>
      s.trim()
    ))
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { bairrosMap, cidades, servicos };
}

function normalizeCidadeUF(input) {
  const { cidades } = loadGeoMaps();
  const q = norm(input);
  if (!q) return "";
  let hit = cidades.find((c) => norm(c) === q);
  if (hit) return hit;
  hit = cidades.find((c) => norm(c.split("/")[0]) === q);
  if (hit) return hit;
  hit = cidades.find((c) => norm(c).startsWith(q) || norm(c.split("/")[0]).startsWith(q));
  if (hit) return hit;
  hit = cidades.find((c) => norm(c).includes(q));
  return hit || input;
}

// =========================[ UI config ]========================
const WHATSAPP_DEFAULT_MSG =
  "Olá! Vi seu perfil na Autônoma.app e gostaria de contratar seu serviço. Podemos conversar?";

app.get("/api/ui-config", (_req, res) => {
  res.json({ ok: true, evaluateCTA: true, whatsappTemplate: WHATSAPP_DEFAULT_MSG });
});

// =========================[ Cadastro ]=========================
function validateCadastro(body) {
  
  const e = [];
  const nome = trim(body.nome);
  if (!nome || nome.length < 2 || nome.length > 80) e.push("Nome é obrigatório (2–80).");

  const cidadeInput = trim(body.cidade);
  const cidade = normalizeCidadeUF(cidadeInput);
  const bairro = trim(body.bairro);
  if (!cidade) e.push("Cidade é obrigatória.");
  if (!bairro) e.push("Bairro é obrigatório.");

  const servico = trim(body.servico);
  const profissao = trim(body.profissao);
  if (!servico && !profissao) e.push("Informe Categoria ou Profissão.");

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
  if (lat != null && !(Number.isFinite(lat) && lat >= -90 && lat <= 90)) e.push("Latitude inválida.");
  if (lng != null && !(Number.isFinite(lng) && lng >= -180 && lng <= 180)) e.push("Longitude inválida.");

  return {
    ok: e.length === 0,
    errors: e,
    values: {
      nome,
      email,
      telefone,
      whatsapp,
      cidade,
      bairro,
      servico,
      profissao,
      experiencia: trim(body.experiencia),
      precoBase: trim(body.precoBase),
      site: trim(body.site),
      endereco: trim(body.endereco),
      descricao: trim(body.descricao),
      lat: lat == null ? undefined : lat,
      lng: lng == null ? undefined : lng,
    },
  };
}

function isDuplicate(db, novo) {
  return db.some(
    (p) =>
      p.whatsapp === novo.whatsapp &&
      norm(p.cidade) === norm(novo.cidade) &&
      norm(p.bairro) === norm(novo.bairro) &&
      !p.excluido
  );
}

// ===== [ AUTONOMA • POST /cadastro ] =====
app.post(
  '/cadastro',
  // middleware do upload (reaproveita seu `upload.single('foto')`)
  (req, res, next) => {
    upload.single('foto')(req, res, (err) => {
      if (err) {
        console.error('[upload foto] erro:', err);
        return res.status(400).send(htmlMsg('Erro no upload', err.message || 'Falha ao enviar a foto', '/cadastro.html'));
      }
      next();
    });
  },
  // handler principal
  async (req, res) => {
    try {
      // ===== normalizações básicas =====
      const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
      const norm = (s) => String(s || '').trim();

      // foto (se enviada)
      const fotoUrl = req.file ? `/uploads/${req.file.filename}` : null;

      // normaliza telefone/whatsapp
      const wDig = onlyDigits(req.body.whatsapp);
      const whatsapp = wDig.startsWith('55') ? wDig : (wDig.length === 10 || wDig.length === 11 ? '55' + wDig : wDig);
      const tDig = onlyDigits(req.body.telefone);
      const telefone = tDig ? (tDig.startsWith('55') ? tDig : ((tDig.length === 10 || tDig.length === 11) ? '55' + tDig : tDig)) : '';

      // descrição/experiência (mantém aliases)
      const _descricao = norm(req.body.descricao || req.body.bio || '');
      const _experiencia = norm(req.body.experiencia || req.body.experienciaTempo || '');

      // slug de serviço
      const makeSlug = (s) => norm(s).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const servico = norm(req.body.servico || req.body.profissao || '');
      const servicoSlug = servico ? makeSlug(servico) : null;

      // id
      const id = Date.now().toString();

      // ===== monta registro final =====
      const novo = {
        id,
        // identificação
        nome: norm(req.body.nome),
        foto: fotoUrl,
        fotoUrl,
        // contatos
        whatsapp,
        telefone,
        email: norm((req.body.email || '').toLowerCase()),
        site: norm(req.body.site),
        // localização
        cidade: norm(req.body.cidade),
        estado: req.body.estado || null,
        bairro: norm(req.body.bairro),
        lat: Number.isFinite(Number(req.body.lat)) ? Number(req.body.lat) : null,
        lng: Number.isFinite(Number(req.body.lng)) ? Number(req.body.lng) : null,
        // profissional
        servico,
        servicoSlug,
        profissao: norm(req.body.profissao),
        // descrição/bio
        descricao: _descricao,
        bio: _descricao,
        // experiência
        experiencia: _experiencia,
        experienciaTempo: _experiencia,
        precoBase: norm(req.body.precoBase),
        endereco: norm(req.body.endereco),
        // sistema
        criadoEm: new Date().toISOString(),
        verificado: false,
        mediaAvaliacao: 0,
        totalAvaliacoes: 0,
        visitas: 0,
        // segurança (será preenchido abaixo)
        passwordHash: null,
        pinHash: null
      };

      // ===== SENHA: pega e gera hash (se existir) =====
      // o usuário pode enviar o campo "senha" ou "pin" (cobre ambos)
      const rawSenha = (req.body.senha || req.body.password || req.body.pin || '').toString().trim();

      // Validação do formato do PIN (4 a 6 dígitos numéricos) para cadastro
      if (rawSenha && !/^[0-9]{4,6}$/.test(rawSenha)) {
        return res.status(400).send(htmlMsg(
          'Erro no Cadastro',
          'O PIN deve conter entre 4 e 6 dígitos numéricos.',
          '/cadastro.html'
        ));
      }

      if (rawSenha) {
        try {
          const bcrypt = require('bcryptjs');
          const salt = bcrypt.genSaltSync(10);
          const hashed = bcrypt.hashSync(String(rawSenha), salt);
          // salva em ambos os campos só por compatibilidade
          novo.passwordHash = hashed;
          novo.pinHash = hashed;
        } catch (e) {
          console.warn('[password] falhou, ignorando hash:', e);
          novo.passwordHash = null;
          novo.pinHash = null;
        }
      }

      // ==== salva no DB ====
      // lê o banco atual com fallback (assume readDB/readJSON/DB_FILE definidos no seu server.js)
      const current = (typeof readDB === 'function' ? readDB() : readJSON(DB_FILE, []));
      const banco = Array.isArray(current) ? current : [];

      // regra simples anti-duplicado por (cidade + bairro + whatsapp)
      const dup = banco.find(p =>
        String(p.cidade || '').toLowerCase() === String(novo.cidade || '').toLowerCase() &&
        String(p.bairro || '').toLowerCase() === String(novo.bairro || '').toLowerCase() &&
        String(p.whatsapp || '') === String(novo.whatsapp || '')
      );

      if (dup) {
        return res
          .status(400)
          .send(htmlMsg(
            'Cadastro duplicado',
            'Já existe um profissional com o mesmo WhatsApp neste bairro/cidade.',
            '/cadastro.html'
          ));
      }

      // adiciona o novo registro
      banco.push(novo);

      // persiste (usa writeDB se existir; senão, writeJSON)
      try {
        if (typeof writeDB === 'function') {
          writeDB(banco);
        } else {
          writeJSON(DB_FILE, banco);
        }
      } catch (e) {
        console.error('[writeDB] falhou, usando fallback writeJSON', e);
        try { writeJSON(DB_FILE, banco); } catch (err) { console.error('[writeJSON] falhou também', err); }
      }

      // ===== mantém catálogos (serviços / cidades / bairros) =====
      try {
        // serviços: string[] ou [{nome,slug}]
        if (novo.servico) {
          let servs = readJSON(SERVICOS_FILE, []);
          if (!Array.isArray(servs)) servs = [];
          const exists = servs.some(s =>
            (typeof s === 'string' ? s : String(s?.nome || '')).toLowerCase() === novo.servico.toLowerCase()
          );
          if (!exists) {
            if (servs.length && typeof servs[0] === 'object') {
              servs.push({ nome: novo.servico, slug: novo.servicoSlug || makeSlug(novo.servico) });
            } else {
              servs.push(novo.servico);
            }
            servs.sort((a, b) =>
              (typeof a === 'string' ? a : a.nome).localeCompare(typeof b === 'string' ? b : b.nome, 'pt-BR')
            );
            writeJSON(SERVICOS_FILE, servs);
          }
        }

        // cidades: string[]
        if (novo.cidade) {
          let cidades = readJSON(CIDADES_FILE, []);
          if (!Array.isArray(cidades)) cidades = [];
          if (!cidades.some(c => String(c).toLowerCase() === novo.cidade.toLowerCase())) {
            cidades.push(novo.cidade);
            cidades.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
            writeJSON(CIDADES_FILE, cidades);
          }
        }

        // bairros: { [cidade]: string[] }
        if (novo.cidade && novo.bairro) {
          let bairrosMap = readJSON(BAIRROS_FILE, {});
          if (!bairrosMap || typeof bairrosMap !== 'object') bairrosMap = {};
          const key = novo.cidade;
          const arr = Array.isArray(bairrosMap[key]) ? bairrosMap[key] : [];
          if (!arr.some(b => String(b).toLowerCase() === novo.bairro.toLowerCase())) {
            arr.push(novo.bairro);
            arr.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
            bairrosMap[key] = arr;
            writeJSON(BAIRROS_FILE, bairrosMap);
          }
        }
      } catch (e) {
        console.warn('[catálogos] não foi possível atualizar (ignorado):', e?.message || e);
      }

      // ===== redireciona para o perfil =====
      console.log('[CADASTRO] redirect ->', `/perfil.html?id=${id}`);
      return res.redirect(`/cadastro_sucesso.html?id=${id}`);
    } catch (e) {
      console.error('[ERRO /cadastro]', e);
      return res
        .status(500)
        .send(htmlMsg('Erro Interno', String(e?.message || e), '/cadastro.html'));
    }
  }
);

  // Lê o banco atual com fallback
const current = (typeof readDB === 'function' ? readDB() : readJSON(DB_FILE, []));
const banco = Array.isArray(current) ? current : [];



// persiste (usa writeDB se existir; senão, writeJSON)
if (typeof writeDB === 'function') {
  try {
    writeDB(banco);
  } catch (e) {
    console.error('[writeDB] falhou, usando fallback', e);
    writeJSON(DB_FILE, banco);
  }
} else {
  writeJSON(DB_FILE, banco);
}


// ====== [Helpers de leitura/escrita do DB] ======
function ensureFileReady(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
}
// Helper para escapar HTML em mensagens de erro
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ===== [Perfil APIs — UNIFICADO e robusto] =====

// DEBUG opcional: último profissional salvo
app.get('/api/debug/ultimo-prof', (req, res) => {
  try {
    const db = (typeof readDB === 'function' ? readDB() : readJSONSafe(DB_FILE, []));
    if (!Array.isArray(db) || db.length === 0) {
      return res.json({ ok: true, vazio: true });
    }
    const p = db[db.length - 1];
    res.json({
      ok: true,
      id: p.id,
      nome: p.nome,
      foto: p.foto || p.fotoUrl || null,
      temFotoArquivo: !!(p.foto || p.fotoUrl)?.startsWith?.('/uploads/'),
      descricao: p.descricao || p.bio || "",
      experiencia: p.experienciaTempo || p.experiencia || "",
      cidade: p.cidade || "",
      bairro: p.bairro || "",
      servico: p.servico || p.profissao || ""
    });
  } catch (e) {
    console.error('[debug ultimo-prof]', e);
    res.status(500).json({ ok: false, erro: String(e) });
  }
});
// Mostra caminhos reais usados pelo servidor
app.get("/api/debug/where", (req, res) => {
  res.json({
    ROOT,
    DATA_DIR,
    DB_FILE,
  });
});

// Mostra um resumo do DB (sem vazar hashes)
app.get("/api/debug/db-prof", (req, res) => {
  try {
    const db = readJSON(DB_FILE, []);
    const safe = db.map(p => ({
      id: p.id,
      nome: p.nome,
      whatsapp: p.whatsapp,
      cidade: p.cidade,
      bairro: p.bairro,
      temHash: !!p.passwordHash, // true/false para sabermos se gravou senha
      criadoEm: p.criadoEm,
    }));
    res.json({ ok: true, total: safe.length, itens: safe });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e && e.message || e) });
  }
});

// ===== NOVA ROTA: /api/profissionais (lista com filtros + distância) =====
app.get("/api/profissionais", (req, res) => {
  try {
    // Ler banco de dados
    const db = (typeof readDB === 'function' ? readDB() : readJSONSafe(DB_FILE, [])) || [];
    if (!Array.isArray(db)) {
      return res.status(500).json({ ok: false, error: "db_invalid" });
    }

    // Filtrar apenas profissionais ativos (não excluídos, não suspensos)
    let items = db.filter(p => !p.excluido && !p.suspenso);

    // ===== FILTROS =====
    const norm = (s) => String(s || "").normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    
    // Filtro por CIDADE (exato ou contém)
    const cidadeParam = String(req.query.cidade || "").trim();
    if (cidadeParam) {
      const cidadeNorm = norm(cidadeParam);
      items = items.filter(p => {
        const pCidade = norm(p.cidade || "");
        return pCidade === cidadeNorm || pCidade.includes(cidadeNorm);
      });
    }

    // Filtro por BAIRRO
    const bairroParam = String(req.query.bairro || "").trim();
    if (bairroParam) {
      const bairroNorm = norm(bairroParam);
      items = items.filter(p => norm(p.bairro || "").includes(bairroNorm));
    }

    // Filtro por SERVIÇO
    const servicoParam = String(req.query.servico || "").trim();
    if (servicoParam) {
      const servicoNorm = norm(servicoParam);
      items = items.filter(p => {
        const pServico = norm(p.servico || p.profissao || "");
        return pServico.includes(servicoNorm);
      });
    }

    // Filtro por BUSCA GERAL (q)
    const qParam = String(req.query.q || "").trim();
    if (qParam) {
      const qNorm = norm(qParam);
      items = items.filter(p => {
        return norm(p.nome).includes(qNorm) ||
               norm(p.cidade || "").includes(qNorm) ||
               norm(p.bairro || "").includes(qNorm) ||
               norm(p.servico || p.profissao || "").includes(qNorm);
      });
    }

    // Filtro por AVALIAÇÃO MÍNIMA
    const minRating = Number(req.query.minRating);
    if (Number.isFinite(minRating) && minRating > 0) {
      items = items.filter(p => {
        const notas = (p.avaliacoes || []).map(a => Number(a?.nota)).filter(n => n >= 1 && n <= 5);
        const rating = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : 0;
        return rating >= minRating;
      });
    }

    // ===== CÁLCULO DE DISTÂNCIA =====
    const userLat = Number(req.query.userLat);
    const userLng = Number(req.query.userLng);
    const hasUserCoords = Number.isFinite(userLat) && Number.isFinite(userLng);

    // Função de cálculo de distância (Haversine)
    function calcDistance(lat1, lng1, lat2, lng2) {
      const R = 6371; // Raio da Terra em km
      const toRad = (deg) => deg * Math.PI / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; // Distância em km
    }

    // Mapear profissionais com distância
    items = items.map(p => {
      const pLat = Number(p.lat);
      const pLng = Number(p.lng);
      
      let distanceKm = null;
      if (hasUserCoords && Number.isFinite(pLat) && Number.isFinite(pLng)) {
        distanceKm = Math.round(calcDistance(userLat, userLng, pLat, pLng) * 10) / 10; // Arredondar para 1 casa decimal
      }

      // Calcular rating
      const notas = (p.avaliacoes || []).map(a => Number(a?.nota)).filter(n => n >= 1 && n <= 5);
      const rating = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : 0;

      return {
        id: String(p.id),
        nome: p.nome || "",
        foto: p.foto || p.fotoUrl || null,
        fotoUrl: p.foto || p.fotoUrl || null,
        descricao: (p.descricao ?? p.bio ?? "").toString(),
        bio: (p.descricao ?? p.bio ?? "").toString(),
        experiencia: (p.experienciaTempo ?? p.experiencia ?? "").toString(),
        experienciaTempo: (p.experienciaTempo ?? p.experiencia ?? "").toString(),
        servico: (p.servico ?? p.profissao ?? "").toString(),
        servicoSlug: p.servicoSlug || null,
        cidade: (p.cidade ?? "").toString(),
        bairro: (p.bairro ?? "").toString(),
        lat: Number.isFinite(pLat) ? pLat : null,
        lng: Number.isFinite(pLng) ? pLng : null,
        distanceKm,
        whatsapp: (p.whatsapp ?? "").toString(),
        telefone: (p.telefone ?? "").toString(),
        site: (p.site ?? "").toString(),
        precoBase: (p.precoBase ?? "").toString(),
        verificado: !!p.verificado,
        mediaAvaliacao: Number(p.mediaAvaliacao || rating || 0),
        totalAvaliacoes: Number(p.totalAvaliacoes || (p.avaliacoes?.length || 0)),
        plano: p.plano || "free",
        criadoEm: p.criadoEm || null
      };
    });

    // ===== ORDENAÇÃO =====
    const sortParam = String(req.query.sort || "relevance").toLowerCase();
    
    if (sortParam === "distance" && hasUserCoords) {
      // Ordenar por distância (mais próximo primeiro)
      items.sort((a, b) => {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    } else if (sortParam === "rating") {
      // Ordenar por avaliação (melhor primeiro)
      items.sort((a, b) => b.mediaAvaliacao - a.mediaAvaliacao);
    } else if (sortParam === "recent") {
      // Ordenar por mais recente
      items.sort((a, b) => Number(b.id) - Number(a.id));
    } else {
      // Ordenação padrão: relevância (plano + avaliação + distância)
      items.sort((a, b) => {
        const planScore = (p) => p.plano === "premium" ? 3 : p.plano === "pro" ? 2 : 1;
        const distScore = (p) => p.distanceKm !== null ? (100 - Math.min(p.distanceKm, 100)) : 0;
        
        const scoreA = planScore(a) * 10 + a.mediaAvaliacao * 5 + distScore(a) * 0.1;
        const scoreB = planScore(b) * 10 + b.mediaAvaliacao * 5 + distScore(b) * 0.1;
        
        return scoreB - scoreA;
      });
    }

    // ===== PAGINAÇÃO =====
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const start = (page - 1) * limit;
    const end = start + limit;
    const slice = items.slice(start, end);

    // ===== RESPOSTA =====
    return res.json({
      ok: true,
      total: items.length,
      page,
      limit,
      pages: Math.ceil(items.length / limit),
      items: slice,
      itens: slice // Compatibilidade com código antigo
    });

  } catch (e) {
    console.error("[ERR /api/profissionais]", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Principal: /api/profissionais/:id  (com aliases + distância opcional)
app.get("/api/profissionais/:id", (req, res) => {
  try {
    const rawId = String(req.params.id || "").trim();
    if (!rawId) return res.status(400).json({ ok: false, error: "missing_id" });

    const db = (typeof readDB === "function" ? readDB() : readJSONSafe(DB_FILE, [])) || [];
    if (!Array.isArray(db)) return res.status(500).json({ ok: false, error: "db_invalid" });

    // acha por string ou number
    const prof =
      db.find(p => String(p.id) === rawId) ||
      db.find(p => Number(p.id) === Number(rawId));

    if (!prof) return res.status(404).json({ ok: false, error: "not_found" });

    // campos/aliases
    const foto        = prof.foto || prof.fotoUrl || null;
    const descricao   = (prof.descricao ?? prof.bio ?? "").toString();
    const experiencia = (prof.experienciaTempo ?? prof.experiencia ?? "").toString();
    const servico     = (prof.servico ?? prof.profissao ?? "").toString();
    const cidade      = (prof.cidade ?? "").toString();
    const bairro      = (prof.bairro ?? "").toString();
    const site        = (prof.site ?? "").toString();
    const whatsapp    = (prof.whatsapp ?? "").toString();
    const telefone    = (prof.telefone ?? "").toString();
    const precoBase   = (prof.precoBase ?? "").toString();
    const pLat        = Number(prof.lat);
    const pLng        = Number(prof.lng);

    // distância opcional (?userLat=&userLng=)
    const userLat = Number(req.query.userLat);
    const userLng = Number(req.query.userLng);
    let distanceKm = null;
    if (Number.isFinite(userLat) && Number.isFinite(userLng) && Number.isFinite(pLat) && Number.isFinite(pLng)) {
      const R = 6371, toRad = d => d * Math.PI / 180;
      const dLat = toRad(pLat - userLat);
      const dLng = toRad(pLng - userLng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(userLat)) * Math.cos(toRad(pLat)) * Math.sin(dLng/2)**2;
      distanceKm = Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
    }

    // rating (se houver avaliacoes)
    const notas = (prof.avaliacoes || []).map(a => Number(a?.nota)).filter(n => n >= 1 && n <= 5);
    const rating = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : 0;

    return res.json({
      ok: true,
      item: {
        id: String(prof.id),
        nome: prof.nome || "",

        // foto - ambos
        foto,
        fotoUrl: foto,

        // descrição - ambos
        descricao,
        bio: descricao,

        // experiência - ambos
        experiencia,
        experienciaTempo: experiencia,

        servico,
        servicoSlug: prof.servicoSlug || null,
        cidade,
        bairro,

        lat: Number.isFinite(pLat) ? pLat : null,
        lng: Number.isFinite(pLng) ? pLng : null,
        distanceKm,

        email: prof.email || "",
        whatsapp,
        telefone,
        site,
        precoBase,

        verificado: !!prof.verificado,
        mediaAvaliacao: Number(prof.mediaAvaliacao || rating || 0),
        totalAvaliacoes: Number(prof.totalAvaliacoes || (prof.avaliacoes?.length || 0)),
        criadoEm: prof.criadoEm || null
      }
    });
  } catch (e) {
    console.error("[ERR /api/profissionais/:id]", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Compat: /api/profissional/:id  (mantém formato legado)
app.get("/api/profissional/:id", (req, res) => {
  try {
    const raw = String(req.params.id || "").trim();
    if (!raw) return res.status(400).json({ ok: false, error: "id inválido" });

    const db = (typeof readDB === "function" ? readDB() : readJSONSafe(DB_FILE, [])) || [];
    if (!Array.isArray(db)) return res.status(500).json({ ok: false });

    const p =
      db.find(x => String(x.id) === raw) ||
      db.find(x => Number(x.id) === Number(raw));
    if (!p) return res.status(404).json({ ok: false });

    const notas = (p.avaliacoes || []).map(a => Number(a.nota)).filter(n => n >= 1 && n <= 5);
    const rating = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : 0;

    const experienciaNum = typeof p.experiencia === "number"
      ? p.experiencia
      : Number(String(p.experiencia || "").replace(/\D/g, "")) || null;

    res.json({
      ok: true,
      id: p.id,
      nome: p.nome,
      foto: p.foto || p.fotoUrl || "",
      servico: p.servico || p.profissao || "",
      cidade: p.cidade || "",
      bairro: p.bairro || "",
      descricao: p.descricao || p.bio || "",
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
      experiencia: experienciaNum,
      distanceKm: typeof p.distanceKm === "number" ? p.distanceKm : null
    });
  } catch (e) {
    console.error("[ERR /api/profissional/:id]", e);
    return res.status(500).json({ ok: false });
  }
});

// =========================[ Avaliações ]=======================
app.get("/api/avaliacoes/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "id inválido" });

  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);
  if (!p) return res.status(404).json({ ok: false, error: "não encontrado" });

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));

  const list = Array.isArray(p.avaliacoes) ? p.avaliacoes : [];
  const total = list.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = list.slice(start, end);

  res.json({ ok: true, total, items: slice });
});

// Anti-spam por cookie/IP
function ensureReviewCookie(req, res) {
  const raw = req.cookies || {};
  if (raw && raw.rev_uid) return raw.rev_uid;

  const uid = crypto.randomBytes(12).toString("hex");
  res.cookie("rev_uid", uid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SECURE_COOKIES === "true",
    maxAge: 180 * 24 * 3600 * 1000,
    path: "/",
  });
  return uid;
}

app.post("/api/avaliacoes", reviewsLimiter, (req, res) => {
  try {
    const proId = Number(req.body?.proId || "0");
    const nota = Number(req.body?.nota || 0);
    const comentario = trim(req.body?.comentario || "");
    const autor = trim(req.body?.autor || "Cliente");

    if (!Number.isFinite(proId) || proId <= 0) return res.status(400).json({ ok: false, error: "proId inválido" });
    if (!(nota >= 1 && nota <= 5)) return res.status(400).json({ ok: false, error: "nota inválida" });
    if (comentario.length < 5) return res.status(400).json({ ok: false, error: "comentário muito curto" });

    const db = readDB();
    const p = db.find((x) => Number(x.id) === proId && !x.excluido);
    if (!p) return res.status(404).json({ ok: false, error: "profissional não encontrado" });

    const uid = ensureReviewCookie(req, res);
    const ip = getIP(req);

    // Bloqueio: mesmo cookie/ip em 12h
    const twelveH = Date.now() - 12 * 3600 * 1000;
    const recent = (p.avaliacoes || []).some((a) => {
      const t = Date.parse(a.at || "");
      return a.meta && (a.meta.ip === ip || a.meta.uid === uid) && Number.isFinite(t) && t >= twelveH;
    });
    if (recent) return res.status(429).json({ ok: false, error: "aguarde para avaliar novamente" });

    (p.avaliacoes ||= []).push({ autor, nota, comentario, at: nowISO(), meta: { ip, uid } });
    writeDB(db);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST (compat do formulário)
app.post("/profissional/:id/avaliar", (req, res) => {
  const id = Number(req.params.id || "0");
  try {
    const autor = trim(req.body.autor);
    const nota = Number(req.body.nota);
    const comentario = trim(req.body.comentario);

    if (!(nota >= 1 && nota <= 5) || comentario.length < 5) {
      return res.status(400).send(htmlMsg("Erro", "Nota/comentário inválidos.", "/clientes.html"));
    }

    const db = readDB();
    const p = db.find((x) => Number(x.id) === id && !x.excluido);
    if (!p) return res.status(404).send(htmlMsg("Erro", "Profissional não encontrado.", "/clientes.html"));

    (p.avaliacoes ||= []).push({ autor, nota, comentario, at: nowISO(), ip: getIP(req) });
    writeDB(db);

    return res.redirect(`/perfil.html?id=${id}&ok=1`);
  } catch (e) {
    return res.status(500).send(htmlMsg("Erro", String(e), `/perfil.html?id=${id}`));
  }
});

// Página de avaliação (HTML) — mantida
app.get("/avaliar/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);

  if (!p) {
    return res.status(404).send(htmlMsg("Não encontrado", "Profissional não localizado.", "/clientes.html"));
  }

  const avals = (p.avaliacoes || []).slice().reverse().slice(0, 30);
  const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

  const itens = avals
    .map((a) => {
      const nota = Math.max(1, Math.min(5, Number(a.nota) || 0));
      const when = a.at ? new Date(a.at).toLocaleString() : "";
      return `
        <li class="cmt">
          <div class="cmt-head">
            <strong>${escapeHTML(a.autor || "Cliente")}</strong>
            <span class="stars" aria-label="nota ${nota} de 5">${stars(nota)}</span>
          </div>
          <div class="cmt-body">${escapeHTML(a.comentario || "")}</div>
          <div class="cmt-meta">${escapeHTML(when)}</div>
        </li>`;
    })
    .join("");

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
          <img alt="Foto de ${escapeHTML(p.nome)}" src="${escapeHTML(p.foto || "/img/placeholder.png")}" />
          <div>
            <h1 class="title">Avaliar ${escapeHTML(p.nome)}</h1>
            <p class="subtitle">${escapeHTML(p.servico || p.profissao || "")} • ${escapeHTML(p.bairro || "")} — ${escapeHTML(p.cidade || "")}</p>
            ${p.verificado ? `VERIFICADO` : ``}
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
            ${itens || `- Sem comentários ainda.`}
          </ul>
        </div>
      </div>
      <div class="foot">
        <a href="/clientes.html">← Voltar para a busca</a>
        <span class="meta">Autônoma.app</span>
      </div>
    </div>
  </div>
</body></html>`);
});

// SSR leve /profissional/:id
app.get("/profissional/:id", (req, res) => {
  const idNum = Number(req.params.id || "0");
  if (!Number.isFinite(idNum) || idNum <= 0) return res.redirect("/clientes.html");
  return res.redirect(`/perfil.html?id=${idNum}`);
});

// =======================[ Métricas/Tracking ]===================
function appendMetric(key, payload) {
  const metr = readJSON(METRICS_FILE, {});
  const day = new Date().toISOString().slice(0, 10);
  metr[key] ||= {};
  metr[key][day] ||= [];
  metr[key][day].push(payload);
  writeJSON(METRICS_FILE, metr);
}

app.post("/api/track/visit/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);
  if (p) {
    p.visitas = (p.visitas || 0) + 1;
    (p.visitsLog ||= []).push({ at: nowISO(), ip: getIP(req) });
    writeDB(db);
    appendMetric("visit", { id, at: nowISO() });
  }
  res.json({ ok: true });
});

app.post("/api/track/call/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);
  if (p) {
    p.chamadas = (p.chamadas || 0) + 1;
    (p.callsLog ||= []).push({ at: nowISO(), ip: getIP(req) });
    writeDB(db);
    appendMetric("call", { id, at: nowISO() });
  }
  res.json({ ok: true });
});

app.post("/api/track/qr/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);
  if (p) {
    (p.qrLog ||= []).push({ at: nowISO(), ip: getIP(req) });
    writeDB(db);
    appendMetric("qr", { id, at: nowISO() });
  }
  res.json({ ok: true });
});

// ===========================[ QR CODE ]=========================
app.get("/api/qr", async (req, res) => {
  try {
    let text = "";
    if (req.query.phone) {
      const d = String(req.query.phone).replace(/\D/g, "");
      if (!d) return res.status(400).json({ ok: false, error: "phone inválido" });
      const msg = String(req.query.text || "").trim();
      text = "https://wa.me/" + d + (msg ? `?text=${encodeURIComponent(msg)}` : "");
    } else if (req.query.text) {
      text = String(req.query.text);
    } else {
      return res.status(400).json({ ok: false, error: "informe text ou phone" });
    }
    res.type("png");
    await QRCode.toFileStream(res, text, { width: 256, margin: 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =========================[ Top 10 semanal ]====================
function weekKeyFor(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const onejan = new Date(y, 0, 1);
  const day = Math.floor((dt - onejan) / 86400000);
  const wk = Math.ceil((day + onejan.getDay() + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}
function scoreTop10(p) {
  const notas = (p.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
  const rating = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
  const thisWeek = weekKeyFor(new Date());
  const calls = (p.callsLog || []).filter((x) => weekKeyFor(x.at) === thisWeek).length;
  const sevenAgo = Date.now() - 6 * 86400000;
  const visits = (p.visitsLog || []).filter((x) => Date.parse(x.at) >= sevenAgo).length;
  const planBoost = p.plano === "premium" ? 1 : p.plano === "pro" ? 0.5 : 0;
  return calls * 2 + visits * 0.5 + rating * 3 + (p.verificado ? 0.5 : 0) + planBoost;
}
app.get("/api/top10", (req, res) => {
  const cidade = norm(trim(req.query.cidade || ""));
  const serv = norm(trim(req.query.servico || ""));
  const db = readDB().filter((p) => !p.suspenso && !p.excluido);
  let list = db;

  if (cidade) list = list.filter((p) => norm(p.cidade).includes(cidade));
  if (serv) list = list.filter((p) => norm(p.servico || p.profissao).includes(serv));

  list = list
    .map((p) => ({ ...p, topScore: scoreTop10(p) }))
    .sort((a, b) => b.topScore - a.topScore)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      foto: p.foto || "",
      servico: p.servico || p.profissao || "",
      cidade: p.cidade || "",
      bairro: p.bairro || "",
      atendimentos: p.atendimentos || 0,
      rating: (p.avaliacoes || []).length
        ? p.avaliacoes.reduce((a, c) => a + Number(c.nota || 0), 0) / p.avaliacoes.length
        : 0,
      badge: p.plano === "premium" ? "PREMIUM" : p.plano === "pro" ? "PRO" : "",
    }));

  res.json({ ok: true, week: weekKey(), items: list });
});
 // ===== WhatsApp sender (STUB ou Cloud API real) =================
async function sendWhatsAppMessage(toDigits55, text) {
  try {
    const token = process.env.WA_TOKEN;      // token permanente
    const phoneId = process.env.WA_PHONE_ID; // phone number ID
    if (!token || !phoneId) {
      console.warn("[WHATSAPP] Faltam WA_TOKEN/WA_PHONE_ID — usando stub");
      console.log("[WHATSAPP][STUB] ->", toDigits55, "MSG:", text);
      return true;
    }
    const url = `https://graph.facebook.com/v22.0/${phoneId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: toDigits55, // E.164 (ex: 5521971891276)
      type: "text",
      text: { body: text },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error("[WHATSAPP] Erro", r.status, body);
      return false;
    }
    console.log("[WHATSAPP] Enviado com sucesso para", toDigits55);
    return true;
  } catch (e) {
    console.error("[WHATSAPP] Exception", e);
    return false;
  }
}
function random6() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ========= Reset de PIN por WhatsApp ===========================
// 1) Solicitar código: cria token 6 dígitos e envia via WhatsApp
app.post("/api/painel/reset-pin/request", async (req, res) => {
  try {
    const phoneRaw = String(req.body?.phone || "").trim();
    const phoneDigits = ensureBR(onlyDigits(phoneRaw));
    if (!/^\d{12,13}$/.test(phoneDigits)) {
      return res.status(400).json({ ok: false, error: "phone_required" });
    }
    const db = readDB();
    const p = db.find((x) => ensureBR(onlyDigits(x.whatsapp || "")) === phoneDigits && !x.excluido);
    if (!p) return res.status(404).json({ ok: false, error: "not_found" });

    const code = random6();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos
    p.pinReset = { code, expiresAt, sentAt: Date.now() };
    writeDB(db);

    const msg = `Autônoma.app\nSeu código para redefinir PIN é: ${code}\nVálido por 10 minutos.\nSe não foi você, ignore.`;
    await sendWhatsAppMessage(phoneDigits, msg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2) Confirmar reset: valida código e define novo PIN (hash bcrypt)
app.post("/api/painel/reset-pin/confirm", (req, res) => {
  try {
    const phoneRaw = String(req.body?.phone || "").trim();
    const code = String(req.body?.code || "").trim();
    const newPin = String(req.body?.newPin || "").trim();
    const phoneDigits = ensureBR(onlyDigits(phoneRaw));

    if (!/^\d{12,13}$/.test(phoneDigits)) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "code_invalid" });
    if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ ok: false, error: "pin_invalid_format" });

    const db = readDB();
    const p = db.find((x) => ensureBR(onlyDigits(x.whatsapp || "")) === phoneDigits && !x.excluido);
    if (!p) return res.status(404).json({ ok: false, error: "not_found" });

    const pr = p.pinReset || {};
    if (!pr.code || !pr.expiresAt) return res.status(400).json({ ok: false, error: "no_request" });
    if (Date.now() > Number(pr.expiresAt)) return res.status(400).json({ ok: false, error: "code_expired" });
    if (String(pr.code) !== code) return res.status(400).json({ ok: false, error: "code_invalid" });

    try {
      p.pinHash = bcrypt.hashSync(newPin, 10);
    } catch {
      return res.status(500).json({ ok: false, error: "hash_error" });
    }
    p.mustSetPin = false;
    p.pinReset = null;
    writeDB(db);

    // cria sessão painel
    if (!req.session) req.session = {};
    req.session.painel = { ok: true, proId: p.id, when: Date.now() };
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =====================[ Painel do Profissional ]================
app.get("/api/painel/me", (req, res) => {
  try {
    const db = readDB();
    let pro = null;

    // sessão ativa
    if (req.session?.painel?.ok) {
      pro = db.find((p) => Number(p.id) === Number(req.session.painel.proId) && !p.excluido);
    }
    // fallback: Authorization: Bearer 55DDDNUMERO
    if (!pro) {
      const auth = String(req.headers.authorization || "");
      if (auth.startsWith("Bearer ")) {
        const tok = ensureBR(onlyDigits(auth.slice(7)));
        if (tok && /^\d{12,13}$/.test(tok)) {
          pro = db.find((p) => ensureBR(onlyDigits(p.whatsapp)) === tok && !p.excluido);
          if (pro) req.session.painel = { ok: true, proId: pro.id, when: Date.now() };
        }
      }
    }
    if (!pro) return res.status(401).json({ ok: false });

    const notas = (pro.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
    const rating = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
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
      email: pro.email || "",
      email: pro.email || "",
      atendimentos: pro.atendimentos || 0,
      avaliacoes: pro.avaliacoes || [],
      visitas: pro.visitas || 0,
      chamadas: pro.chamadas || 0,
      rating,
      verificado: !!pro.verificado,
      suspenso: !!pro.suspenso,
      plano: pro.plano || "free",
      raioKm: Number(pro.raioKm || 0),
      cidadesExtras: Array.isArray(pro.cidadesExtras) ? pro.cidadesExtras : [],
      radar: pro.radar || { on: false, until: null, lastOnAt: null },
      receiveViaApp: !!pro.receiveViaApp,
      needPinSetup: !!pro.mustSetPin || !pro.pinHash,
      fees,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Painel HTML (agora usa o middleware requireProAuth para proteção)
app.get("/painel.html", requireProAuth, (_req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, "painel.html"));
});

// Login do Painel (WhatsApp + PIN)
app.post("/api/painel/login", loginLimiter, (req, res) => {
  try {
    const phone = ensureBR(onlyDigits(req.body?.phone || req.body?.token || ""));
    const pin = String(req.body?.pin || "").trim();
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

    const db = readDB();
    const pro = db.find((p) => ensureBR(onlyDigits(p.whatsapp)) === phone && !p.excluido);
    if (!pro) return res.status(401).json({ ok: false, error: "not_found" });

    // Validação do formato do PIN (4 a 6 dígitos numéricos) para login
    if (!/^[0-9]{4,6}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: "pin_invalid_format" });
    }

    // precisa configurar PIN
    if (!pro.pinHash) {
      pro.mustSetPin = true;
      writeDB(db);
      return res.status(409).json({ ok: false, error: "pin_not_set", needPinSetup: true });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: "pin_invalid_format" });
    }

    const ok = bcrypt.compareSync(pin, pro.pinHash);
    if (!ok) return res.status(401).json({ ok: false, error: "pin_incorrect" });

    req.session.painel = { ok: true, proId: pro.id, when: Date.now() };
    req.session.usuarioId = pro.usuarioId; // Adicionar para compatibilidade com o novo requireProAuth

    // Redirecionamento correto: usa a URL salva ou o padrão (Problema 1)
    const redirectTo = req.session.redirectTo || "/painel.html";
    delete req.session.redirectTo; // Limpa a URL salva
    
    req.session.save((err) => {
      if (err) console.error("Erro ao salvar sessão após login:", err);
      return res.json({ ok: true, redirect: redirectTo });
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Definir ou trocar PIN (6 dígitos)
app.post("/api/painel/set-pin", (req, res) => {
  const s = req.session?.painel;
  if (!s?.ok || !s.proId) return res.status(401).json({ ok: false });
  // O usuário deve estar logado para setar o PIN, então 's.proId' é suficiente.

  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ ok: false, error: "pin_format" });

  const db = readDB();
  const p = db.find((x) => Number(x.id) === Number(s.proId));
  if (!p) return res.status(404).json({ ok: false });

  p.pinHash = bcrypt.hashSync(pin, 10);
  p.mustSetPin = false;
  writeDB(db);
  res.json({ ok: true });
});

app.post("/api/painel/logout", (req, res) => { if (req.session) req.session.painel = null; res.json({ ok: true }); });

app.get("/api/painel/state", (req, res) => {
  const s = req.session?.painel;
  if (!s?.ok || !s.proId) return res.json({ ok: false });
  const db = readDB();
  const p = db.find((x) => Number(x.id) === Number(s.proId));
  if (!p) return res.json({ ok: false });
  res.json({
    ok: true,
    pro: {
      id: p.id, nome: p.nome, plano: p.plano,
      raioKm: p.raioKm, cidadesExtras: p.cidadesExtras || [],
      radar: p.radar || {}, receiveViaApp: !!p.receiveViaApp,
    },
  });
});

function proLimits(p) {
  if (p.plano === "premium") return { maxRaio: 50, maxCidades: 10, uberUnlimited: true, maxUberActivations: Infinity };
  if (p.plano === "pro")      return { maxRaio: 30, maxCidades: 3,  uberUnlimited: false, maxUberActivations: 5 };
  return { maxRaio: 0, maxCidades: 0, uberUnlimited: false, maxUberActivations: 0 };
}

app.post("/api/painel/radar", (req, res) => {
  const s = req.session?.painel; if (!s?.ok || !s?.proId) return res.status(401).json({ ok: false });
  const { on, durationHours } = req.body || {};
  const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId);
  if (!p) return res.status(404).json({ ok: false });

  const nowRef = monthRefOf();
  p.radar ||= { on: false, until: null, lastOnAt: null, monthlyUsed: 0, monthRef: nowRef };
  if (p.radar.monthRef !== nowRef) { p.radar.monthRef = nowRef; p.radar.monthlyUsed = 0; }

  const lim = proLimits(p);
  if (on === true) {
    if (p.plano === "free") return res.status(403).json({ ok: false, error: "Somente Pro/Premium" });
    if (!lim.uberUnlimited && (p.radar.monthlyUsed || 0) >= (lim.maxUberActivations || 0)) {
      return res.status(403).json({ ok: false, error: "Limite mensal" });
    }
    p.radar.on = true;
    p.radar.lastOnAt = nowISO();
    p.radar.monthlyUsed = (p.radar.monthlyUsed || 0) + 1;
    const dur = Number(durationHours);
    p.radar.until = Number.isFinite(dur) && dur > 0 ? new Date(Date.now() + dur * 3600e3).toISOString() : null;
  } else if (on === false) {
    p.radar.on = false; p.radar.until = null;
  }
  writeDB(db);
  res.json({ ok: true, radar: p.radar });
});

app.post("/api/painel/radar/autooff", (req, res) => {
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok: false });
  const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId); if (!p) return res.status(404).json({ ok: false });
  const h = Number((req.body?.hours) ?? null);
  p.radar ||= { on: false, until: null, lastOnAt: null, monthlyUsed: 0, monthRef: monthRefOf() };
  p.radar.until = (Number.isFinite(h) && h > 0) ? new Date(Date.now() + h * 3600e3).toISOString() : null;
  writeDB(db);
  res.json({ ok: true, radar: p.radar });
});

app.post("/api/painel/raio", (req, res) => {
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok: false });
  const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId); if (!p) return res.status(404).json({ ok: false });
  const lim = proLimits(p);
  const r = Number(req.body?.raioKm || 0);
  if (Number.isFinite(r) && r >= 0) { p.raioKm = Math.min(r, lim.maxRaio); }
  writeDB(db);
  res.json({ ok: true, raioKm: p.raioKm });
});

app.post("/api/painel/cidades", (req, res) => {
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok: false });
  const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId); if (!p) return res.status(404).json({ ok: false });
  const lim = proLimits(p);
  const action = String(req.body?.action || "");
  if (action === "add") {
    const cidade = normalizeCidadeUF(String(req.body?.cidade || "")); if (!cidade) return res.status(400).json({ ok: false });
    p.cidadesExtras ||= [];
    if (!p.cidadesExtras.includes(cidade) && p.cidadesExtras.length < lim.maxCidades) p.cidadesExtras.push(cidade);
  } else if (action === "set") {
    const list = Array.isArray(req.body?.list)
      ? req.body.list.map((c) => normalizeCidadeUF(String(c || ""))).filter(Boolean)
      : [];
    p.cidadesExtras = list.slice(0, lim.maxCidades);
  }
  writeDB(db);
  res.json({ ok: true, cidadesExtras: p.cidadesExtras });
});

app.post("/api/painel/payment-prefs", (req, res) => {
  const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok: false });
  const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId); if (!p) return res.status(404).json({ ok: false });
  const receiveViaApp = !!req.body?.receiveViaApp;
  p.receiveViaApp = receiveViaApp; writeDB(db);
  res.json({ ok: true, receiveViaApp });
});

app.post("/api/painel/update",
  (req, res, next) => upload.single("foto")(req, res, (err) => { if (err) return res.status(400).json({ ok: false, error: err.message }); next(); }),
  (req, res) => {
    const s = req.session?.painel; if (!s?.ok) return res.status(401).json({ ok: false });
    const db = readDB(); const p = db.find((x) => Number(x.id) === s.proId); if (!p) return res.status(404).json({ ok: false });
    const nome = trim(req.body?.nome || "");
    const descricao = trim(req.body?.descricao || "");
    const precoBase = trim(req.body?.precoBase || "");
    const site = trim(req.body?.site || "");

    if (nome) p.nome = nome;
    p.descricao = descricao;
    p.precoBase = precoBase;
    p.site = site;
    if (req.file?.filename) p.foto = `/uploads/${req.file.filename}`;
    writeDB(db);
    res.json({ ok: true });
  }
);

app.get("/api/painel/export.csv", (req, res) => {
  const s = req.session?.painel; if (!s?.ok) return res.status(401).type("text").send("login requerido");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === s.proId);
  if (!p) return res.status(404).type("text").send("não encontrado");

  const header = ["campo", "valor"].join(",");
  const notas = (p.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
  const rating = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : "0";
  const rows = [
    ["id", p.id], ["nome", p.nome], ["whatsapp", p.whatsapp], ["cidade", p.cidade], ["bairro", p.bairro],
    ["servico", p.servico || p.profissao || ""], ["plano", p.plano], ["raioKm", p.raioKm],
    ["atendimentos", p.atendimentos || 0], ["visitas", p.visitas || 0], ["chamadas", p.chamadas || 0], ["rating", rating],
  ].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=meu_painel.csv");
  res.send(csv);
});

// ===========================[ Pagamentos ]=====================
function newPaymentId() { return crypto.randomBytes(10).toString("hex"); }

app.get("/api/checkout/options", (_req, res) => {
  res.json({ ok: true, pix: PIX_ENABLED, card: CARD_ENABLED, fees: { cardPercent: FEE_CARD_PERCENT, pixPercent: FEE_PIX_PERCENT } });
});

app.post("/api/checkout/intent", (req, res) => {
  try {
    const { proId, amount, method } = req.body || {};
    const id = Number(proId || "0");
    const amt = Number(amount || 0);
    const m = String(method || "").toLowerCase(); // 'pix' | 'card'
    if (!id || !(m === "pix" || m === "card") || !(amt > 0)) return res.status(400).json({ ok: false });

    const db = readDB();
    const p = db.find((x) => Number(x.id) === id && !x.excluido);
    if (!p) return res.status(404).json({ ok: false });

    const feesPercent = m === "card" ? FEE_CARD_PERCENT : FEE_PIX_PERCENT;
    const appFee = Math.round(amt * (feesPercent / 100) * 100) / 100;
    const toPro = Math.max(0, Math.round((amt - appFee) * 100) / 100);

    const store = readJSON(PAYMENTS_FILE, []);
    const pay = { pid: newPaymentId(), proId: id, method: m, amount: amt, feesPercent, appFee, toPro, status: "pending", createdAt: nowISO() };
    store.push(pay); writeJSON(PAYMENTS_FILE, store);

    res.json({ ok: true, payment: pay });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/checkout/pay/:pid", (req, res) => {
  const pid = String(req.params.pid || "");
  const store = readJSON(PAYMENTS_FILE, []);
  const it = store.find((x) => x.pid === pid);
  if (!it) return res.status(404).json({ ok: false });
  if (it.status !== "pending") return res.json({ ok: true, payment: it });
  it.status = "paid"; it.paidAt = nowISO();
  writeJSON(PAYMENTS_FILE, store);
  res.json({ ok: true, payment: it });
});

app.get("/api/checkout/payment/:pid", (req, res) => {
  const pid = String(req.params.pid || "");
  const store = readJSON(PAYMENTS_FILE, []);
  const it = store.find((x) => x.pid === pid);
  if (!it) return res.status(404).json({ ok: false });
  res.json({ ok: true, payment: it });
});

app.get("/api/checkout/pro/:id", (req, res) => {
  const id = Number(req.params.id || "0");
  const db = readDB();
  const p = db.find((x) => Number(x.id) === id && !x.excluido);
  if (!p) return res.status(404).json({ ok: false });
  res.json({
    ok: true,
    pro: { id: p.id, nome: p.nome, receiveViaApp: !!p.receiveViaApp },
    options: { pix: PIX_ENABLED, card: CARD_ENABLED, fees: { cardPercent: FEE_CARD_PERCENT, pixPercent: FEE_PIX_PERCENT } },
  });
});

// ===========================[ Assinaturas Asaas (Stub) ]======================
app.post("/api/pay/asaas/subscription/create", requireProAuth, (req, res) => {
  try {
    const { proId, plan, buyer } = req.body || {};
    const id = Number(proId || "0");
    const p = readDB().find((x) => Number(x.id) === id && !x.excluido);
    if (!p) return res.status(404).json({ ok: false, error: "Profissional não encontrado" });
    if (!(plan === "pro" || plan === "premium")) return res.status(400).json({ ok: false, error: "Plano inválido" });

    // Simulação da criação de assinatura no Asaas
    // Em um ambiente real, esta função chamaria a API do Asaas para:
    // 1. Criar/Obter o cliente no Asaas (usando CPF/Nome do buyer)
    // 2. Criar a assinatura (Subscription)
    // 3. Obter a URL de checkout (Checkout URL)
    
    // Stub: Retorna uma URL de checkout fictícia que redireciona para o painel
    const checkoutUrl = `/painel.html?payment_status=pending&plan=${plan}&asaas_id=sub_${Date.now()}`;

    res.json({ ok: true, url: checkoutUrl });
  } catch (e) {
    console.error("[ERR /api/pay/asaas/subscription/create]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// ===========================[ Denúncias ]======================
app.post("/api/denuncias", (req, res) => {
  try {
    const body = req.body || {};
    const proId = Number(body.profissional || "0");
    const motivo = trim(body.motivo);
    const detalhes = trim(body.detalhes);
    if (!proId || !motivo) return res.status(400).json({ ok: false, error: "Dados inválidos" });

    const arr = readJSON(DENUNCIAS_FILE, []);
    arr.push({
      id: arr.length ? arr[arr.length - 1].id + 1 : 1,
      proId, motivo, detalhes,
      at: nowISO(), ip: getIP(req),
      resolved: false,
    });
    writeJSON(DENUNCIAS_FILE, arr);
    appendMetric("report", { proId, at: nowISO() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// =====================[ Favoritos (FAV_UID) ]==================
const FAV_FILE = path.join(DATA_DIR, "favorites.json");
if (!fs.existsSync(FAV_FILE)) writeJSON(FAV_FILE, {});
const readFavMap = () => readJSON(FAV_FILE, {});
const writeFavMap = (m) => writeJSON(FAV_FILE, m);

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) {
      const k = p.slice(0, i).trim();
      const v = decodeURIComponent(p.slice(i + 1).trim());
      out[k] = v;
    }
  });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push(`Secure`);
  if (opts.httpOnly) parts.push(`HttpOnly`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function ensureFavUID(req, res) {
  const cookies = parseCookies(req);
  let uid = cookies.FAV_UID || "";
  if (!uid) {
    uid = crypto.randomBytes(12).toString("hex");
    setCookie(res, "FAV_UID", uid, { maxAge: 365 * 24 * 3600 * 1000, path: "/", sameSite: "Lax", secure: false });
  }
  return uid;
}

app.get("/api/favoritos", (req, res) => {
  try {
    const uid = ensureFavUID(req, res);
    const map = readFavMap();
    const ids = Array.isArray(map[uid]) ? map[uid] : [];
    const db = readDB();
    const items = ids
      .map((id) => db.find((p) => Number(p.id) === Number(id) && !p.excluido))
      .filter(Boolean)
      .map((p) => {
        const notas = (p.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
        const rating = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
        return {
          id: p.id,
          nome: p.nome,
          servico: p.servico || p.profissao || "",
          cidade: p.cidade || "",
          bairro: p.bairro || "",
          foto: p.foto || "",
          rating,
        };
      });
    res.json({ ok: true, ids, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/favoritos/toggle", (req, res) => {
  try {
    const uid = ensureFavUID(req, res);
    const id = Number((req.body && req.body.id) || (req.query && req.query.id) || "0");
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "id inválido" });

    const db = readDB();
    const exists = db.some((p) => Number(p.id) === id && !p.excluido);
    if (!exists) return res.status(404).json({ ok: false, error: "profissional não encontrado" });

    const map = readFavMap();
    const list = Array.isArray(map[uid]) ? map[uid] : [];
    const i = list.findIndex((x) => Number(x) === id);
    let action = "";
    if (i >= 0) { list.splice(i, 1); action = "removed"; } else { list.push(id); action = "added"; }
    map[uid] = list; writeFavMap(map);
    res.json({ ok: true, action, ids: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete("/api/favoritos/:id", (req, res) => {
  try {
    const uid = ensureFavUID(req, res);
    const id = Number(req.params.id || "0");
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "id inválido" });
    const map = readFavMap();
    const list = Array.isArray(map[uid]) ? map[uid] : [];
    const i = list.findIndex((x) => Number(x) === id);
    if (i >= 0) { list.splice(i, 1); map[uid] = list; writeFavMap(map); }
    res.json({ ok: true, ids: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});



// ===================[ Admin — login & dashboard ]=================
function requireAdmin(req, res, next) { if (req.session?.isAdmin) return next(); return res.status(401).json({ ok: false }); }

app.get("/admin", (req, res) => {
  if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login");
  return res.redirect("/admin.html");
});

app.get("/admin/login", (_req, res) => {
  const file = path.join(PUBLIC_DIR, "admin-login.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.send(`<!doctype html>
  <meta charset="utf-8"><link rel="stylesheet" href="/css/app.css">
  <div class="wrap"><div class="card" style="max-width:420px;margin:auto">
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
  </div></div>`);
});

app.post("/admin/login", loginLimiter, (req, res) => {
  const user = trim((req.body?.user ?? req.body?.usuario ?? "").toString());
  const pass = (req.body?.password ?? req.body?.senha ?? "").toString();
  const userOk = user === ADMIN_USER;
  let passOk = false;
  if (ADMIN_PASS_HASH) {
    try { passOk = bcrypt.compareSync(pass, ADMIN_PASS_HASH); } catch { passOk = false; }
  } else {
    passOk = pass === ADMIN_PASS;
  }
  if (userOk && passOk) {
    req.session.isAdmin = true;
    req.session.adminAt = Date.now();
    return res.redirect("/admin.html");
  }
  return res.status(401).send(htmlMsg("Login inválido", "Usuário/senha incorretos.", "/admin/login"));
});

app.post("/admin/logout", (req, res) => { if (req.session) req.session.isAdmin = false; res.redirect("/admin/login"); });
app.get("/admin.html", (req, res) => { if (!(req.session && req.session.isAdmin)) return res.redirect("/admin/login"); return res.sendFile(path.join(PUBLIC_DIR, "admin.html")); });

// ---- helpers/relatórios do admin ----
function adminBuildStats() {
  const db = readDB().filter((p) => !p.excluido);
  const metr = readJSON(METRICS_FILE, {});
  const total = db.length;
  const ativos = db.filter((p) => !p.suspenso).length;
  const suspensos = db.filter((p) => p.suspenso).length;
  const excluidos = readDB().filter((p) => p.excluido).length;
  const verificados = db.filter((p) => computeVerified(p)).length;
  const mediaRating = (() => {
    const arr = db.map((p) => {
      const ns = (p.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
    }).filter((x) => x > 0);
    return arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;
  })();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600e3).toISOString().slice(0, 10);
    const v = (metr.visit?.[d] || []).length || 0;
    const c = (metr.call?.[d] || []).length || 0;
    const q = (metr.qr?.[d] || []).length || 0;
    days.push({ day: d, visits: v, calls: c, qrs: q });
  }
  return { ok: true, counters: { total, ativos, suspensos, excluidos, verificados, mediaRating }, last30: days };
}
function adminBuildList(query) {
  const db = readDB().filter((p) => !p.excluido);
  const q = (query?.q || "").toString().trim();
  const cidade = (query?.cidade || "").toString().trim();
  const serv = (query?.servico || query?.profissao || "").toString().trim();
  let items = db;
  const N = (s) => norm(String(s || ""));
  if (q) {
    const QQ = N(q);
    items = items.filter((p) =>
      N(p.nome).includes(QQ) ||
      N(p.bairro || "").includes(QQ) ||
      N(p.cidade || "").includes(QQ) ||
      N(p.servico || p.profissao || "").includes(QQ)
    );
  }
  if (cidade) items = items.filter((p) => N(p.cidade || "").includes(N(cidade)));
  if (serv) items = items.filter((p) => N(p.servico || p.profissao || "").includes(N(serv)));
  items.sort((a, b) => Number(b.id) - Number(a.id));
  return items.map((p) => ({
    id: p.id, nome: p.nome, servico: p.servico || p.profissao || "",
    cidade: p.cidade || "", bairro: p.bairro || "",
    visitas: p.visitas || 0, chamadas: p.chamadas || 0,
    rating: (p.avaliacoes || []).length
      ? (p.avaliacoes.reduce((a, c) => a + Number(c.nota || 0), 0) / (p.avaliacoes.length))
      : 0,
    plano: p.plano || "free", verificado: !!p.verificado,
  }));
}

// ---- APIs admin ----
app.get("/api/admin/session", (_req, res) => { const isAdmin = !!(_req.session && _req.session.isAdmin); res.json({ ok: true, isAdmin }); });
app.get("/api/admin/stats", requireAdmin, (_req, res) => res.json(adminBuildStats()));
app.get("/api/admin/list", requireAdmin, (req, res) => res.json({ ok: true, items: adminBuildList(req.query || {}) }));

// Lista com filtros + paginação
app.get("/api/admin/profissionais", requireAdmin, (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const cidadeQ = String(req.query.cidade || "").trim();
    const servQ = String(req.query.servico || "").trim();
    const verifQ = String(req.query.verificado || "all");
    const statusQ = String(req.query.status || "all");
    const sort = String(req.query.sort || "recent");
    const dirAsc = String(req.query.dir || "desc").toLowerCase() === "asc";
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const N = (s) => norm(String(s || ""));

    let items = readDB().slice();
    if (statusQ === "ativos") items = items.filter((p) => !p.excluido && !p.suspenso);
   else if (statusQ === "suspensos") items = items.filter((p) => p.suspenso && !p.excluido);
    else if (statusQ === "excluidos") items = items.filter((p) => p.excluido);

    if (q) {
      const QQ = N(q);
      items = items.filter(
        (p) =>
          N(p.nome).includes(QQ) ||
          N(p.bairro || "").includes(QQ) ||
          N(p.cidade || "").includes(QQ) ||
          N(p.servico || p.profissao || "").includes(QQ)
      );
    }
    if (cidadeQ) {
      const C = N(cidadeQ);
      items = items.filter((p) => N(p.cidade || "").includes(C));
    }
    if (servQ) {
      const S = N(servQ);
      items = items.filter((p) => N(p.servico || p.profissao || "").includes(S));
    }
    if (verifQ === "true") items = items.filter((p) => computeVerified(p));
    if (verifQ === "false") items = items.filter((p) => !computeVerified(p));

    // campos auxiliares
    items = items.map((p) => {
      const notas = (p.avaliacoes || []).map((a) => Number(a.nota)).filter((n) => n >= 1 && n <= 5);
      const rating = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
      return {
        id: p.id,
        nome: p.nome,
        foto: p.foto || "",
        cidade: p.cidade || "",
        bairro: p.bairro || "",
        servico: p.servico || p.profissao || "",
        verificado: computeVerified(p),
        rating,
        avalCount: (p.avaliacoes || []).length,
        visitas: p.visitas || 0,
        chamadas: p.chamadas || 0,
        plano: p.plano || "free",
        suspenso: !!p.suspenso,
        excluido: !!p.excluido,
      };
    });

    // ordenação
    const cmpNum = (a, b, k) => Number(a[k] || 0) - Number(b[k] || 0);
    const cmpStr = (a, b, k) => String(a[k] || "").localeCompare(String(b[k] || ""), "pt-BR");

    items.sort((a, b) => {
      let v = 0;
      switch (sort) {
        case "recent":
          v = Number(b.id) - Number(a.id);
          break;
        case "nome":
          v = cmpStr(a, b, "nome");
          break;
        case "cidade":
          v = cmpStr(a, b, "cidade");
          break;
        case "servico":
          v = cmpStr(a, b, "servico");
          break;
        case "verificado":
          v = a.verificado === b.verificado ? 0 : a.verificado ? 1 : -1;
          break;
        case "avaliacoes":
          v = cmpNum(a, b, "avalCount");
          break;
        case "rating":
          v = cmpNum(a, b, "rating");
          break;
        case "visitas":
          v = cmpNum(a, b, "visitas");
          break;
        case "chamadas":
          v = cmpNum(a, b, "chamadas");
          break;
        default:
          v = Number(b.id) - Number(a.id);
      }
      return dirAsc ? v : -v;
    });

    const total = items.length;
    const start = (page - 1) * limit;
    const slice = items.slice(start, start + limit);
    res.json({ ok: true, total, page, pages: Math.max(1, Math.ceil(total / limit)), items: slice });
  } catch (e) {
    console.error("ERR /api/admin/profissionais", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Ações: suspender / ativar / excluir / restaurar
app.post("/api/admin/profissionais/:id/suspender", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const db = readDB();
    const p = db.find((x) => Number(x.id) === id);
    if (!p) return res.status(404).json({ ok: false });
    p.suspenso = true;
    p.suspensoMotivo = trim(req.body?.motivo || "");
    p.suspensoEm = nowISO();
    writeDB(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/admin/profissionais/:id/ativar", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const db = readDB();
    const p = db.find((x) => Number(x.id) === id);
    if (!p) return res.status(404).json({ ok: false });
    p.suspenso = false;
    p.suspensoMotivo = "";
    writeDB(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete("/api/admin/profissionais/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const db = readDB();
    const p = db.find((x) => Number(x.id) === id);
    if (!p) return res.status(404).json({ ok: false });
    p.excluido = true;
    console.log(`[DELETE] Profissional ${id} marcado como excluido: ${p.excluido}`);
    p.excluidoEm = nowISO();
    writeDB(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/admin/profissionais/:id/restaurar", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const db = readDB();
    const p = db.find((x) => Number(x.id) === id);
    if (!p) return res.status(404).json({ ok: false });
    p.excluido = false;
    p.excluidoEm = null;
    writeDB(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Denúncias (admin): listagem e atualização de status
app.get("/api/admin/denuncias", requireAdmin, (req, res) => {
  try {
    const statusQ = String(req.query.status || "all");
    const q = String(req.query.q || "").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const arr = readJSON(DENUNCIAS_FILE, []).slice();

    // normalizar legado
    arr.forEach((d) => {
      if (!d.status) d.status = d.resolved === true ? "resolvida" : "aberta";
      if (!d.createdAt) d.createdAt = d.at || nowISO();
    });

    let list = arr;
    if (statusQ !== "all") list = list.filter((d) => String(d.status || "aberta") === statusQ);
    if (q) {
      list = list.filter((d) => {
        const txt = [
          d.motivo || "",
          d.detalhes || "",
          d.profissionalNome || "",
          String(d.profissional || d.proId || ""),
        ]
          .join(" ")
          .toLowerCase();
        return txt.includes(q);
      });
    }

    // enrich
    const db = readDB();
    list = list.map((d) => {
      const proId = Number(d.profissional || d.proId || 0);
      const pro = db.find((p) => Number(p.id) === proId);
      return {
        id: d.id,
        createdAt: d.createdAt || d.at || "",
        motivo: d.motivo || "",
        status: d.status || "aberta",
        profissional: pro ? { id: pro.id, nome: pro.nome, cidade: pro.cidade || "", bairro: pro.bairro || "" } : {},
      };
    });

    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const total = list.length;
    const start = (page - 1) * limit;
    const slice = list.slice(start, start + limit);
    res.json({ ok: true, total, page, pages: Math.max(1, Math.ceil(total / limit)), items: slice });
  } catch (e) {
    console.error("ERR /api/admin/denuncias", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/admin/denuncias/:id/status", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const status = String(req.body?.status || "").trim(); // aberta|em_analise|resolvida|descartada
    if (!["aberta", "em_analise", "resolvida", "descartada"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status inválido" });
    }
    const arr = readJSON(DENUNCIAS_FILE, []);
    const it = arr.find((d) => Number(d.id) === id);
    if (!it) return res.status(404).json({ ok: false });
    it.status = status;
    if (status === "resolvida") it.resolved = true;
    writeJSON(DENUNCIAS_FILE, arr);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Métricas para o admin (contadores + séries)
app.get("/api/admin/metrics", requireAdmin, (_req, res) => {
  try {
    const stats = adminBuildStats(); // counters + last30
    const metr = readJSON(METRICS_FILE, {});
    const today = new Date().toISOString().slice(0, 10);
    const todayVisits = (metr.visit?.[today] || []).length || 0;
    const todayCalls = (metr.call?.[today] || []).length || 0;
    const todayQrs = (metr.qr?.[today] || []).length || 0;

    const series = {
      visits: stats.last30.map((d) => ({ x: d.day, y: d.visits })),
      calls: stats.last30.map((d) => ({ x: d.day, y: d.calls })),
      qrs: stats.last30.map((d) => ({ x: d.day, y: d.qrs })),
    };

    res.json({
      ok: true,
      counters: stats.counters,
      last30: stats.last30,
      series,
      today: { visits: todayVisits, calls: todayCalls, qrs: todayQrs },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Listagem de pagamentos (admin)
app.get("/api/admin/payments", requireAdmin, (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "all"); // pending|paid|all
    const method = String(req.query.method || "all"); // pix|card|all

    let arr = readJSON(PAYMENTS_FILE, []).slice();
    if (status !== "all") arr = arr.filter((p) => p.status === status);
    if (method !== "all") arr = arr.filter((p) => p.method === method);
    if (q) {
      arr = arr.filter((p) => {
        const text = [
          p.pid,
          String(p.proId),
          p.method,
          p.status,
          String(p.amount || ""),
          String(p.appFee || ""),
          String(p.toPro || ""),
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(q);
      });
    }

    const db = readDB();
    const withPro = arr.map((it) => {
      const pro = db.find((x) => Number(x.id) === Number(it.proId));
      return {
        ...it,
        pro: pro ? { id: pro.id, nome: pro.nome, cidade: pro.cidade || "", bairro: pro.bairro || "" } : null,
      };
    });

    withPro.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const total = withPro.length;
    const start = (page - 1) * limit;
    const items = withPro.slice(start, start + limit);
    res.json({ ok: true, total, page, pages: Math.max(1, Math.ceil(total / limit)), items });
  } catch (e) {
    console.error("ERR /api/admin/payments", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Exportações Admin
app.get("/api/admin/export/csv", requireAdmin, (req, res) => {
  try {
    // Reutiliza listagem com filtros atuais
    const req2 = { ...req, method: "GET", url: "/api/admin/profissionais", query: req.query, session: req.session };
    let data = null;
    const res2 = { json(x) { data = x; } };
    app._router.handle(req2, res2, () => {});
    setTimeout(() => {
      const d = data || {};
      const header = [
        "id","nome","cidade","bairro","servico","verificado","rating","avaliacoes","visitas","chamadas","plano","suspenso","excluido"
      ].join(",");
      const rows = (d.items || []).map((p) => {
        const vals = [
          p.id, p.nome, p.cidade, p.bairro, p.servico, p.verificado,
          (Number(p.rating) || 0).toFixed(2), p.avalCount, p.visitas, p.chamadas, p.plano, p.suspenso, p.excluido
        ];
        return vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=profissionais.csv");
      res.send(csv);
    }, 0);
  } catch (e) {
    res.status(500).type("text").send("erro");
  }
});

// Admin: resetar PIN do profissional (obriga definir no próximo login)
app.post("/api/admin/profissionais/:id/reset-pin", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id || "0");
    const db = readDB();
    const p = db.find((x) => Number(x.id) === id);
    if (!p) return res.status(404).json({ ok: false });
    p.pinHash = null;
    p.mustSetPin = true;
    writeJSON(DB_FILE, db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// /api/admin/export?what=profissionais|payments|metrics
app.get("/api/admin/export", requireAdmin, (req, res) => {
  try {
    const what = String(req.query.what || "profissionais");

    if (what === "payments") {
      const arr = readJSON(PAYMENTS_FILE, []);
      const header = ["pid","proId","method","status","amount","feesPercent","appFee","toPro","createdAt","paidAt"].join(",");
      const rows = arr.map((p) => {
        const vals = [p.pid, p.proId, p.method, p.status, p.amount, p.feesPercent, p.appFee, p.toPro, p.createdAt || "", p.paidAt || ""];
        return vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=payments.csv");
      return res.send(csv);
    }

    if (what === "metrics") {
      const metr = readJSON(METRICS_FILE, {});
      const dayKeys = new Set([
        ...Object.keys(metr.visit || {}),
        ...Object.keys(metr.call || {}),
        ...Object.keys(metr.qr || {}),
      ]);
      const header = ["day","visits","calls","qrs"].join(",");
      const rows = Array.from(dayKeys)
        .sort()
        .map((d) => {
          const v = (metr.visit?.[d] || []).length || 0;
          const c = (metr.call?.[d] || []).length || 0;
          const q = (metr.qr?.[d] || []).length || 0;
          return `"${d}",${v},${c},${q}`;
        });
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=metrics.csv");
      return res.send(csv);
    }

    // default: profissionais (sem filtros)
    const db = readDB().filter((p) => !p.excluido);
    const header = ["id","nome","whatsapp","cidade","bairro","servico","plano","raioKm","visitas","chamadas","rating"].join(",");
    const rows = db.map((p) => {
      const rating = (p.avaliacoes || []).length
        ? p.avaliacoes.reduce((a, c) => a + Number(c.nota || 0), 0) / p.avaliacoes.length
        : 0;
      const vals = [p.id, p.nome, p.whatsapp, p.cidade, p.bairro, (p.servico || p.profissao || ""), p.plano, (p.raioKm || 0), (p.visitas || 0), (p.chamadas || 0), rating.toFixed(2)];
      return vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=profissionais_all.csv");
    return res.send(csv);
  } catch (e) {
    res.status(500).type("text").send("erro");
  }
});


// Dump completo (somente admin) — útil p/ backup/debug
app.get("/api/admin/_dump_all", requireAdmin, (_req, res) => {
  const dump = {
    profissionais: readDB(),
    denuncias: readJSON(DENUNCIAS_FILE, []),
    payments: readJSON(PAYMENTS_FILE, []),
    metrics: readJSON(METRICS_FILE, {}),
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(dump, null, 2));
});

// === Compat extra de avaliações ===
app.get("/api/profissional/:id/avaliacoes", (req, res) => {
  const id = String(req.params.id || "");
  const db = readDB();
  const pro = db.find((x) => String(x.id) === id);
  if (!pro) return res.json([]);
  res.json(pro.avaliacoes || []);
});

app.post("/api/profissional/:id/avaliar", express.json(), (req, res) => {
  const id = String(req.params.id || "");
  const db = readDB();
  const pro = db.find((x) => String(x.id) === id);
  if (!pro) return res.status(404).json({ ok: false, msg: "Profissional não encontrado" });
  const { nome, nota, texto } = req.body || {};
  if (!texto && !nota) return res.status(400).json({ ok: false, msg: "Comentário ou nota obrigatórios" });
  if (!Array.isArray(pro.avaliacoes)) pro.avaliacoes = [];
  pro.avaliacoes.unshift({
    nome: nome || "Cliente",
    nota: Number(nota) || 0,
    texto: texto || "",
    data: new Date().toISOString(),
  });
  writeDB(db);
  res.json({ ok: true });
});

// ===== Inicialização compatível com Railway =====
const PORT = Number(process.env.PORT || 8080);
// Não passe HOST aqui; sem host o Express usa 0.0.0.0
app.listen(PORT, () => {
  console.log(`[BOOT] Autônoma.app rodando na porta ${PORT}`);
});