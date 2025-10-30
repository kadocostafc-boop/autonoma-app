# 🚀 Guia Completo de Implementação da Monetização - Autônoma.app

**Versão:** 1.0  
**Data:** 30 de outubro de 2025  
**Status:** Pronto para Implementação  
**Autor:** Manus AI

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Pré-requisitos](#pré-requisitos)
3. [Passo 1: Configuração do Banco de Dados](#passo-1-configuração-do-banco-de-dados)
4. [Passo 2: Integração do Código](#passo-2-integração-do-código)
5. [Passo 3: Configuração do Asaas](#passo-3-configuração-do-asaas)
6. [Passo 4: Testes das Rotas](#passo-4-testes-das-rotas)
7. [Passo 5: Deploy em Produção](#passo-5-deploy-em-produção)
8. [Troubleshooting](#troubleshooting)
9. [Referências](#referências)

---

## 🎯 Visão Geral

O sistema de monetização do Autônoma.app foi implementado com as seguintes funcionalidades:

| Funcionalidade | Status | Descrição |
|---|---|---|
| **Planos Recorrentes** | ✅ Implementado | Free, Pro (R$ 29,90/mês), Premium (R$ 49,90/mês) |
| **Integração Asaas** | ✅ Implementado | Pagamentos via Pix, Cartão e Boleto |
| **Taxa de Pagamento** | ✅ Implementado | 4% para pagamentos via app, 0% para WhatsApp direto |
| **Webhook Asaas** | ✅ Implementado | Atualização automática de status de assinatura |
| **Middleware de Autorização** | ✅ Implementado | Controle de acesso por plano |
| **Downgrade Automático** | ✅ Implementado | Plano expira e faz downgrade para Free |
| **Histórico de Pagamentos** | ✅ Implementado | Registro de todos os pagamentos |
| **Simulador de Pagamento** | ✅ Implementado | Simular valor com taxa antes de processar |

---

## 📋 Pré-requisitos

Antes de começar, certifique-se de que você tem:

1. **Node.js 16+** instalado
2. **PostgreSQL** (local ou NeonDB)
3. **Conta Asaas** (https://asaas.com)
4. **Variáveis de Ambiente** configuradas:
   ```bash
   DATABASE_URL="postgresql://user:password@host:port/database"
   ASAAS_API_KEY="sua_chave_api_asaas"
   ASAAS_WEBHOOK_TOKEN="seu_token_webhook"
   ASAAS_ENV="sandbox"  # ou "production"
   ```

---

## 🔧 Passo 1: Configuração do Banco de Dados

### 1.1 Verificar a Conexão

Teste se a conexão com o banco de dados está funcionando:

```bash
# No diretório do projeto
npx prisma db push
```

Se receber um erro de autenticação:

1. **Verifique a DATABASE_URL** no arquivo `.env`
2. **Confirme a senha** do banco de dados
3. **Se usar NeonDB**, verifique se há restrição de IP:
   - Acesse https://console.neon.tech
   - Vá para "Project Settings" > "IP Whitelist"
   - Adicione o IP do seu servidor ou desative a restrição

### 1.2 Aplicar Migrations

```bash
# Aplicar todas as migrations pendentes
npx prisma migrate deploy

# Ou, em desenvolvimento, usar:
npx prisma migrate dev --name init_monetizacao
```

### 1.3 Verificar o Schema

```bash
# Gerar o cliente Prisma
npx prisma generate

# Visualizar o schema do banco
npx prisma studio
```

---

## 💻 Passo 2: Integração do Código

### 2.1 Copiar as Funções Implementadas

O arquivo `monetizacao-implementacao.js` contém todas as funções corrigidas. Você precisa:

1. **Abrir o arquivo** `monetizacao-implementacao.js`
2. **Copiar cada função** conforme indicado
3. **Colar no arquivo** `server.js`, substituindo as versões antigas

### 2.2 Funções a Integrar

| Função | Localização no server.js | Descrição |
|---|---|---|
| `checkAndDowngradePlan()` | Linhas 888-919 | Verifica expiração de plano |
| `resetMonthlyLeads()` | Linhas 922-946 | Reseta leads mensais |
| `POST /api/pagamento/processar` | Linhas 960-1030 | Processa pagamento com taxa |
| `GET /api/pagamento/simular` | Linhas 1032-1060 | Simula pagamento |
| `GET /api/pagamento/historico` | Linhas 1062-1087 | Retorna histórico |
| `POST /api/pay/asaas/checkout` | Linhas 620-713 | Cria checkout de assinatura |
| `POST /api/pay/asaas/webhook` | Linhas 715-800 | Processa webhook do Asaas |
| `GET /api/plano/status` | Nova | Retorna status do plano |
| `GET /api/plano/beneficios/:plan` | Nova | Retorna benefícios do plano |
| `POST /api/plano/cancelar` | Nova | Cancela assinatura |

### 2.3 Verificar Dependências

Certifique-se de que as seguintes dependências estão instaladas:

```bash
npm install express @prisma/client asaas-node axios dotenv
```

Se alguma estiver faltando:

```bash
npm install <nome-da-dependencia>
```

### 2.4 Variáveis Globais Necessárias

No topo do `server.js`, certifique-se de que existem:

```javascript
// Asaas
const Asaas = require('asaas-node');
const asaas = new Asaas(process.env.ASAAS_API_KEY, process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox');

// Prisma
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Taxa de pagamento
const TAX_RATE = 0.04; // 4%

// Preços dos planos
const PLAN_PRICES = {
  pro: 29.90,
  premium: 49.90
};
```

---

## 🔐 Passo 3: Configuração do Asaas

### 3.1 Criar Conta e Gerar Chaves

1. Acesse https://asaas.com
2. Crie uma conta (ou faça login)
3. Vá para "Configurações" > "API"
4. Gere uma chave de API
5. Copie a chave e adicione ao `.env`:
   ```
   ASAAS_API_KEY=sua_chave_aqui
   ```

### 3.2 Gerar Token de Webhook

1. Em "Configurações" > "Webhooks"
2. Crie um novo webhook com a URL:
   ```
   https://seu-dominio.com/api/pay/asaas/webhook
   ```
3. Copie o token e adicione ao `.env`:
   ```
   ASAAS_WEBHOOK_TOKEN=seu_token_aqui
   ```

### 3.3 Configurar Eventos do Webhook

Selecione os seguintes eventos:

- ✅ `PAYMENT_CONFIRMED` - Pagamento confirmado
- ✅ `PAYMENT_RECEIVED` - Pagamento recebido
- ✅ `PAYMENT_FAILED` - Pagamento falhou
- ✅ `PAYMENT_OVERDUE` - Pagamento vencido
- ✅ `SUBSCRIPTION_CANCELED` - Assinatura cancelada

### 3.4 Testar em Sandbox

Antes de usar em produção:

1. Configure `ASAAS_ENV=sandbox` no `.env`
2. Use a chave de API de sandbox
3. Teste todas as rotas
4. Quando tudo funcionar, mude para `ASAAS_ENV=production`

---

## 🧪 Passo 4: Testes das Rotas

### 4.1 Testar Status do Plano

```bash
# Verificar status do plano do usuário logado
curl -X GET http://localhost:3000/api/plano/status \
  -H "Cookie: connect.sid=seu_session_id"
```

**Resposta esperada:**
```json
{
  "ok": true,
  "plano": "free",
  "statusAssinatura": "cancelada",
  "validadePlano": null,
  "limiteLeadsMes": 3,
  "totalLeadsMes": 0
}
```

### 4.2 Testar Benefícios do Plano

```bash
# Obter benefícios do plano Pro
curl -X GET http://localhost:3000/api/plano/beneficios/pro
```

**Resposta esperada:**
```json
{
  "ok": true,
  "plano": "pro",
  "beneficios": {
    "nome": "Plano Pro",
    "preco": "R$ 29,90/mês",
    "destaque": "Médio",
    "raioAtendimento": 30,
    "cidadesExtras": 5,
    "fotosNoPerfil": 5,
    "leadsAoMes": 15,
    "metricas": "Básicas",
    "top10": false
  }
}
```

### 4.3 Testar Simulador de Pagamento

```bash
# Simular pagamento de R$ 100 via app
curl -X GET "http://localhost:3000/api/pagamento/simular?valor=100&metodo=app"
```

**Resposta esperada:**
```json
{
  "ok": true,
  "valor": 100,
  "taxa": 4,
  "valorComTaxa": 104,
  "metodo": "app",
  "descricao": "Pix/Cartão com 4% de taxa"
}
```

### 4.4 Testar Checkout de Assinatura

```bash
# Criar checkout para plano Pro
curl -X POST http://localhost:3000/api/pay/asaas/checkout \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=seu_session_id" \
  -d '{"plan": "pro"}'
```

**Resposta esperada:**
```json
{
  "ok": true,
  "subscriptionId": "sub_123456",
  "paymentUrl": "https://asaas.com/pay/123456",
  "redirectUrl": "https://asaas.com/pay/123456"
}
```

### 4.5 Testar Histórico de Pagamentos

```bash
# Obter histórico de pagamentos
curl -X GET http://localhost:3000/api/pagamento/historico \
  -H "Cookie: connect.sid=seu_session_id"
```

**Resposta esperada:**
```json
{
  "ok": true,
  "pagamentos": [
    {
      "id": 1,
      "valor": 100,
      "taxa": 4,
      "valorComTaxa": 104,
      "status": "pendente",
      "criadoEm": "2025-10-30T15:30:00.000Z"
    }
  ]
}
```

### 4.6 Testar Cancelamento de Assinatura

```bash
# Cancelar assinatura ativa
curl -X POST http://localhost:3000/api/plano/cancelar \
  -H "Cookie: connect.sid=seu_session_id"
```

**Resposta esperada:**
```json
{
  "ok": true,
  "message": "Assinatura cancelada com sucesso"
}
```

---

## 🚀 Passo 5: Deploy em Produção

### 5.1 Preparar o Ambiente

1. **Configurar variáveis de ambiente** no seu servidor:
   ```bash
   DATABASE_URL="postgresql://..."
   ASAAS_API_KEY="sua_chave_producao"
   ASAAS_WEBHOOK_TOKEN="seu_token_producao"
   ASAAS_ENV="production"
   ```

2. **Aplicar migrations** em produção:
   ```bash
   npx prisma migrate deploy
   ```

3. **Gerar cliente Prisma**:
   ```bash
   npx prisma generate
   ```

### 5.2 Configurar Webhook em Produção

1. No Asaas, configure a URL do webhook:
   ```
   https://seu-dominio.com/api/pay/asaas/webhook
   ```

2. Certifique-se de que a URL é **acessível publicamente**

3. Teste o webhook usando a ferramenta de teste do Asaas

### 5.3 Fazer Deploy

```bash
# Fazer commit das mudanças
git add .
git commit -m "feat: implementar sistema de monetização com Prisma e Asaas"

# Fazer push para o repositório
git push origin main

# Se usar Railway, Render ou similar, o deploy é automático
# Se usar servidor próprio, execute:
npm install
npx prisma migrate deploy
npm start
```

### 5.4 Monitorar Logs

```bash
# Monitorar logs em tempo real
tail -f logs/app.log

# Ou, se usar PM2:
pm2 logs autonoma-app
```

---

## 🔍 Troubleshooting

### Erro: "password authentication failed"

**Causa:** Senha incorreta na `DATABASE_URL`

**Solução:**
1. Verifique a senha no NeonDB
2. Se usar NeonDB, copie a URL do dashboard
3. Teste a conexão: `psql $DATABASE_URL`

### Erro: "ASAAS_API_KEY is not defined"

**Causa:** Variável de ambiente não configurada

**Solução:**
1. Adicione ao `.env`: `ASAAS_API_KEY=sua_chave`
2. Reinicie o servidor
3. Verifique: `echo $ASAAS_API_KEY`

### Webhook não está sendo chamado

**Causa:** URL do webhook não está acessível ou token está incorreto

**Solução:**
1. Verifique se a URL é pública: `curl https://seu-dominio.com/api/pay/asaas/webhook`
2. Verifique o token: `echo $ASAAS_WEBHOOK_TOKEN`
3. No Asaas, teste o webhook manualmente
4. Verifique os logs do servidor

### Prisma não consegue conectar ao banco

**Causa:** Banco de dados não está acessível

**Solução:**
1. Teste a conexão: `psql $DATABASE_URL`
2. Verifique se o banco existe
3. Se usar NeonDB, verifique a whitelist de IP
4. Verifique se o usuário tem permissões

### Assinatura não está sendo criada

**Causa:** Cliente Asaas não foi criado corretamente

**Solução:**
1. Verifique se o `customerId` foi salvo no banco
2. Verifique os logs do Asaas
3. Teste a API do Asaas manualmente
4. Verifique se a chave de API está correta

---

## 📚 Referências

| Recurso | URL |
|---|---|
| **Documentação Prisma** | https://www.prisma.io/docs |
| **Documentação Asaas** | https://asaas.com/api |
| **Documentação Express.js** | https://expressjs.com |
| **PostgreSQL Docs** | https://www.postgresql.org/docs |
| **NeonDB** | https://neon.tech |

---

## ✅ Checklist de Implementação

Use este checklist para garantir que tudo foi implementado corretamente:

### Configuração
- [ ] Banco de dados conectado e migrations aplicadas
- [ ] Variáveis de ambiente configuradas
- [ ] Dependências instaladas
- [ ] Código integrado no `server.js`

### Testes
- [ ] Rota `/api/plano/status` retorna status correto
- [ ] Rota `/api/plano/beneficios/:plan` retorna benefícios
- [ ] Rota `/api/pagamento/simular` calcula taxa corretamente
- [ ] Rota `/api/pay/asaas/checkout` cria assinatura
- [ ] Rota `/api/pagamento/historico` retorna pagamentos
- [ ] Rota `/api/plano/cancelar` cancela assinatura

### Asaas
- [ ] Conta Asaas criada
- [ ] Chave de API gerada
- [ ] Token de webhook gerado
- [ ] Webhook configurado na URL correta
- [ ] Eventos de webhook selecionados

### Produção
- [ ] Variáveis de ambiente em produção
- [ ] Migrations aplicadas em produção
- [ ] Webhook testado em produção
- [ ] Logs monitorados
- [ ] Backup do banco de dados configurado

---

## 🎉 Conclusão

Após seguir este guia, você terá um **sistema de monetização completo** com:

✅ Planos recorrentes (Free, Pro, Premium)  
✅ Integração com Asaas para pagamentos  
✅ Taxa de 4% para pagamentos via app  
✅ Webhook automático para atualizar status  
✅ Downgrade automático quando plano expira  
✅ Histórico de pagamentos  
✅ Simulador de pagamento  

**Próximas Melhorias:**
- Adicionar suporte a múltiplas moedas
- Implementar sistema de cupons/descontos
- Adicionar relatórios de receita
- Integrar com mais gateways de pagamento

---

**Última atualização:** 30 de outubro de 2025  
**Versão:** 1.0  
**Autor:** Manus AI
