# 📱 Plano de Teste de Responsividade - Autônoma.app

**Versão:** 1.0  
**Data:** Outubro 2025  
**Objetivo:** Validar a responsividade de todas as páginas em smartphone, tablet e desktop.

---

## 🎯 Resumo Executivo

Este documento fornece um **plano de teste estruturado** para garantir que todas as páginas do Autônoma.app funcionem corretamente em diferentes tamanhos de tela.

---

## 📱 Resoluções de Teste

| Dispositivo | Resolução | Largura | Altura |
| :--- | :--- | :--- | :--- |
| **iPhone SE** | 375 x 667 | 375px | 667px |
| **iPhone 12** | 390 x 844 | 390px | 844px |
| **Samsung Galaxy S21** | 360 x 800 | 360px | 800px |
| **iPad (7ª geração)** | 810 x 1080 | 810px | 1080px |
| **iPad Pro** | 1024 x 1366 | 1024px | 1366px |
| **Desktop (HD)** | 1366 x 768 | 1366px | 768px |
| **Desktop (Full HD)** | 1920 x 1080 | 1920px | 1080px |

---

## 🧪 Checklist de Teste por Página

### 1. **Home (`index.html`)**

#### Mobile (375px)
- [ ] Header está visível e sticky
- [ ] Logo é responsivo
- [ ] Botão "Entrar" está acessível
- [ ] Hero section tem padding adequado
- [ ] Título "Autônoma" é legível (não quebra)
- [ ] Slogan tem tamanho de fonte adequado
- [ ] Botões CTA (Cliente, Cadastrar) têm tamanho mínimo de 44px
- [ ] Chips (vantagens) não quebram a linha
- [ ] Botão "Baixar app" é visível
- [ ] Footer é responsivo
- [ ] Sem scroll horizontal

#### Tablet (810px)
- [ ] Layout expande adequadamente
- [ ] Botões CTA estão lado a lado (se houver espaço)
- [ ] Hero section tem altura apropriada
- [ ] Textos mantêm legibilidade

#### Desktop (1920px)
- [ ] Hero section usa toda a largura
- [ ] Máximo de 1200px de largura (`.wrap-max`)
- [ ] Espaçamento adequado nas laterais
- [ ] Todos os elementos estão alinhados

---

### 2. **Clientes (`clientes.html`)**

#### Mobile (375px)
- [ ] Header com navegação é responsivo
- [ ] Seção de busca (hero) tem padding adequado
- [ ] Checkbox "Usar minha localização" é clicável
- [ ] Filtros estão em **1 coluna** (não lado a lado)
- [ ] Inputs têm tamanho mínimo de 44px de altura
- [ ] Grid de cards está em **1 coluna**
- [ ] Cards não são cortados
- [ ] Botões de paginação estão acessíveis
- [ ] Footer é responsivo
- [ ] Sem scroll horizontal

#### Tablet (810px)
- [ ] Filtros começam a se organizar em **2 colunas**
- [ ] Grid de cards está em **2 colunas**
- [ ] Cards têm tamanho adequado
- [ ] Espaçamento entre cards é consistente

#### Desktop (1920px)
- [ ] Filtros estão em **1 linha** (5 colunas)
- [ ] Grid de cards está em **3 colunas**
- [ ] Máximo de largura é respeitado
- [ ] Espaçamento lateral é adequado

---

### 3. **Login (`painel_login.html`)**

#### Mobile (375px)
- [ ] Card de login é centralizado
- [ ] Largura máxima é 92vw (não ultrapassa a tela)
- [ ] Labels são visíveis
- [ ] Inputs têm tamanho mínimo de 44px de altura
- [ ] Campo de identificador (WhatsApp/Email) é claro
- [ ] Campo de senha tem toggle de visibilidade (olho)
- [ ] Botão "Esqueci minha senha" é clicável
- [ ] Botões de ação (Criar conta, Entrar) estão empilhados ou lado a lado
- [ ] Modal de "Redefinir senha" é responsivo
- [ ] Sem scroll horizontal

#### Tablet (810px)
- [ ] Card tem largura apropriada
- [ ] Campos de identificador e senha podem estar lado a lado
- [ ] Botões estão bem espaçados

#### Desktop (1920px)
- [ ] Card tem largura máxima de 680px
- [ ] Campos estão em 3 colunas (identificador, senha, olho)
- [ ] Espaçamento é adequado

---

### 4. **Painel do Profissional (`painel.html`)**

#### Mobile (375px)
- [ ] Header com navegação é responsivo
- [ ] Avatar do profissional é visível
- [ ] Nome, serviço, **e-mail** (NOVO) estão visíveis
- [ ] Seção "Radar" está em 1 coluna
- [ ] Seção "Área de atendimento" está em 1 coluna
- [ ] Seção "Pagamentos" está em 1 coluna
- [ ] Seção "Plano" está em 1 coluna
- [ ] Formulário "Meu perfil" está em 1 coluna
- [ ] Inputs têm tamanho mínimo de 44px
- [ ] Botões são clicáveis
- [ ] Sidebar (resumo) está abaixo do conteúdo principal
- [ ] Sem scroll horizontal

#### Tablet (810px)
- [ ] Layout começa a usar 2 colunas
- [ ] Conteúdo principal e sidebar estão lado a lado
- [ ] Cards têm tamanho adequado

#### Desktop (1920px)
- [ ] Grid principal está em 2 colunas (conteúdo + sidebar)
- [ ] Seções internas usam grid responsivo
- [ ] Máximo de largura é respeitado

---

### 5. **Cadastro (`cadastro.html`)**

#### Mobile (375px)
- [ ] Header é responsivo
- [ ] Título é legível
- [ ] Formulário está em **1 coluna**
- [ ] Inputs têm tamanho mínimo de 44px
- [ ] Labels são visíveis
- [ ] Campos obrigatórios são indicados
- [ ] Botão de envio é clicável
- [ ] Mensagens de erro/sucesso são visíveis
- [ ] Sem scroll horizontal

#### Tablet (810px)
- [ ] Formulário pode usar 2 colunas
- [ ] Campos relacionados estão agrupados
- [ ] Espaçamento é adequado

#### Desktop (1920px)
- [ ] Formulário usa layout otimizado para desktop
- [ ] Máximo de largura é respeitado
- [ ] Espaçamento lateral é adequado

---

## 🔍 Testes Gerais (Todas as Páginas)

### Estrutura HTML
- [ ] Tem `<meta name="viewport" content="width=device-width, initial-scale=1"/>`
- [ ] Usa `<!doctype html>`
- [ ] Tem `<title>` descritivo
- [ ] Usa `lang="pt-BR"`

### CSS e Responsividade
- [ ] Usa `css/global.css` (não `css/app.css`)
- [ ] Tem media queries para `768px` e `1024px`
- [ ] Usa `clamp()` para fontes fluidas
- [ ] Usa `max-width` em `.wrap` ou `.wrap-max`

### Layout
- [ ] Header é sticky e responsivo
- [ ] Footer é responsivo
- [ ] Conteúdo tem padding adequado em mobile
- [ ] Imagens usam `max-width: 100%`
- [ ] Sem scroll horizontal em nenhuma resolução

### Componentes
- [ ] Botões têm tamanho mínimo de 44px (toque)
- [ ] Inputs têm tamanho mínimo de 44px de altura
- [ ] Links têm espaçamento adequado
- [ ] Cards têm sombra e borda
- [ ] Textos têm contraste adequado

### Performance
- [ ] Página carrega em menos de 3 segundos
- [ ] Imagens são otimizadas
- [ ] CSS é carregado corretamente
- [ ] Sem erros no console (F12)

---

## 🛠️ Como Testar

### Opção 1: DevTools do Navegador (Recomendado)

1. **Abra o navegador** (Chrome, Firefox, Safari, Edge)
2. **Pressione `F12`** para abrir o DevTools
3. **Clique no ícone "Device Toolbar"** (ou `Ctrl+Shift+M`)
4. **Selecione o dispositivo** na lista (iPhone, iPad, etc.)
5. **Redimensione manualmente** para testar resoluções customizadas

### Opção 2: Redimensionar a Janela

1. **Abra o navegador** em tela cheia
2. **Redimensione a janela** para diferentes larguras:
   - 375px (mobile)
   - 810px (tablet)
   - 1920px (desktop)

### Opção 3: Dispositivos Reais

1. **Abra o site em um smartphone real**
2. **Abra em um tablet real**
3. **Abra em um desktop real**

---

## 📋 Registro de Testes

Use esta tabela para registrar os resultados dos testes:

| Página | Resolução | Status | Observações |
| :--- | :--- | :--- | :--- |
| index.html | 375px | ⏳ | Aguardando teste |
| index.html | 810px | ⏳ | Aguardando teste |
| index.html | 1920px | ⏳ | Aguardando teste |
| clientes.html | 375px | ⏳ | Aguardando teste |
| clientes.html | 810px | ⏳ | Aguardando teste |
| clientes.html | 1920px | ⏳ | Aguardando teste |
| painel_login.html | 375px | ⏳ | Aguardando teste |
| painel_login.html | 810px | ⏳ | Aguardando teste |
| painel_login.html | 1920px | ⏳ | Aguardando teste |
| painel.html | 375px | ⏳ | Aguardando teste |
| painel.html | 810px | ⏳ | Aguardando teste |
| painel.html | 1920px | ⏳ | Aguardando teste |
| cadastro.html | 375px | ⏳ | Aguardando teste |
| cadastro.html | 810px | ⏳ | Aguardando teste |
| cadastro.html | 1920px | ⏳ | Aguardando teste |

**Legenda:**
- ✅ Passou
- ❌ Falhou
- ⏳ Aguardando
- ⚠️ Parcialmente

---

## 🐛 Relatório de Problemas

Se encontrar problemas durante os testes, registre aqui:

### Problema 1
- **Página:** [nome da página]
- **Resolução:** [tamanho da tela]
- **Descrição:** [o que está errado]
- **Severidade:** [Alta / Média / Baixa]
- **Status:** [Novo / Em análise / Resolvido]

---

## 📞 Próximos Passos

Após completar os testes:

1. **Registre os resultados** na tabela acima
2. **Documente os problemas** encontrados
3. **Priorize as correções** (alta severidade primeiro)
4. **Implemente as correções** seguindo o `GUIA_RESPONSIVIDADE.md`
5. **Re-teste** as páginas corrigidas

---

## 📚 Referências

- [MDN: Responsive Design](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)
- [Google: Mobile-Friendly Test](https://search.google.com/test/mobile-friendly)
- [WebAIM: Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

**Versão:** 1.0 | **Última atualização:** Outubro 2025

