// test-wa.js
require('dotenv').config(); // carrega .env

// Node 18+ já tem fetch global
async function sendTestMessage() {
  const TOKEN   = process.env.WA_TOKEN || '';
  const PHONEID = process.env.WA_PHONE_ID || '';
  const TO      = '5521971891276'; // seu número pessoal (E.164)

  // logs de diagnóstico
  console.log('PHONE_ID:', PHONEID);
  console.log('TOKEN len:', TOKEN.length, 'startsWith EAA?:', TOKEN.startsWith('EAA'));

  if (!TOKEN || TOKEN.length < 50) {
    throw new Error('WA_TOKEN ausente/curto. Verifique seu .env e se dotenv está carregando.');
  }
  if (!/^\d{10,20}$/.test(PHONEID)) {
    throw new Error('WA_PHONE_ID inválido. Use o "Phone number ID" que aparece na tela API Setup (não é o Business ID).');
  }

  const url = `https://graph.facebook.com/v22.0/${PHONEID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: TO,
    type: "text",
    text: { body: "🚀 Teste Autonoma.app com token permanente!" }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  console.log('HTTP', resp.status, data);
}

sendTestMessage().catch(e => console.error('ERRO:', e.message));