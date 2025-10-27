# 🚀 Sistema de Monetização - Implementação

## Visão Geral

Este documento descreve a implementação completa do sistema de monetização do Autonoma.app com planos recorrentes (Free, Pro, Premium), integração Asaas, taxa de 4% para pagamentos via app e controle de acesso por plano.

---

## 📋 Arquivos Criados/Modificados

### 1. **Schema do Banco de Dados** (`prisma/schema.prisma`)
- ✅ Adicionados campos ao modelo `Profissional`:
  - `plano` (free, pro, premium)
  - `validadePlano` (DateTime)
  - `statusAssinatura` (ativa, pendente, cancelada)
  - `totalLeadsMes` e `limiteLeadsMes`
  - `usaPagamentoViaApp`
  - `assinaturaAsaasId`

- ✅ Novo modelo `Assinatura`:
  - Gerencia assinaturas com Asaas
  - Rastreia status e validade

- ✅ Novo modelo `PagamentoViaApp`:
  - Rastreia pagamentos com taxa de 4%
  - Calcula e armazena taxa automaticamente

### 2. **Rotas de API** (`routes/asaas-payment.js`)
- ✅ `POST /api/pay/asaas/checkout` - Criar checkout para Pro/Premium
- ✅ `POST /api/pay/asaas/webhook` - Webhook Asaas para atualizar status
- ✅ `POST /api/plano/cancelar` - Cancelar assinatura
- ✅ `GET /api/plano/status` - Obter status da assinatura
- ✅ `GET /api/plano/beneficios/:plan` - Obter benefícios de um plano

### 3. **Rotas de Pagamento com Taxa** (`routes/payment-fee.js`)
- ✅ `POST /api/pagamento/processar` - Processar pagamento com taxa de 4%
- ✅ `GET /api/pagamento/simular` - Simular pagamento (sem processar)
- ✅ `GET /api/pagamento/historico` - Histórico de pagamentos

### 4. **Middleware de Autorização** (`middleware/plan-authorization.js`)
- ✅ `requireActivePlan` - Verifica se plano está ativo
- ✅ `requirePlanFeature` - Verifica acesso a recurso específico
- ✅ `requirePhotoLimit` - Bloqueia fotos extras
- ✅ `requireLeadLimit` - Bloqueia leads extras
- ✅ `requireMetricsAccess` - Bloqueia acesso a métricas
- ✅ `requireTop10Access` - Bloqueia acesso ao Top 10

### 5. **Páginas Front-end**
- ✅ `public/planos.html` - Página de planos (atualizada)
- ✅ `public/checkout-assinatura-novo.html` - Página de checkout

---

## 🔧 Integração no Server.js

Para integrar o sistema de monetização, adicione ao `server.js`:

```javascript
// ============================================================================
// INTEGRAÇÃO DE MONETIZAÇÃO
// ============================================================================

// Importar rotas de pagamento
const asaasPaymentRouter = require('./routes/asaas-payment');
const paymentFeeRouter = require('./routes/payment-fee');
const planAuthMiddleware = require('./middleware/plan-authorization');

// Registrar rotas
app.use(asaasPaymentRouter);
app.use(paymentFeeRouter);

// Exemplo de uso do middleware em uma rota protegida:
// app.get('/api/metricas', planAuthMiddleware.requireMetricsAccess, (req, res) => {
//   // Retornar métricas apenas para planos Pro/Premium
// });

// Exemplo de verificação de limite de fotos:
// app.post('/api/fotos/upload', planAuthMiddleware.requirePhotoLimit, (req, res) => {
//   // Upload de foto
// });
```

---

## 📊 Tabela de Planos

| Recurso | Free | Pro | Premium |
|---------|------|-----|---------|
| **Preço** | R$ 0/mês | R$ 29,90/mês | R$ 49,90/mês |
| Destaque na busca | ❌ | ✅ Médio | ✅ Alto |
| Raio de atendimento | 0 km | 30 km | 50 km |
| Cidades extras | 3 | 5 | 10 |
| Fotos no perfil | 1 | 5 | 10 |
| Leads / mês | 3 | 15 | Ilimitado |
| Métricas | ❌ | ✅ Básicas | ✅ Avançadas |
| Top 10 da semana | ❌ | ❌ | ✅ |

---

## 💳 Taxa de Pagamento

### Regra: 4% para pagamentos via app

- **WhatsApp direto**: Sem taxa (0%)
- **Pix via app**: 4% de taxa
- **Cartão via app**: 4% de taxa

### Exemplo de Cálculo

```
Valor do serviço: R$ 100,00

Cenário 1: Pagamento via WhatsApp
- Valor final: R$ 100,00
- Taxa: R$ 0,00
- Repasse ao profissional: R$ 100,00

Cenário 2: Pagamento via Pix/Cartão (app)
- Valor final: R$ 104,00
- Taxa: R$ 4,00
- Repasse ao profissional: R$ 100,00
```

---

## 🔐 Fluxo de Assinatura

### 1. Usuário acessa `/planos.html`
- Visualiza os 3 planos disponíveis
- Vê seu plano atual (se logado)

### 2. Clica em "Assinar Pro" ou "Assinar Premium"
- Se não logado, redireciona para login
- Se logado, chama `POST /api/pay/asaas/checkout`

### 3. API cria customer e assinatura no Asaas
- Retorna URL de pagamento
- Usuário é redirecionado para Asaas

### 4. Asaas processa pagamento
- Envia webhook para `/api/pay/asaas/webhook`
- Status é atualizado no banco (Prisma)

### 5. Webhook atualiza status
- `statusAssinatura` → "ativa"
- `validadePlano` → data de renovação (30 dias)
- `plano` → "pro" ou "premium"

### 6. Plano expira automaticamente
- Função `checkAndDowngradePlan` verifica validade
- Se expirou: downgrade para "free"

---

## 🛠️ Variáveis de Ambiente Necessárias

```env
# Asaas
ASAAS_API_KEY=sua_chave_api_asaas
ASAAS_ENV=sandbox  # ou 'prod' para produção
ASAAS_WEBHOOK_TOKEN=seu_token_webhook_asaas

# Banco de dados
DATABASE_URL=postgresql://user:password@localhost:5432/autonoma

# Sessão
SESSION_SECRET=sua_chave_secreta_sessao
```

---

## 📱 Endpoints da API

### Planos e Assinatura

```
GET  /api/plano/status                    - Obter status do plano atual
GET  /api/plano/beneficios/:plan          - Obter benefícios de um plano
POST /api/pay/asaas/checkout              - Criar checkout
POST /api/plano/cancelar                  - Cancelar assinatura
POST /api/pay/asaas/webhook               - Webhook Asaas
```

### Pagamentos com Taxa

```
POST /api/pagamento/processar             - Processar pagamento com taxa
GET  /api/pagamento/simular               - Simular pagamento
GET  /api/pagamento/historico             - Histórico de pagamentos
```

---

## ✅ Checklist de Implementação

- [x] Schema Prisma atualizado
- [x] Rotas de checkout e webhook criadas
- [x] Middleware de autorização implementado
- [x] Páginas de planos e checkout criadas
- [x] Taxa de 4% implementada
- [x] Lógica de downgrade criada
- [ ] **TODO**: Integrar com Prisma (comentários marcados com `TODO`)
- [ ] **TODO**: Testar fluxo completo
- [ ] **TODO**: Configurar webhook no Asaas
- [ ] **TODO**: Testar responsividade mobile
- [ ] **TODO**: Deploy em produção

---

## 🚀 Próximos Passos

### 1. Integração com Prisma
Todos os comentários `TODO` no código precisam ser implementados:
- Buscar/atualizar dados do banco com Prisma
- Implementar lógica de downgrade automático
- Implementar reset de leads mensais

### 2. Testes
- Testar fluxo de assinatura completo
- Testar webhook do Asaas
- Testar cancelamento de assinatura
- Testar bloqueios de recursos por plano

### 3. Configuração Asaas
- Criar conta em https://asaas.com
- Gerar API key
- Configurar webhook para `/api/pay/asaas/webhook`
- Testar em sandbox antes de produção

### 4. Responsividade
- Testar em mobile, tablet e desktop
- Ajustar CSS conforme necessário

### 5. Deploy
- Fazer migration do Prisma: `npx prisma migrate deploy`
- Deploy da aplicação
- Ativar webhook em produção

---

## 📞 Suporte

Para dúvidas sobre integração:
- Documentação Asaas: https://asaas.com/api
- Documentação Prisma: https://www.prisma.io/docs

---

**Última atualização**: 27 de outubro de 2025

