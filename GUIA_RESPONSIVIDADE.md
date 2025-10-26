# 📱 Guia de Responsividade e Layout Unificado - Autônoma.app

**Versão:** 1.0  
**Data:** Outubro 2025  
**Objetivo:** Garantir que todas as páginas sejam responsivas para smartphone, tablet e desktop com um layout unificado.

---

## 📋 Índice

1. [Princípios Fundamentais](#princípios-fundamentais)
2. [Estrutura HTML Padrão](#estrutura-html-padrão)
3. [Padrão de CSS Responsivo](#padrão-de-css-responsivo)
4. [Componentes Reutilizáveis](#componentes-reutilizáveis)
5. [Breakpoints de Mídia](#breakpoints-de-mídia)
6. [Checklist de Responsividade](#checklist-de-responsividade)
7. [Exemplos Práticos](#exemplos-práticos)

---

## 🎯 Princípios Fundamentais

### 1. **Mobile-First**
- Comece sempre com o design para **smartphone** (320px - 480px).
- Use media queries para melhorar em telas maiores.
- Priorize o conteúdo essencial no mobile.

### 2. **Unidades Responsivas**
Use unidades que escalam com o tamanho da tela:

| Unidade | Uso | Exemplo |
| :--- | :--- | :--- |
| `px` | Valores fixos (bordas, raios) | `border-radius: 12px` |
| `rem` | Baseado no tamanho da fonte raiz | `padding: 1.5rem` |
| `%` | Relativo ao pai | `width: 100%` |
| `vw` / `vh` | Relativo à viewport | `font-size: clamp(14px, 2.6vw, 20px)` |
| `clamp()` | Escala automática entre mín/máx | `padding: clamp(16px, 6vw, 48px)` |

### 3. **Função `clamp()`**
A função `clamp()` é essencial para responsividade fluida:

```css
/* clamp(mínimo, preferido, máximo) */
font-size: clamp(14px, 2.6vw, 20px);
padding: clamp(16px, 6vw, 48px);
width: min(90%, 380px);
```

### 4. **Flexbox e Grid**
- Use `display: flex` para layouts lineares.
- Use `display: grid` para layouts complexos.
- Sempre defina `gap` em vez de margin.

---

## 🏗️ Estrutura HTML Padrão

### Viewport Meta (OBRIGATÓRIO)
```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Página • Autônoma.app</title>
  <link rel="stylesheet" href="/css/global.css?v=2.0">
</head>
<body>
  <!-- Conteúdo -->
</body>
</html>
```

### Estrutura de Página Padrão
```html
<body>
  <!-- Header (sticky) -->
  <header class="header">
    <a href="/" class="logo">Autônoma</a>
    <nav class="header-nav">
      <a href="/painel_login.html" class="btn btn-light">Entrar</a>
    </nav>
  </header>

  <!-- Conteúdo Principal -->
  <main class="wrap">
    <!-- Seções com .card ou .section -->
    <section class="card">
      <h1>Título</h1>
      <p>Conteúdo</p>
    </section>
  </main>

  <!-- Footer -->
  <footer>
    <nav class="foot-links">
      <a href="/termos.html">Termos</a>
      <a href="/privacidade.html">Privacidade</a>
    </nav>
  </footer>
</body>
```

---

## 🎨 Padrão de CSS Responsivo

### Variáveis CSS (Definidas em `:root`)
```css
:root {
  /* Cores */
  --primary: #2563EB;
  --secondary: #0B1F63;
  --text-primary: #0F172A;
  --text-secondary: #64748B;
  --bg-main: #F8FAFC;
  --bg-card: #FFFFFF;
  --border-color: #E2E8F0;

  /* Tipografia */
  --font-size-base: 16px;
  --font-size-sm: 14px;
  --font-size-lg: 18px;

  /* Espaçamento */
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;

  /* Raios de borda */
  --border-radius: 12px;
  --border-radius-lg: 16px;

  /* Sombras */
  --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
}
```

### Redimensionamento em Mobile
```css
@media (max-width: 768px) {
  :root {
    --font-size-3xl: 24px;
    --font-size-2xl: 20px;
    --font-size-lg: 18px;
  }

  .wrap {
    padding: var(--spacing-lg) var(--spacing-md);
  }

  .card {
    padding: var(--spacing-lg);
  }

  .row {
    flex-direction: column;
    align-items: stretch;
  }
}
```

---

## 🧩 Componentes Reutilizáveis

### 1. **Botões**
```html
<!-- Primário -->
<button class="btn btn-primary">Entrar</button>

<!-- Outline -->
<button class="btn btn-outline">Cancelar</button>

<!-- Light (para dark backgrounds) -->
<button class="btn btn-light">Ação secundária</button>

<!-- Tamanhos -->
<button class="btn btn-sm">Pequeno</button>
<button class="btn btn-lg">Grande</button>

<!-- Full width -->
<button class="btn btn-block">Largura total</button>
```

### 2. **Cards**
```html
<div class="card">
  <h2>Título do Card</h2>
  <p>Conteúdo do card com padding padrão.</p>
</div>
```

### 3. **Formulários**
```html
<form class="grid">
  <div class="field">
    <label for="nome">Nome</label>
    <input id="nome" type="text" class="input" required>
  </div>

  <div class="field">
    <label for="email">E-mail</label>
    <input id="email" type="email" class="input" required>
  </div>

  <button type="submit" class="btn btn-primary btn-block">Enviar</button>
</form>
```

### 4. **Grid Responsivo**
```html
<!-- 1 coluna em mobile, 2 em tablet, 3 em desktop -->
<div class="grid-2">
  <div class="card">Card 1</div>
  <div class="card">Card 2</div>
  <div class="card">Card 3</div>
</div>
```

### 5. **Badges e Pills**
```html
<span class="badge badge-primary">Novo</span>
<span class="badge badge-success">Ativo</span>
<span class="pill">Filtro</span>
```

---

## 📱 Breakpoints de Mídia

O projeto usa os seguintes breakpoints:

| Breakpoint | Tamanho | Dispositivo |
| :--- | :--- | :--- |
| Mobile | 320px - 480px | Smartphones pequenos |
| Mobile Grande | 480px - 768px | Smartphones grandes |
| Tablet | 768px - 1024px | Tablets |
| Desktop | 1024px+ | Computadores |

### Media Queries Padrão
```css
/* Mobile (padrão) - sem media query */
.elemento { /* estilos para mobile */ }

/* Tablet e acima */
@media (min-width: 768px) {
  .elemento { /* estilos para tablet+ */ }
}

/* Desktop */
@media (min-width: 1024px) {
  .elemento { /* estilos para desktop */ }
}

/* Apenas mobile */
@media (max-width: 767px) {
  .elemento { /* estilos apenas para mobile */ }
}
```

---

## ✅ Checklist de Responsividade

Use este checklist para verificar se uma página é responsiva:

### Estrutura HTML
- [ ] Tem `<meta name="viewport" content="width=device-width, initial-scale=1"/>`
- [ ] Usa `<!doctype html>` correto
- [ ] Tem `<title>` descritivo
- [ ] Usa `lang="pt-BR"` no `<html>`

### CSS Responsivo
- [ ] Usa `clamp()` para fontes e padding fluidos
- [ ] Tem media queries para `768px` e `1024px`
- [ ] Usa `max-width` em `.wrap` (máximo 1200px)
- [ ] Usa `gap` em flexbox/grid (não margin)
- [ ] Usa variáveis CSS (`:root`)

### Layout
- [ ] Header é sticky e responsivo
- [ ] Footer é responsivo
- [ ] Conteúdo tem padding adequado em mobile
- [ ] Imagens usam `max-width: 100%`
- [ ] Botões têm tamanho mínimo de 44px (toque)

### Componentes
- [ ] Botões têm estados (hover, active, disabled)
- [ ] Formulários têm labels associados
- [ ] Inputs têm `type` correto (email, tel, etc.)
- [ ] Cards têm sombra e borda
- [ ] Textos têm contraste adequado

### Testes
- [ ] Testado em mobile (320px, 480px)
- [ ] Testado em tablet (768px)
- [ ] Testado em desktop (1024px+)
- [ ] Sem scroll horizontal
- [ ] Sem elementos cortados

---

## 💡 Exemplos Práticos

### Exemplo 1: Página com Hero + Cards
```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Exemplo • Autônoma.app</title>
  <link rel="stylesheet" href="/css/global.css?v=2.0">
  <style>
    .hero {
      background: linear-gradient(180deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: var(--text-white);
      padding: clamp(20px, 5vw, 48px);
      text-align: center;
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hero h1 {
      font-size: clamp(28px, 8vw, 48px);
      margin-bottom: var(--spacing-lg);
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--spacing-lg);
      margin-top: var(--spacing-xl);
    }

    @media (max-width: 768px) {
      .hero {
        min-height: 200px;
        padding: var(--spacing-lg);
      }

      .cards-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <a href="/" class="logo">Autônoma</a>
  </header>

  <main class="wrap">
    <section class="hero">
      <div>
        <h1>Bem-vindo</h1>
        <p>Encontre profissionais confiáveis no seu bairro</p>
      </div>
    </section>

    <div class="cards-grid">
      <div class="card">
        <h2>Card 1</h2>
        <p>Conteúdo do card 1</p>
      </div>
      <div class="card">
        <h2>Card 2</h2>
        <p>Conteúdo do card 2</p>
      </div>
      <div class="card">
        <h2>Card 3</h2>
        <p>Conteúdo do card 3</p>
      </div>
    </div>
  </main>

  <footer>
    <nav class="foot-links">
      <a href="/termos.html">Termos</a>
      <a href="/privacidade.html">Privacidade</a>
    </nav>
  </footer>
</body>
</html>
```

### Exemplo 2: Formulário Responsivo
```html
<form class="grid">
  <!-- 2 colunas em desktop, 1 em mobile -->
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--spacing-lg);">
    <div class="field">
      <label for="nome">Nome</label>
      <input id="nome" type="text" class="input" required>
    </div>

    <div class="field">
      <label for="email">E-mail</label>
      <input id="email" type="email" class="input" required>
    </div>
  </div>

  <div class="field">
    <label for="mensagem">Mensagem</label>
    <textarea id="mensagem" class="input" rows="6"></textarea>
  </div>

  <div style="display: flex; gap: var(--spacing-md); justify-content: flex-end;">
    <button type="reset" class="btn btn-light">Limpar</button>
    <button type="submit" class="btn btn-primary">Enviar</button>
  </div>
</form>
```

---

## 🔧 Dicas de Otimização

### 1. **Imagens Responsivas**
```html
<!-- Sempre use max-width: 100% -->
<img src="/img/exemplo.png" alt="Descrição" style="max-width: 100%; height: auto;">

<!-- Ou use picture para múltiplas resoluções -->
<picture>
  <source media="(min-width: 1024px)" srcset="/img/grande.png">
  <source media="(min-width: 768px)" srcset="/img/media.png">
  <img src="/img/pequena.png" alt="Descrição">
</picture>
```

### 2. **Fontes Fluidas**
```css
/* Em vez de mudar font-size em cada breakpoint, use clamp() -->
h1 { font-size: clamp(28px, 8vw, 48px); }
p { font-size: clamp(14px, 2vw, 18px); }
```

### 3. **Padding Fluido**
```css
/* Padding que escala com a tela -->
.card {
  padding: clamp(16px, 4vw, 32px);
}
```

### 4. **Grid Auto-Responsivo**
```css
/* Sem media queries! -->
.grid-auto {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacing-lg);
}
```

---

## 📞 Suporte e Dúvidas

Se tiver dúvidas sobre responsividade, consulte:
- [MDN: Responsive Design](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)
- [CSS-Tricks: A Complete Guide to Grid](https://css-tricks.com/snippets/css/complete-guide-grid/)
- [CSS-Tricks: A Complete Guide to Flexbox](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)

---

**Versão:** 1.0 | **Última atualização:** Outubro 2025

