// sw.js — Autônoma.app • cache PWA
// Versão do cache: altere a cada mudança nos arquivos core
const VERSION = 'v6'; // << suba este número quando trocar a lista CORE

// Arquivos essenciais para funcionar offline
const CORE = [
  '/', '/index.html',
  '/css/app.css',
  '/img/logo.png',
  '/favicon.ico',

  // Páginas públicas principais
  '/clientes.html',
  '/cadastro.html',
  '/favoritos.html',
  '/cadastro_sucesso.html',
  '/denunciar.html',

  // Jurídico / SEO
  '/termos-de-uso.html',
  '/politica-de-privacidade.html',

  // PWA
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(CORE)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== VERSION) && caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Estratégia: cache-first com atualização em segundo plano
  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req)
        .then(res => {
          // Cacheia somente respostas 200 "basic" (mesma origem)
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'opaqueredirect')) {
            const cloned = res.clone();
            caches.open(VERSION).then(cache => cache.put(req, cloned)).catch(()=>{});
          }
          return res;
        })
        .catch(() => cached); // se offline, devolve o cache (se existir)

      // Retorna cache imediatamente se existir, senão rede
      return cached || fetchPromise;
    })
  );
});

// Opcional: mensagem para forçar update do SW pelos clientes
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});