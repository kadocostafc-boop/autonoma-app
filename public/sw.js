// sw.js — Autônoma.app (v21)
// Estratégia: network-first p/ estáticos, network-only p/ APIs.
// Garante Response sempre válido e nunca intercepta POST/PUT etc.

const VERSION = 'v21';
const CACHE_NAME = 'autonoma-' + VERSION;

const CORE = [
  '/', '/index.html', '/css/app.css', '/img/logo.png', '/favicon.ico',
  '/clientes.html', '/cadastro.html', '/favoritos.html', '/cadastro_sucesso.html', '/denunciar.html',
  '/termos-de-uso.html', '/politica-de-privacidade.html',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'
];

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8">
<title>Autônoma.app</title>
<body style="font-family:system-ui,Arial,sans-serif;padding:20px">
<h1>Você está offline</h1>
<p>Tente novamente quando sua conexão voltar.</p>
</body>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { const cache = await caches.open(CACHE_NAME); await cache.addAll(CORE); } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => n !== CACHE_NAME ? caches.delete(n) : null));
    self.clients.claim();
  })());
});

async function safeHandle(request) {
  const url = new URL(request.url);

  // 🔴 APIs: sempre rede, sem cache
  if (url.pathname.startsWith('/api/')) {
    try { return await fetch(request); }
    catch { return new Response('', { status: 504, statusText: 'Gateway Timeout' }); }
  }

  // Cross-origin: tenta rede e, se falhar, cai no cache
  if (url.origin !== self.location.origin) {
    try { return await fetch(request); }
    catch {
      const cached = await caches.match(request);
      return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  }

  // Mesma origem: network-first + atualiza cache (só GET OK)
  try {
    const net = await fetch(request);
    if (request.method === 'GET' && net && net.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, net.clone()).catch(()=>{});
    }
    return net;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // não intercepta POST/PUT/etc
  event.respondWith(safeHandle(req));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});