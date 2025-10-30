# 💻 Exemplos de Integração Frontend - Monetização

**Versão:** 1.0  
**Data:** 30 de outubro de 2025  
**Objetivo:** Fornecer exemplos de código frontend para integrar o sistema de monetização

---

## 📋 Índice

1. [Verificar Status do Plano](#verificar-status-do-plano)
2. [Exibir Benefícios dos Planos](#exibir-benefícios-dos-planos)
3. [Simulador de Pagamento](#simulador-de-pagamento)
4. [Checkout de Assinatura](#checkout-de-assinatura)
5. [Histórico de Pagamentos](#histórico-de-pagamentos)
6. [Cancelar Assinatura](#cancelar-assinatura)

---

## 1. Verificar Status do Plano

### HTML

```html
<div id="status-plano" class="card">
  <h2>Seu Plano Atual</h2>
  <div id="plano-info">
    <p>Carregando...</p>
  </div>
</div>
```

### JavaScript

```javascript
async function carregarStatusPlano() {
  try {
    const response = await fetch('/api/plano/status');
    const data = await response.json();

    if (!data.ok) {
      console.error('Erro ao carregar status:', data.error);
      return;
    }

    const { plano, statusAssinatura, validadePlano, limiteLeadsMes, totalLeadsMes } = data;

    const html = `
      <div class="plano-status">
        <p><strong>Plano:</strong> ${plano.toUpperCase()}</p>
        <p><strong>Status:</strong> ${statusAssinatura}</p>
        ${validadePlano ? `<p><strong>Válido até:</strong> ${new Date(validadePlano).toLocaleDateString('pt-BR')}</p>` : ''}
        <p><strong>Leads:</strong> ${totalLeadsMes} / ${limiteLeadsMes}</p>
      </div>
    `;

    document.getElementById('plano-info').innerHTML = html;
  } catch (error) {
    console.error('Erro:', error);
    document.getElementById('plano-info').innerHTML = '<p>Erro ao carregar status</p>';
  }
}

// Chamar ao carregar a página
document.addEventListener('DOMContentLoaded', carregarStatusPlano);
```

---

## 2. Exibir Benefícios dos Planos

### HTML

```html
<div class="planos-container">
  <div id="plano-free" class="plano-card"></div>
  <div id="plano-pro" class="plano-card"></div>
  <div id="plano-premium" class="plano-card"></div>
</div>
```

### JavaScript

```javascript
async function carregarBeneficios() {
  const planos = ['free', 'pro', 'premium'];

  for (const plano of planos) {
    try {
      const response = await fetch(`/api/plano/beneficios/${plano}`);
      const data = await response.json();

      if (!data.ok) continue;

      const { beneficios } = data;
      const container = document.getElementById(`plano-${plano}`);

      const html = `
        <div class="plano-header">
          <h3>${beneficios.nome}</h3>
          <p class="preco">${beneficios.preco}</p>
        </div>
        <ul class="beneficios-list">
          <li>Destaque: ${beneficios.destaque || 'Não'}</li>
          <li>Raio de atendimento: ${beneficios.raioAtendimento} km</li>
          <li>Cidades extras: ${beneficios.cidadesExtras}</li>
          <li>Fotos no perfil: ${beneficios.fotosNoPerfil}</li>
          <li>Leads ao mês: ${beneficios.leadsAoMes}</li>
          <li>Métricas: ${beneficios.metricas || 'Não'}</li>
          <li>Top 10: ${beneficios.top10 ? 'Sim' : 'Não'}</li>
        </ul>
        <button class="btn btn-primary" onclick="assinarPlano('${plano}')">
          Assinar ${beneficios.nome}
        </button>
      `;

      container.innerHTML = html;
    } catch (error) {
      console.error(`Erro ao carregar benefícios de ${plano}:`, error);
    }
  }
}

document.addEventListener('DOMContentLoaded', carregarBeneficios);
```

### CSS

```css
.planos-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  margin: 2rem 0;
}

.plano-card {
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
}

.plano-card:hover {
  border-color: #2563eb;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.1);
}

.plano-header h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.preco {
  font-size: 1.25rem;
  color: #2563eb;
  font-weight: bold;
  margin-bottom: 1rem;
}

.beneficios-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  text-align: left;
}

.beneficios-list li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #f0f0f0;
}

.beneficios-list li:last-child {
  border-bottom: none;
}
```

---

## 3. Simulador de Pagamento

### HTML

```html
<div class="simulador-pagamento">
  <h2>Simulador de Pagamento</h2>
  <form id="form-simulador">
    <div class="form-group">
      <label for="valor">Valor (R$)</label>
      <input type="number" id="valor" placeholder="100.00" min="0" step="0.01" required>
    </div>

    <div class="form-group">
      <label for="metodo">Método de Pagamento</label>
      <select id="metodo" required>
        <option value="app">Pix/Cartão (via app)</option>
        <option value="whatsapp">WhatsApp Direto</option>
      </select>
    </div>

    <button type="submit" class="btn btn-primary">Simular</button>
  </form>

  <div id="resultado-simulacao" style="display: none; margin-top: 2rem;">
    <div class="resultado-card">
      <p><strong>Valor:</strong> R$ <span id="sim-valor">0.00</span></p>
      <p><strong>Taxa:</strong> R$ <span id="sim-taxa">0.00</span></p>
      <p><strong>Total:</strong> R$ <span id="sim-total">0.00</span></p>
      <p><em id="sim-descricao"></em></p>
    </div>
  </div>
</div>
```

### JavaScript

```javascript
document.getElementById('form-simulador').addEventListener('submit', async (e) => {
  e.preventDefault();

  const valor = document.getElementById('valor').value;
  const metodo = document.getElementById('metodo').value;

  try {
    const response = await fetch(`/api/pagamento/simular?valor=${valor}&metodo=${metodo}`);
    const data = await response.json();

    if (!data.ok) {
      alert('Erro ao simular: ' + data.error);
      return;
    }

    const { valor: v, taxa, valorComTaxa, descricao } = data;

    document.getElementById('sim-valor').textContent = v.toFixed(2);
    document.getElementById('sim-taxa').textContent = taxa.toFixed(2);
    document.getElementById('sim-total').textContent = valorComTaxa.toFixed(2);
    document.getElementById('sim-descricao').textContent = descricao;

    document.getElementById('resultado-simulacao').style.display = 'block';
  } catch (error) {
    console.error('Erro:', error);
    alert('Erro ao simular pagamento');
  }
});
```

---

## 4. Checkout de Assinatura

### HTML

```html
<div class="checkout-container">
  <h2>Escolha seu Plano</h2>
  <div class="planos-checkout">
    <button class="plano-btn" onclick="iniciarCheckout('pro')">
      Assinar Pro - R$ 29,90/mês
    </button>
    <button class="plano-btn" onclick="iniciarCheckout('premium')">
      Assinar Premium - R$ 49,90/mês
    </button>
  </div>
  <div id="checkout-status"></div>
</div>
```

### JavaScript

```javascript
async function iniciarCheckout(plano) {
  const statusDiv = document.getElementById('checkout-status');
  statusDiv.innerHTML = '<p>Processando...</p>';

  try {
    const response = await fetch('/api/pay/asaas/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan: plano }),
    });

    const data = await response.json();

    if (!data.ok) {
      statusDiv.innerHTML = `<p style="color: red;">Erro: ${data.error}</p>`;
      return;
    }

    // Redirecionar para o link de pagamento
    if (data.paymentUrl) {
      window.location.href = data.paymentUrl;
    } else {
      statusDiv.innerHTML = `<p style="color: orange;">Redirecionando para o Asaas...</p>`;
      setTimeout(() => {
        window.location.href = data.redirectUrl;
      }, 2000);
    }
  } catch (error) {
    console.error('Erro:', error);
    statusDiv.innerHTML = '<p style="color: red;">Erro ao processar checkout</p>';
  }
}
```

---

## 5. Histórico de Pagamentos

### HTML

```html
<div class="historico-pagamentos">
  <h2>Histórico de Pagamentos</h2>
  <table id="tabela-pagamentos">
    <thead>
      <tr>
        <th>Data</th>
        <th>Valor</th>
        <th>Taxa</th>
        <th>Total</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="tbody-pagamentos">
      <tr><td colspan="5">Carregando...</td></tr>
    </tbody>
  </table>
</div>
```

### JavaScript

```javascript
async function carregarHistorico() {
  try {
    const response = await fetch('/api/pagamento/historico');
    const data = await response.json();

    if (!data.ok) {
      console.error('Erro ao carregar histórico:', data.error);
      return;
    }

    const { pagamentos } = data;
    const tbody = document.getElementById('tbody-pagamentos');

    if (pagamentos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">Nenhum pagamento registrado</td></tr>';
      return;
    }

    const html = pagamentos.map(p => `
      <tr>
        <td>${new Date(p.criadoEm).toLocaleDateString('pt-BR')}</td>
        <td>R$ ${p.valor.toFixed(2)}</td>
        <td>R$ ${p.taxa.toFixed(2)}</td>
        <td>R$ ${p.valorComTaxa.toFixed(2)}</td>
        <td>
          <span class="status-badge status-${p.status}">
            ${p.status.charAt(0).toUpperCase() + p.status.slice(1)}
          </span>
        </td>
      </tr>
    `).join('');

    tbody.innerHTML = html;
  } catch (error) {
    console.error('Erro:', error);
    document.getElementById('tbody-pagamentos').innerHTML = '<tr><td colspan="5">Erro ao carregar</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', carregarHistorico);
```

### CSS

```css
.historico-pagamentos {
  margin: 2rem 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

table thead {
  background-color: #f5f5f5;
}

table th, table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

table th {
  font-weight: bold;
  color: #333;
}

.status-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
}

.status-pendente {
  background-color: #fef3c7;
  color: #92400e;
}

.status-concluido {
  background-color: #dcfce7;
  color: #166534;
}

.status-cancelado {
  background-color: #fee2e2;
  color: #991b1b;
}
```

---

## 6. Cancelar Assinatura

### HTML

```html
<div class="cancelar-assinatura">
  <h2>Gerenciar Assinatura</h2>
  <button id="btn-cancelar" class="btn btn-danger">Cancelar Assinatura</button>
  <div id="cancelar-status"></div>
</div>
```

### JavaScript

```javascript
document.getElementById('btn-cancelar').addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja cancelar sua assinatura? Você será downgrade para o plano Free.')) {
    return;
  }

  const statusDiv = document.getElementById('cancelar-status');
  statusDiv.innerHTML = '<p>Processando cancelamento...</p>';

  try {
    const response = await fetch('/api/plano/cancelar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!data.ok) {
      statusDiv.innerHTML = `<p style="color: red;">Erro: ${data.error}</p>`;
      return;
    }

    statusDiv.innerHTML = `<p style="color: green;">${data.message}</p>`;

    // Recarregar status do plano após 2 segundos
    setTimeout(() => {
      location.reload();
    }, 2000);
  } catch (error) {
    console.error('Erro:', error);
    statusDiv.innerHTML = '<p style="color: red;">Erro ao cancelar assinatura</p>';
  }
});
```

### CSS

```css
.cancelar-assinatura {
  background-color: #fef2f2;
  border: 2px solid #fecaca;
  border-radius: 12px;
  padding: 2rem;
  margin: 2rem 0;
}

.btn-danger {
  background-color: #dc2626;
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.3s ease;
}

.btn-danger:hover {
  background-color: #b91c1c;
}
```

---

## 🔗 Integração Completa

Para integrar todos esses exemplos em uma única página:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Planos e Pagamentos - Autônoma.app</title>
  <link rel="stylesheet" href="/css/global.css">
  <style>
    /* CSS dos exemplos acima */
  </style>
</head>
<body>
  <header class="header">
    <a href="/" class="logo">Autônoma</a>
  </header>

  <main class="wrap">
    <!-- Status do Plano -->
    <div id="status-plano" class="card"></div>

    <!-- Simulador de Pagamento -->
    <div class="simulador-pagamento card"></div>

    <!-- Planos Disponíveis -->
    <div class="planos-container"></div>

    <!-- Histórico de Pagamentos -->
    <div class="historico-pagamentos card"></div>

    <!-- Cancelar Assinatura -->
    <div class="cancelar-assinatura"></div>
  </main>

  <footer>
    <nav class="foot-links">
      <a href="/termos.html">Termos</a>
      <a href="/privacidade.html">Privacidade</a>
    </nav>
  </footer>

  <!-- Scripts -->
  <script src="/js/monetizacao.js"></script>
</body>
</html>
```

---

## ✅ Checklist de Implementação Frontend

- [ ] Status do plano carregando corretamente
- [ ] Benefícios dos planos exibindo com precisão
- [ ] Simulador calculando taxa corretamente
- [ ] Checkout redirecionando para Asaas
- [ ] Histórico de pagamentos listando transações
- [ ] Cancelamento de assinatura funcionando
- [ ] Responsividade em mobile, tablet e desktop
- [ ] Mensagens de erro exibindo corretamente
- [ ] Carregamento de dados sem erros no console

---

**Última atualização:** 30 de outubro de 2025  
**Versão:** 1.0
