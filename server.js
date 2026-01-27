// ======================================================================
// AUTÔNOMA.APP — SERVER.JS
// PARTE 1/5 — BASE + CONFIG + UPLOAD DE FOTO
// ======================================================================

require('dotenv').config()

// -------------------------------
// IMPORTS
// -------------------------------
const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const multer = require('multer')
const { PrismaClient } = require('@prisma/client')
const SibApiV3Sdk = require('sib-api-v3-sdk')

// -------------------------------
// APP + PRISMA
// -------------------------------
const app = express()
const prisma = new PrismaClient()


// -------------------------------
// ASAAS (CONFIG ÚNICA)
// -------------------------------
const ASAAS_API_URL =
  process.env.ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3'

const asaasApi = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'Content-Type': 'application/json',
    access_token: process.env.ASAAS_API_KEY
  }
})

// -------------------------------
// UPLOAD FOTO DE PERFIL
// -------------------------------
const uploadFotoDir = path.join(__dirname, 'uploads/fotos')

if (!fs.existsSync(uploadFotoDir)) {
  fs.mkdirSync(uploadFotoDir, { recursive: true })
}

const fotoStorage = multer.diskStorage({
  destination: uploadFotoDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.random().toString(36)}${ext}`)
  }
})

const uploadFoto = multer({
  storage: fotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Arquivo inválido'))
    }
    cb(null, true)
  }
})
// ======================================================================
// PARTE 2/5 — MIDDLEWARES, SESSÃO E AUTENTICAÇÃO
// ======================================================================

// -------------------------------
// CONFIGURAÇÕES GERAIS
// -------------------------------
app.set('trust proxy', 1)

app.use(cors({
  origin: true,
  credentials: true
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// -------------------------------
// ARQUIVOS ESTÁTICOS
// -------------------------------
app.use('/uploads/fotos', express.static(path.join(__dirname, 'uploads/fotos')))
app.use(express.static(path.join(__dirname, 'public')))

// -------------------------------
// SESSÃO
// -------------------------------
app.use(session({
  name: 'autonoma.sid',
  secret: process.env.SESSION_SECRET || 'autonoma_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
  }
}))

// -------------------------------
// HELPERS DE AUTENTICAÇÃO
// -------------------------------
function isLogged(req) {
  return req.session && req.session.userId
}

function requireAuth(req, res, next) {
  if (!isLogged(req)) {
    return res.status(401).json({
      ok: false,
      message: 'Não autenticado'
    })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!isLogged(req) || req.session.role !== 'ADMIN') {
    return res.status(403).json({
      ok: false,
      message: 'Acesso negado'
    })
  }
  next()
}

function requireProfessional(req, res, next) {
  if (!isLogged(req) || req.session.role !== 'PROFISSIONAL') {
    return res.status(403).json({
      ok: false,
      message: 'Acesso negado'
    })
  }
  next()
}

// -------------------------------
// HEALTHCHECK
// -------------------------------
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'API Autônoma rodando' })
})
// ======================================================================
// PARTE 3/5 — CADASTRO COM FOTO, LOGIN E ESQUECI SENHA
// ======================================================================

// -------------------------------
// BREVO (EMAIL)
// -------------------------------
const brevoClient = SibApiV3Sdk.ApiClient.instance
brevoClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY
const emailApi = new SibApiV3Sdk.TransactionalEmailsApi()

async function sendResetPasswordEmail(toEmail, name, token) {
  const resetUrl = `${process.env.APP_URL}/resetar-senha.html?token=${token}`

  await emailApi.sendTransacEmail({
    subject: 'Redefinição de senha — Autônoma',
    sender: {
      email: process.env.BREVO_SENDER_EMAIL,
      name: 'Autônoma App'
    },
    to: [{ email: toEmail, name }],
    htmlContent: `
      <p>Olá <strong>${name}</strong>,</p>
      <p>Clique no link abaixo para redefinir sua senha:</p>
      <p><a href="${resetUrl}">Redefinir minha senha</a></p>
      <p>Este link expira em 1 hora.</p>
    `
  })
}

// -------------------------------
// HELPERS
// -------------------------------
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

// ===============================
// HELPERS DE SERVIÇO
// ===============================
function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
}

function parseServicos(input) {
  if (!input) return []

  // aceita:
  // "eletricista, encanador"
  // ["eletricista", "encanador"]
  if (Array.isArray(input)) return input

  return input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}
// -------------------------------
// CADASTRO PROFISSIONAL (COM FOTO)
// -------------------------------
app.post(
  '/api/auth/register',
  uploadFoto.single('foto'),
  async (req, res) => {
    try {
      const {
        nome,
        email,
        whatsapp,
        senha,
        servicos,                      
        cidade,
        estado,
        bairro
      } = req.body

      if (!nome || !email || !whatsapp || !senha || !cidade) {
        return res.status(400).json({
          ok: false,
          message: 'Campos obrigatórios faltando'
        })
      }

      const exists = await prisma.profissional.findFirst({
        where: {
          OR: [{ email }, { whatsapp }]
        }
      })

      if (exists) {
        return res.status(409).json({
          ok: false,
          message: 'E-mail ou WhatsApp já cadastrados'
        })
      }

      const senhaHash = await bcrypt.hash(senha, 10)

      const profissional = await prisma.profissional.create({
        data: {
          nome,
          email,
          whatsapp,
          senha: senhaHash,
          cidade,
          estado,
          bairro,
          foto: req.file ? req.file.filename : null,
          plano: 'FREE',
          ativo: true,
          verificado: false
        }
      })
// ===============================
// VINCULAR SERVIÇOS (NORMALIZADO)
// ===============================
const listaServicos = parseServicos(servicos)

for (const nomeServico of listaServicos) {
  const slug = slugify(nomeServico)

  let servicoDb = await prisma.servico.findUnique({
    where: { slug }
  })

  if (!servicoDb) {
    servicoDb = await prisma.servico.create({
      data: {
        nome: nomeServico,
        slug
      }
    })
  }

  await prisma.profissionalServico.create({
    data: {
      profissionalId: profissional.id,
      servicoId: servicoDb.id
    }
  })
}
      req.session.userId = profissional.id
      req.session.role = 'PROFISSIONAL'

      res.json({
        ok: true,
        profissional: {
          id: profissional.id,
          nome: profissional.nome,
          plano: profissional.plano,
          foto: profissional.foto
        }
      })
    } catch (error) {
      console.error('REGISTER ERROR:', error)
      res.status(500).json({
        ok: false,
        message: 'Erro no cadastro'
      })
    }
  }
)

// -------------------------------
// LOGIN PROFISSIONAL
// -------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, senha } = req.body

    if (!login || !senha) {
      return res.status(400).json({
        ok: false,
        message: 'Informe login e senha'
      })
    }

    const profissional = await prisma.profissional.findFirst({
      where: {
        OR: [{ email: login }, { whatsapp: login }],
        ativo: true
      }
    })

    if (!profissional) {
      return res.status(401).json({
        ok: false,
        message: 'Usuário ou senha inválidos'
      })
    }

    const senhaValida = await bcrypt.compare(senha, profissional.senha)
    if (!senhaValida) {
      return res.status(401).json({
        ok: false,
        message: 'Usuário ou senha inválidos'
      })
    }

    req.session.userId = profissional.id
    req.session.role = 'PROFISSIONAL'

    res.json({
      ok: true,
      profissional: {
        id: profissional.id,
        nome: profissional.nome,
        plano: profissional.plano,
        foto: profissional.foto
      }
    })
  } catch (error) {
    console.error('LOGIN ERROR:', error)
    res.status(500).json({
      ok: false,
      message: 'Erro no login'
    })
  }
})

// -------------------------------
// ESQUECI MINHA SENHA
// -------------------------------
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    const profissional = await prisma.profissional.findUnique({
      where: { email }
    })

    if (!profissional) {
      return res.json({ ok: true })
    }

    const token = generateToken()
    const expires = new Date(Date.now() + 60 * 60 * 1000)

    await prisma.profissional.update({
      where: { id: profissional.id },
      data: {
        resetToken: token,
        resetTokenExpires: expires
      }
    })

    await sendResetPasswordEmail(
      profissional.email,
      profissional.nome,
      token
    )

    res.json({ ok: true })
  } catch (error) {
    console.error('FORGOT PASSWORD ERROR:', error)
    res.status(500).json({
      ok: false,
      message: 'Erro ao enviar e-mail'
    })
  }
})

// -------------------------------
// RESETAR SENHA
// -------------------------------
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, novaSenha } = req.body

    const profissional = await prisma.profissional.findFirst({
      where: {
        resetToken: token,
        resetTokenExpires: { gt: new Date() }
      }
    })

    if (!profissional) {
      return res.status(400).json({
        ok: false,
        message: 'Token inválido ou expirado'
      })
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10)

    await prisma.profissional.update({
      where: { id: profissional.id },
      data: {
        senha: senhaHash,
        resetToken: null,
        resetTokenExpires: null
      }
    })

    res.json({
      ok: true,
      message: 'Senha redefinida com sucesso'
    })
  } catch (error) {
    console.error('RESET PASSWORD ERROR:', error)
    res.status(500).json({
      ok: false,
      message: 'Erro ao redefinir senha'
    })
  }
})
// ======================================================================
// PARTE 4/5 — GEOLOCALIZAÇÃO + BUSCA DE PROFISSIONAIS
// ======================================================================

// -------------------------------
// FUNÇÃO HAVERSINE (KM)
// -------------------------------
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// ===============================
// BUSCAR PROFISSIONAIS
// ===============================
app.get('/api/profissionais', async (req, res) => {
  try {
    const { cidade, estado } = req.query

    if (!cidade || !estado) {
      return res.status(400).json({
        ok: false,
        message: 'Cidade e estado são obrigatórios'
      })
    }

    const profissionais = await prisma.profissional.findMany({
      where: {
        ativo: true,
        cidade,
        estado
      },
      include: {
        avaliacoes: true
      }
    })

    // Mapeia e calcula média de avaliações
    const profissionaisFinal = profissionais.map(p => {
      const totalAvaliacoes = p.avaliacoes.length
      const media =
        totalAvaliacoes > 0
          ? p.avaliacoes.reduce((soma, a) => soma + a.nota, 0) / totalAvaliacoes
          : 0

      return {
        id: p.id,
        nome: p.nome,
        foto: p.foto,
        cidade: p.cidade,
        estado: p.estado,
        avaliacao: Number(media.toFixed(1))
      }
    })

    // Ordena por avaliação (maior primeiro)
    profissionaisFinal.sort((a, b) => b.avaliacao - a.avaliacao)

    res.json({
      ok: true,
      total: profissionaisFinal.length,
      profissionais: profissionaisFinal
    })
  } catch (error) {
    console.error('ERRO BUSCA PROFISSIONAIS:', error)
    res.status(500).json({
      ok: false,
      message: 'Erro ao buscar profissionais'
    })
  }
})
    // =====================================
// AUTOCOMPLETE DE SERVIÇOS
// =====================================
app.get('/api/servicos/suggest', async (req, res) => {
  try {
    const { q } = req.query
               
    if (!q || q.length < 2) {
      return res.json([])
    }

    const servicos = await prisma.servico.findMany({
      where: {
        ativo: true,
        nome: {
          contains: q,
          mode: 'insensitive'
        }
      },
      orderBy: {
        nome: 'asc'
      },
      take: 10
    })

    res.json(
      servicos.map(s => ({
        id: s.id,
        nome: s.nome
      }))
    )
  } catch (error) {
    console.error('SERVICOS SUGGEST ERROR:', error)
    res.status(500).json([])
  }
})
   // =====================================
// ORDENAÇÃO SEGURA DE PROFISSIONAIS
// Plano > Distância > Avaliação
// =====================================

function ordenarProfissionais(lista = []) {
  if (!Array.isArray(lista)) return []

  const pesoPlano = (plano) => {
    if (plano === 'PREMIUM') return 3
    if (plano === 'PRO') return 2
    return 1
  }

  return lista.sort((a, b) => {
    // 1️⃣ Plano
    if (pesoPlano(b.plano) !== pesoPlano(a.plano)) {
      return pesoPlano(b.plano) - pesoPlano(a.plano)
    }

    // 2️⃣ Distância (se existir)
    if (a.distanciaKm != null && b.distanciaKm != null) {
      return a.distanciaKm - b.distanciaKm
    }

    // 3️⃣ Avaliação
    return (b.avaliacao || 0) - (a.avaliacao || 0)
  })
}
   

// ======================================================================
// PARTE 5/5 — PLANOS, ASAAS, ADMIN, VERIFICAÇÃO E START
// ======================================================================

// -------------------------------
// PLANOS OFICIAIS
// -------------------------------
const PLANOS = {
  FREE: { nome: 'FREE', valor: 0, taxa: 0, modoRaio: false },
  PRO: { nome: 'PRO', valor: 79.9, taxa: 0.06, modoRaio: true },
  PREMIUM: { nome: 'PREMIUM', valor: 49.9, taxa: 0.04, modoRaio: true }
}

// -------------------------------
// CRIAR CLIENTE ASAAS
// -------------------------------
async function criarClienteAsaas(profissional) {
  const response = await asaasApi.post('/customers', {
    name: profissional.nome,
    email: profissional.email,
    phone: profissional.whatsapp
  })
  return response.data.id
}


// -------------------------------
// CRIAR ASSINATURA
// -------------------------------
app.post('/api/assinaturas/criar', requireProfessional, async (req, res) => {
  try {
    const { plano } = req.body
    const profissionalId = req.session.userId

    if (!PLANOS[plano]) {
      return res.status(400).json({ ok: false, message: 'Plano inválido' })
    }

    const profissional = await prisma.profissional.findUnique({
      where: { id: profissionalId }
    })

    let asaasCustomerId = profissional.asaasCustomerId
    if (!asaasCustomerId) {
      asaasCustomerId = await criarClienteAsaas(profissional)
      await prisma.profissional.update({
        where: { id: profissionalId },
        data: { asaasCustomerId }
      })
    }

    const assinatura = await asaasApi.post('/subscriptions', {
      customer: asaasCustomerId,
      billingType: 'UNDEFINED',
      value: PLANOS[plano].valor,
      cycle: 'MONTHLY',
      description: `Plano ${plano} - Autônoma`,
      externalReference: profissionalId
    })

    await prisma.profissional.update({
      where: { id: profissionalId },
      data: {
        planoSolicitado: plano,
        asaasSubscriptionId: assinatura.data.id,
        statusAssinatura: 'PENDENTE'
      }
    })

    res.json({ ok: true, checkoutUrl: assinatura.data.invoiceUrl })
  } catch (error) {
    console.error('CRIAR ASSINATURA ERROR:', error)
    res.status(500).json({ ok: false, message: 'Erro ao criar assinatura' })
  }
})

// -------------------------------
// WEBHOOK ASAAS (ÚNICO)
// -------------------------------
app.post('/api/asaas/webhook', async (req, res) => {
  try {
    const event = req.body
    if (!event || !event.event) return res.json({ ok: true })

    // ATIVAR PLANO
    if (
      event.event === 'PAYMENT_CONFIRMED' ||
      event.event === 'SUBSCRIPTION_PAYMENT_RECEIVED'
    ) {
      const profissionalId = event.payment?.externalReference
      if (!profissionalId) return res.json({ ok: true })

      const profissional = await prisma.profissional.findUnique({
        where: { id: profissionalId }
      })
      if (!profissional) return res.json({ ok: true })

      const plano = profissional.planoSolicitado
      await prisma.profissional.update({
        where: { id: profissionalId },
        data: {
          plano,
          statusAssinatura: 'ATIVA',
          taxaPlataforma: PLANOS[plano].taxa,
          modoRaioAtivo: PLANOS[plano].modoRaio,
          planoSolicitado: null
        }
      })
    }

    // CANCELAR PLANO
    if (
      event.event === 'SUBSCRIPTION_CANCELED' ||
      event.event === 'PAYMENT_OVERDUE'
    ) {
      const subscriptionId =
        event.subscription?.id || event.payment?.subscription
      if (!subscriptionId) return res.json({ ok: true })

      await prisma.profissional.updateMany({
        where: { asaasSubscriptionId: subscriptionId },
        data: {
          plano: 'FREE',
          statusAssinatura: 'CANCELADA',
          taxaPlataforma: 0,
          modoRaioAtivo: false
        }
      })
    }

    res.json({ ok: true })
  } catch (error) {
    console.error('WEBHOOK ASAAS ERROR:', error)
    res.json({ ok: true })
  }
})

// -------------------------------
// ADMIN — LISTAR PROFISSIONAIS
// -------------------------------
app.get('/api/admin/profissionais', requireAdmin, async (req, res) => {
  const profissionais = await prisma.profissional.findMany({
    include: { avaliacoes: true, denuncias: true },
    orderBy: { createdAt: 'desc' }
  })

  res.json({
    ok: true,
    profissionais: profissionais.map(p => ({
      id: p.id,
      nome: p.nome,
      email: p.email,
      whatsapp: p.whatsapp,
      cidade: p.cidade,
      estado: p.estado,
      plano: p.plano,
      ativo: p.ativo,
      totalAvaliacoes: p.avaliacoes.length,
      totalDenuncias: p.denuncias.length
    }))
  })
})

// -------------------------------
// ADMIN — ATIVAR / DESATIVAR
// -------------------------------
app.patch('/api/admin/profissional/:id/status', requireAdmin, async (req, res) => {
  const { ativo } = req.body
  await prisma.profissional.update({
    where: { id: req.params.id },
    data: { ativo }
  })
  res.json({ ok: true })
})

// -------------------------------
// DENUNCIAR PROFISSIONAL
// -------------------------------
app.post('/api/profissional/:id/denunciar', async (req, res) => {
  await prisma.denuncia.create({
    data: {
      profissionalId: req.params.id,
      motivo: req.body.motivo
    }
  })
  res.json({ ok: true })
})

// -------------------------------
// VERIFICAÇÃO — UPLOAD DOCUMENTO
// -------------------------------
const uploadDocDir = path.join(__dirname, 'uploads/documentos')
if (!fs.existsSync(uploadDocDir)) {
  fs.mkdirSync(uploadDocDir, { recursive: true })
}

const docStorage = multer.diskStorage({
  destination: uploadDocDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.random().toString(36)}${ext}`)
  }
})

const uploadDocumento = multer({
  storage: docStorage,
  limits: { fileSize: 5 * 1024 * 1024 }
})

app.post(
  '/api/profissional/:id/documento',
  requireProfessional,
  uploadDocumento.single('documento'),
  async (req, res) => {
    await prisma.profissional.update({
      where: { id: req.params.id },
      data: {
        documentoVerificacao: req.file.filename,
        statusVerificacao: 'PENDENTE',
        verificado: false
      }
    })
    res.json({ ok: true })
  }
)

// -------------------------------
// ADMIN — APROVAR / REJEITAR VERIFICAÇÃO
// -------------------------------
app.post('/api/admin/verificar/:id', requireAdmin, async (req, res) => {
  const { aprovado } = req.body
  await prisma.profissional.update({
    where: { id: req.params.id },
    data: {
      statusVerificacao: aprovado ? 'APROVADO' : 'REJEITADO',
      verificado: aprovado
    }
  })
  res.json({ ok: true })
})

// -------------------------------
// SERVIR DOCUMENTOS
// -------------------------------
app.use('/uploads/documentos', express.static(uploadDocDir))

app.get('/', (req, res) => {
  res.status(200).send('Autônoma API OK')
})
// -------------------------------
// START SERVER
// -------------------------------
const PORT = process.env.PORT

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Autônoma API rodando na porta ${PORT}`)
})