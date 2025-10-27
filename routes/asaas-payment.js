/**
 * ============================================================================
 * Rotas de Pagamento e Assinatura com Asaas
 * ============================================================================
 * 
 * Implementa:
 * - POST /api/pay/asaas/checkout - Criar checkout para Pro/Premium
 * - POST /api/pay/asaas/webhook - Webhook Asaas para atualizar status
 * - POST /api/plano/cancelar - Cancelar assinatura
 * - GET /api/plano/status - Obter status da assinatura
 * 
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// ============================================================================
// Configuração Asaas
// ============================================================================

const ASAAS_KEY = process.env.ASAAS_API_KEY;
const ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox';
const ASAAS_BASE_URL =
  ASAAS_ENV === 'prod'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

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

// ============================================================================
// Função auxiliar para chamar API Asaas
// ============================================================================

async function asaasRequest(endpoint, options = {}) {
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

// ============================================================================
// Middleware de autenticação (usuário logado)
// ============================================================================

function requireAuth(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }
  next();
}

// ============================================================================
// POST /api/pay/asaas/checkout
// ============================================================================
// Cria checkout para assinar Pro ou Premium
// Body: { plan: 'pro' | 'premium' }

router.post('/api/pay/asaas/checkout', express.json(), requireAuth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    const usuarioId = req.session.usuarioId;

    if (!PLAN_PRICES[plan]) {
      return res.status(400).json({
        ok: false,
        error: 'Plano inválido. Use "pro" ou "premium".',
      });
    }

    // Aqui você buscaria os dados do usuário do banco de dados
    // Por enquanto, vamos usar dados da sessão
    const usuario = req.session.usuario || {};
    const email = usuario.email || req.session.email;
    const nome = usuario.nome || req.session.nome;

    if (!email || !nome) {
      return res.status(400).json({
        ok: false,
        error: 'Dados do usuário incompletos',
      });
    }

    // 1) Criar ou obter customer no Asaas
    let customerId = usuario.asaasCustomerId;

    if (!customerId) {
      const customer = await asaasRequest('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: nome,
          email: email,
          mobilePhone: usuario.telefone || '',
          cpfCnpj: usuario.cpf || '',
        }),
      });
      customerId = customer.id;
      // TODO: Salvar customerId no banco de dados
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

    // 4) TODO: Salvar assinatura no banco de dados (Prisma)
    // await prisma.assinatura.create({
    //   data: {
    //     usuarioId,
    //     plano: plan,
    //     statusAssinatura: 'pendente',
    //     assinaturaAsaasId: subscription.id,
    //   },
    // });

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

// ============================================================================
// POST /api/pay/asaas/webhook
// ============================================================================
// Webhook do Asaas para atualizar status de assinatura

router.post('/api/pay/asaas/webhook', express.json(), async (req, res) => {
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
    const subscription = event.subscription;
    const payment = event.payment || {};

    // TODO: Implementar com Prisma
    // const assinatura = await prisma.assinatura.findUnique({
    //   where: { assinaturaAsaasId: subscription },
    // });

    // if (!assinatura) {
    //   console.warn(`[Asaas] Assinatura não encontrada: ${subscription}`);
    //   return res.json({ ok: true });
    // }

    // Tratar eventos
    switch (eventType) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        console.log('✅ Pagamento confirmado:', payment.id);
        // TODO: Atualizar statusAssinatura para 'ativa'
        // await prisma.assinatura.update({
        //   where: { id: assinatura.id },
        //   data: { statusAssinatura: 'ativa' },
        // });
        // await prisma.profissional.update({
        //   where: { usuarioId: assinatura.usuarioId },
        //   data: {
        //     statusAssinatura: 'ativa',
        //     validadePlano: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        //   },
        // });
        break;

      case 'PAYMENT_OVERDUE':
        console.log('⚠️ Pagamento atrasado:', payment.id);
        // TODO: Marcar como pendente
        break;

      case 'PAYMENT_REFUNDED':
        console.log('↩️ Pagamento estornado:', payment.id);
        // TODO: Voltar para plano free
        break;

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELED':
        console.log('❌ Assinatura cancelada:', subscription);
        // TODO: Atualizar para free
        // await prisma.profissional.update({
        //   where: { usuarioId: assinatura.usuarioId },
        //   data: {
        //     plano: 'free',
        //     statusAssinatura: 'cancelada',
        //     validadePlano: null,
        //   },
        // });
        break;

      default:
        console.log('📘 Evento ignorado:', eventType);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Asaas] Erro no webhook:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// POST /api/plano/cancelar
// ============================================================================
// Cancelar assinatura do profissional

router.post('/api/plano/cancelar', express.json(), requireAuth, async (req, res) => {
  try {
    const usuarioId = req.session.usuarioId;

    // TODO: Implementar com Prisma
    // const assinatura = await prisma.assinatura.findFirst({
    //   where: { usuarioId, statusAssinatura: 'ativa' },
    // });

    // if (!assinatura) {
    //   return res.status(404).json({
    //     ok: false,
    //     error: 'Nenhuma assinatura ativa encontrada',
    //   });
    // }

    // // Cancelar no Asaas
    // await asaasRequest(`/subscriptions/${assinatura.assinaturaAsaasId}`, {
    //   method: 'DELETE',
    // });

    // // Atualizar no banco
    // await prisma.assinatura.update({
    //   where: { id: assinatura.id },
    //   data: { statusAssinatura: 'cancelada' },
    // });

    // await prisma.profissional.update({
    //   where: { usuarioId },
    //   data: {
    //     plano: 'free',
    //     statusAssinatura: 'cancelada',
    //     validadePlano: null,
    //   },
    // });

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

// ============================================================================
// GET /api/plano/status
// ============================================================================
// Obter status da assinatura do usuário

router.get('/api/plano/status', requireAuth, async (req, res) => {
  try {
    const usuarioId = req.session.usuarioId;

    // TODO: Implementar com Prisma
    // const profissional = await prisma.profissional.findUnique({
    //   where: { usuarioId },
    //   select: {
    //     plano: true,
    //     statusAssinatura: true,
    //     validadePlano: true,
    //     limiteLeadsMes: true,
    //     totalLeadsMes: true,
    //   },
    // });

    // if (!profissional) {
    //   return res.status(404).json({
    //     ok: false,
    //     error: 'Profissional não encontrado',
    //   });
    // }

    // const benefits = PLAN_BENEFITS[profissional.plano] || PLAN_BENEFITS.free;

    return res.json({
      ok: true,
      plano: 'free', // TODO: obter do banco
      statusAssinatura: 'cancelada',
      validadePlano: null,
      beneficios: PLAN_BENEFITS.free,
      limiteLeads: 3,
      leadsUsados: 0,
    });
  } catch (e) {
    console.error('[Plano] Erro ao obter status:', e.message);
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// ============================================================================
// GET /api/plano/beneficios/:plan
// ============================================================================
// Obter benefícios de um plano

router.get('/api/plano/beneficios/:plan', (req, res) => {
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

module.exports = router;

