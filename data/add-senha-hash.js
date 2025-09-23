// add-senha-hash.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

if(process.argv.length < 4){
  console.log('Uso: node add-senha-hash.js <email|whatsapp> <senhaPlain>');
  process.exit(1);
}

const identifier = process.argv[2]; // email ou whatsapp (com ou sem 55)
const senha = process.argv[3];

// ajuste o caminho conforme sua estrutura
const FILE = path.join(__dirname, 'profissionais.json'); // <-- ajuste se necessário

const dbText = fs.readFileSync(FILE, 'utf8');
let arr = JSON.parse(dbText);

const findBy = (p) => {
  if(!p) return false;
  if(String(p.email || '').toLowerCase() === identifier.toLowerCase()) return true;
  if(String(p.whatsapp || '') === identifier || String(p.telefone || '') === identifier) return true;
  // também compara sem 55 e com 55
  if(String(p.whatsapp || '').endsWith(identifier)) return true;
  return false;
};

const pro = arr.find(findBy);
if(!pro){
  console.error('Usuário não encontrado. Verifique email/whatsapp e o caminho do arquivo.');
  process.exit(2);
}

const hash = bcrypt.hashSync(senha, 10);
pro.senhaHash = hash;

// opcional: remova campo senha texto se existir
if(pro.senha) delete pro.senha;

fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), 'utf8');
console.log('OK. senhaHash adicionada para id=', pro.id);
console.log('senhaHash:', hash);