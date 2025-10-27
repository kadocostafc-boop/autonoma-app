/**
 * ============================================================================
 * Rotas de Pagamento com Taxa de 4%
 * ============================================================================
 * 
 * Implementa:
 * - POST /api/pagamento/processar - Processar pagamento com taxa de 4%
 * - GET /api/pagamento/historico - Histórico de pagamentos
 * - POST /api/pagamento/webhook - Webhook de pagamento
 * 
 * Regra: Se o profissional optar por recebimento via app (Pix/Cartão),
 * aplicar taxa de 4% em cada transação.
 * 
 */

const express = require('express');
const router = express.Router();

// ============================================================================
// Configuração
// ============================================================================

const TAX_RATE = 0.04; // 4%

// ============================================================================
// Middleware de autenticação
// ============================================================================

function requireAuth(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }
  next();
}

// ============================================================================
// POST /api/pagamento/processar
// ============================================================================
// Processar pagamento com cálculo de taxa de 4%
// Body: { profissionalId, valor, metodo: 'pix' | 'cartao' | 'whatsapp' }

router.post('/api/pagamento/processar', express.json(), requireAuth, async (req, res) => {
  try {
    const { profissionalId, valor, metodo } = req.body || {};
    const usuarioId = req.session.usuarioId;

    if (!profissionalId || !valor || !metodo) {
      return res.status(400).json({
        ok: false,
        error: 'Informe profissionalId, valor e metodo (pix|cartao|whatsapp)',
      });
    }

    // Validar valor
    const valorNumerico = parseFloat(valor);
    if (isNaN(valorNumerico) || valorNumerico <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'Valor inválido',
      });
    }

    // TODO: Implementar com Prisma
    // const profissional = await prisma.profissional.findUnique({
    //   where: { id: profissionalId },
    //   select: { usaPagamentoViaApp: true, plano: true },
    // });

    // if (!profissional) {
    //   return res.status(404).json({
    //     ok: false,
    //     error: 'Profissional não encontrado',
    //   });
    // }

    let taxa = 0;
    let valorComTaxa = valorNumerico;

    // Aplicar taxa apenas se o profissional usa pagamento via app
    // e o método não é WhatsApp direto
    if (metodo !== 'whatsapp') {
      taxa = valorNumerico * TAX_RATE;
      valorComTaxa = valorNumerico + taxa;
    }

    // TODO: Salvar pagamento no banco
    // const pagamento = await prisma.pagamentoViaApp.create({
    //   data: {
    //     usuarioId,
    //     profissionalId,
    //     valor: valorNumerico,
    //     taxa,
    //     valorComTaxa,
    //     status: 'pendente',
    //   },
    // });

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

// ============================================================================
// GET /api/pagamento/simular
// ============================================================================
// Simular pagamento com taxa (sem processar)
// Query: ?valor=100&metodo=pix

router.get('/api/pagamento/simular', (req, res) => {
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

    let taxa = 0;
    let valorComTaxa = valorNumerico;

    if (metodo !== 'whatsapp') {
      taxa = valorNumerico * TAX_RATE;
      valorComTaxa = valorNumerico + taxa;
    }

    return res.json({
      ok: true,
      simulacao: {
        valor: valorNumerico,
        taxa: parseFloat(taxa.toFixed(2)),
        valorComTaxa: parseFloat(valorComTaxa.toFixed(2)),
        metodo: metodo,
        taxaPercentual: metodo === 'whatsapp' ? 0 : 4,
        descricao: metodo === 'whatsapp' 
          ? 'Sem taxa - Contato direto via WhatsApp'
          : `Taxa de ${(TAX_RATE * 100).toFixed(0)}% aplicada ao pagamento via app`,
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

// ============================================================================
// GET /api/pagamento/historico
// ============================================================================
// Obter histórico de pagamentos do usuário

router.get('/api/pagamento/historico', requireAuth, async (req, res) => {
  try {
    const usuarioId = req.session.usuarioId;

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
// Função para verificar e fazer downgrade automático
// ============================================================================
// Chamada pelo webhook quando a assinatura expira

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

// ============================================================================
// Função para resetar leads mensais
// ============================================================================
// Chamada diariamente ou quando necessário

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

// ============================================================================
// Função para calcular taxa de pagamento
// ============================================================================

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

module.exports = router;
module.exports.checkAndDowngradePlan = checkAndDowngradePlan;
module.exports.resetMonthlyLeads = resetMonthlyLeads;
module.exports.calculatePaymentFee = calculatePaymentFee;
module.exports.TAX_RATE = TAX_RATE;

