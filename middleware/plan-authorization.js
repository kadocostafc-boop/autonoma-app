/**
 * ============================================================================
 * Middleware de Autorização por Plano
 * ============================================================================
 * 
 * Verifica plano do usuário e bloqueia recursos conforme as regras:
 * - Destaque na busca
 * - Raio de atendimento
 * - Cidades extras
 * - Fotos no perfil
 * - Leads/mês
 * - Métricas
 * - Top 10
 * 
 */

// Definição de limites por plano
const PLAN_LIMITS = {
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
    destaque: true,
    raioKm: 30,
    cidadesExtras: 5,
    fotosMax: 5,
    leadsMax: 15,
    metricas: true,
    top10: false,
  },
  premium: {
    destaque: true,
    raioKm: 50,
    cidadesExtras: 10,
    fotosMax: 10,
    leadsMax: -1, // ilimitado
    metricas: true,
    top10: true,
  },
};

/**
 * Middleware para verificar se o plano está ativo
 * Retorna 403 se o plano expirou
 */
function requireActivePlan(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId: req.session.usuarioId },
  // });

  // if (!profissional) {
  //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
  // }

  // if (profissional.statusAssinatura !== 'ativa') {
  //   return res.status(403).json({
  //     ok: false,
  //     error: 'Plano inativo ou expirado',
  //   });
  // }

  // if (profissional.validadePlano && new Date(profissional.validadePlano) < new Date()) {
  //   return res.status(403).json({
  //     ok: false,
  //     error: 'Plano expirado',
  //   });
  // }

  next();
}

/**
 * Middleware para verificar se o usuário pode usar um recurso específico
 * @param {string} recurso - Nome do recurso (destaque, raio, cidades, fotos, leads, metricas, top10)
 */
function requirePlanFeature(recurso) {
  return (req, res, next) => {
    if (!req.session || !req.session.usuarioId) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    // TODO: Implementar com Prisma
    // const profissional = await prisma.profissional.findUnique({
    //   where: { usuarioId: req.session.usuarioId },
    // });

    // if (!profissional) {
    //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
    // }

    // const limits = PLAN_LIMITS[profissional.plano] || PLAN_LIMITS.free;

    // if (!limits[recurso]) {
    //   return res.status(403).json({
    //     ok: false,
    //     error: `Recurso "${recurso}" não disponível no plano ${profissional.plano}`,
    //   });
    // }

    next();
  };
}

/**
 * Função para validar se um valor está dentro dos limites do plano
 * @param {string} plano - Plano do usuário (free, pro, premium)
 * @param {string} recurso - Recurso a validar
 * @param {any} valor - Valor a validar
 * @returns {boolean} - True se permitido, False caso contrário
 */
function isAllowedByPlan(plano, recurso, valor) {
  const limits = PLAN_LIMITS[plano] || PLAN_LIMITS.free;
  const limit = limits[recurso];

  if (limit === false) {
    return false; // Recurso não permitido
  }

  if (limit === true) {
    return true; // Recurso permitido sem limite
  }

  if (typeof limit === 'number') {
    if (limit === -1) {
      return true; // Ilimitado
    }
    return valor <= limit; // Verificar limite numérico
  }

  return false;
}

/**
 * Função para obter o limite de um recurso para um plano
 * @param {string} plano - Plano do usuário
 * @param {string} recurso - Recurso
 * @returns {any} - Limite do recurso
 */
function getPlanLimit(plano, recurso) {
  const limits = PLAN_LIMITS[plano] || PLAN_LIMITS.free;
  return limits[recurso];
}

/**
 * Middleware para bloquear fotos extras
 * Verifica se o número de fotos está dentro do limite do plano
 */
function requirePhotoLimit(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId: req.session.usuarioId },
  //   select: { plano: true, fotos: { select: { id: true } } },
  // });

  // if (!profissional) {
  //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
  // }

  // const limit = getPlanLimit(profissional.plano, 'fotosMax');
  // const currentCount = profissional.fotos.length;

  // if (currentCount >= limit) {
  //   return res.status(403).json({
  //     ok: false,
  //     error: `Limite de fotos atingido (${limit} fotos no plano ${profissional.plano})`,
  //   });
  // }

  next();
}

/**
 * Middleware para bloquear leads extras
 * Verifica se o número de leads do mês está dentro do limite
 */
function requireLeadLimit(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId: req.session.usuarioId },
  // });

  // if (!profissional) {
  //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
  // }

  // const limit = getPlanLimit(profissional.plano, 'leadsMax');

  // if (limit !== -1 && profissional.totalLeadsMes >= limit) {
  //   return res.status(403).json({
  //     ok: false,
  //     error: `Limite de leads atingido (${limit} leads/mês no plano ${profissional.plano})`,
  //   });
  // }

  next();
}

/**
 * Middleware para bloquear acesso a métricas
 */
function requireMetricsAccess(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId: req.session.usuarioId },
  // });

  // if (!profissional) {
  //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
  // }

  // if (!getPlanLimit(profissional.plano, 'metricas')) {
  //   return res.status(403).json({
  //     ok: false,
  //     error: 'Métricas não disponíveis no plano Free',
  //   });
  // }

  next();
}

/**
 * Middleware para bloquear acesso ao Top 10
 */
function requireTop10Access(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId: req.session.usuarioId },
  // });

  // if (!profissional) {
  //   return res.status(404).json({ ok: false, error: 'Profissional não encontrado' });
  // }

  // if (!getPlanLimit(profissional.plano, 'top10')) {
  //   return res.status(403).json({
  //     ok: false,
  //     error: 'Top 10 disponível apenas no plano Premium',
  //   });
  // }

  next();
}

/**
 * Função para atualizar leads mensais
 * Reseta no primeiro dia do mês
 */
async function updateLeadsCount(usuarioId, increment = 1) {
  // TODO: Implementar com Prisma
  // const profissional = await prisma.profissional.findUnique({
  //   where: { usuarioId },
  // });

  // if (!profissional) return null;

  // const now = new Date();
  // const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // const lastMonth = profissional.ultimoMesLeads || '';

  // if (currentMonth !== lastMonth) {
  //   // Novo mês, resetar contador
  //   await prisma.profissional.update({
  //     where: { usuarioId },
  //     data: {
  //       totalLeadsMes: increment,
  //       ultimoMesLeads: currentMonth,
  //     },
  //   });
  // } else {
  //   // Mesmo mês, incrementar
  //   await prisma.profissional.update({
  //     where: { usuarioId },
  //     data: {
  //       totalLeadsMes: { increment },
  //     },
  //   });
  // }
}

module.exports = {
  PLAN_LIMITS,
  requireActivePlan,
  requirePlanFeature,
  isAllowedByPlan,
  getPlanLimit,
  requirePhotoLimit,
  requireLeadLimit,
  requireMetricsAccess,
  requireTop10Access,
  updateLeadsCount,
};

