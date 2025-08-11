// index.js (substitua todo o arquivo)
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3000;

// Middleware para receber dados de formulários
app.use(express.urlencoded({ extended: true }));

// Pasta pública para servir imagens enviadas
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cria a pasta uploads se não existir
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configuração do multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  }
});

// Função auxiliar para ler/escrever JSON (profissionais.json)
const DB_FILE = path.join(__dirname, 'profissionais.json');
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Erro lendo DB:', e);
    return [];
  }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Rota: formulario de cadastro (arquivo cadastro.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'cadastro.html'));
});

// Rota: processar cadastro com upload da foto (campo name="foto")
app.post('/cadastrar', upload.single('foto'), (req, res) => {
  try {
    const { nome, idade, profissao, experiencia, local, telefone, descricao } = req.body;
    const fotoPath = req.file ? `/uploads/${req.file.filename}` : '';

    const novo = {
      nome: nome || '',
      idade: idade || '',
      profissao: profissao || '',
      experiencia: experiencia || '',
      local: local || '',
      telefone: telefone || '',
      descricao: descricao || '',
      foto: fotoPath
    };

    const profissionais = readDB();
    profissionais.push(novo);
    writeDB(profissionais);
    console.log('Novo profissional salvo:', novo.nome);
    return res.redirect('/profissionais');
  } catch (err) {
    console.error('Erro no upload:', err.message || err);
    return res.status(500).send('Erro ao salvar os dados: ' + (err.message || ''));
  }
});

// Rota: listar profissionais (com imagens e botão WhatsApp)
app.get('/profissionais', (req, res) => {
  const profissionais = readDB();

  let html = `
  <!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Profissionais cadastrados</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body { font-family: Arial, sans-serif; background:#f4f6f8; padding:20px; }
      .card { background:#fff; border-radius:12px; padding:16px; margin-bottom:16px; box-shadow:0 4px 12px rgba(0,0,0,0.06); display:flex; gap:16px; align-items:center; }
      .foto { width:100px; height:100px; object-fit:cover; border-radius:50%; border:2px solid #eee; }
      .info { flex:1; }
      .nome { font-weight:700; font-size:18px; margin-bottom:6px; }
      .meta { color:#666; margin-bottom:8px; }
      .sobre { margin-bottom:8px; }
      .whatsapp { background:#25D366; color:#fff; padding:8px 12px; text-decoration:none; border-radius:8px; font-weight:600; }
      .voltar { display:inline-block; margin-top:18px; text-decoration:none; color:#007bff; }
    </style>
  </head>
  <body>
    <h1>Profissionais cadastrados</h1>
  `;

  if (!profissionais.length) {
    html += `<p>Nenhum profissional cadastrado ainda.</p>`;
  } else {
    profissionais.forEach(p => {
      const foto = p.foto && p.foto !== '' ? p.foto : 'https://via.placeholder.com/100';
      const phone = p.telefone ? p.telefone.replace(/\D/g, '') : '';
      const waLink = phone ? `https://wa.me/55${phone}` : null;

      html += `
        <div class="card">
          <img class="foto" src="${foto}" alt="Foto ${p.nome}" />
          <div class="info">
            <div class="nome">${p.nome} — ${p.profissao}</div>
            <div class="meta">${p.local} • ${p.experiencia} • ${p.idade} anos</div>
            <div class="sobre">${p.descricao || ''}</div>
            ${ waLink ? `<a class="whatsapp" href="${waLink}" target="_blank">Falar no WhatsApp</a>` : ''}
          </div>
        </div>
      `;
    });
  }

  html += `<a class="voltar" href="/">← Voltar ao cadastro</a></body></html>`;
  res.send(html);
});

// Inicia o servidor
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
