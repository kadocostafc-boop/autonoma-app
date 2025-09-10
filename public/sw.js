// sw.js — Autônoma.app (v37)
// Estratégias:
//  - APIs:           network-only (sem cache)
//  - HTML:           network-first com fallback offline
//  - CSS/JS/ICONS:   stale-while-revalidate
//  - IMAGENS:        cache-first com LRU (limite) + fallback
//  - APK:            sempre rede (no-store)
// Observação: não intercepta métodos ≠ GET

const VERSION      = 'v37';
const CACHE_STATIC = `autonoma-static-${VERSION}`;
const CACHE_HTML   = `autonoma-html-${VERSION}`;
const CACHE_IMG    = `autonoma-img-${VERSION}`;
const ALL_CACHES   = [CACHE_STATIC, CACHE_HTML, CACHE_IMG];

// Shell básico para navegação rápida (mantenha leve)
const CORE = [
  '/', '/index.html',
  '/css/app.css',
  '/img/logo.png', '/favicon.ico',
  '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png',
  // Páginas principais do app
  '/clientes.html', '/perfil.html', '/avaliar.html',
  '/favoritos.html', '/top10.html', '/planos.html',
  '/termos.html', '/privacidade.html', '/politica-de-seguranca.html',
  '/admin.html'
];

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><title>Autônoma.app</title>' +
  '<body style="font-family:system-ui,Arial,sans-serif;padding:20px">' +
  '<h1>Você está offline</h1><p>Tente novamente quando sua conexão voltar.</p></body>';

const IMG_FALLBACK = '/icons/icon-192.png';

// ------------------------------ Utils ------------------------------
function isAPI(url) {
  return url.pathname.startsWith('/api/');
}
function isAPK(url) {
  return url.pathname.endsWith('.apk') ||
         (url.pathname.startsWith('/app/') && url.pathname.endsWith('.apk'));
}
function isHTML(req, url) {
  // Trata navegações e .html como HTML
  return req.mode === 'navigate' ||
         url.pathname.endsWith('.html') ||
         (req.headers.get('accept') || '').includes('text/html');
}
function isStaticAsset(url) {
  // CSS/JS/ico/png/svg/webp/jpg/json/manifest, etc (exceto /uploads/)
  if (url.pathname.startsWith('/uploads/')) return false;
  return /\.(css|js|mjs|ico|png|svg|webp|jpg|jpeg|gif|json|webmanifest|txt|map)$/i.test(url.pathname);
}
function isImage(url) {
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(url.pathname) || url.pathname.startsWith('/uploads/');
}

async function putCache(cacheName, req, res) {
  try {
    const c = await caches.open(cacheName);
    await c.put(req, res.clone());
  } catch {}
}

async function cleanOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.map(n => {
    if (!ALL_CACHES.includes(n)) return caches.delete(n);
  }));
}

async function limitCacheSize(cacheName, maxEntries = 120) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const remove = keys.length - maxEntries;
    for (let i = 0; i < remove; i++) {
      await cache.delete(keys[i]);
    }
  } catch {}
}

// Broadcast para todos os clients (informar atualização de versão)
async function broadcast(type, data) {
  try {
    const clis = await self.clients.matchAll({ includeUncontrolled: true });
    for (const cli of clis) cli.postMessage({ type, ...data });
  } catch {}
}

// ------------------------------ Install ------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_STATIC);
      await cache.addAll(CORE);
    } catch {}
    // Navigation Preload ajuda bastante em mobile
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    self.skipWaiting();
  })());
});

// ------------------------------ Activate ------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await cleanOldCaches();
    await self.clients.claim();
    await broadcast('SW_ACTIVATED', { version: VERSION });
  })());
});

// ------------------------------ Fetch Strategies ------------------------------
async function networkOnly(req) {
  // Usado p/ APIs e APK (sem cache)
  return fetch(req);
}

async function networkFirstHTML(event, req) {
  // Tenta rede primeiro; se falhar, usa cache; se nada, offline-fallback
  try {
    // Usa navigation preload quando disponível
    const preload = ('preloadResponse' in event) ? await event.preloadResponse : null;
    const net = preload || await fetch(req, { cache: 'no-store' });

    // Cacheia 200/opaqueredirect de navegação
    if (net && (net.ok || net.type === 'opaqueredirect')) {
      await putCache(CACHE_HTML, req, net.clone());
    }
    return net;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidateStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  const fetchPromise = (async () => {
    try {
      const net = await fetch(req, { cache: 'no-store' });
      if (net && net.ok) await cache.put(req, net.clone());
    } catch {}
  })();
  // entrega cache imediato; se não tiver, tenta rede
  return cached || fetchPromise.then(() => caches.match(req)) || fetch(req);
}

async function cacheFirstImage(req) {
  const cache = await caches.open(CACHE_IMG);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const net = await fetch(req, { cache: 'no-store' });
    if (net && net.ok) {
      await cache.put(req, net.clone());
      await limitCacheSize(CACHE_IMG, 120);
    }
    return net;
  } catch {
    return (await caches.match(IMG_FALLBACK)) ||
           new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

// Roteamento principal
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // não intercepta POST/PUT/etc

  const url = new URL(req.url);

  // APIs => network-only
  if (isAPI(url)) {
    event.respondWith(networkOnly(req).catch(
      () => new Response('', { status: 504, statusText: 'Gateway Timeout' })
    ));
    return;
  }

  // APK => sempre rede (no-store)
  if (isAPK(url)) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(
      () => new Response('', { status: 504, statusText: 'Gateway Timeout' })
    ));
    return;
  }

  // CROSS-ORIGIN (ex.: CDN de imagem)
  if (url.origin !== self.location.origin) {
    if (isImage(url)) {
      event.respondWith(cacheFirstImage(req));
    } else {
      event.respondWith((async () => {
        try {
          return await fetch(req);
        } catch {
          const cached = await caches.match(req);
          return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
        }
      })());
    }
    return;
  }

  // HTML (navegação/páginas)
  if (isHTML(req, url)) {
    event.respondWith(networkFirstHTML(event, req));
    return;
  }

  // Estáticos locais (css/js/ícones/etc) => SWR
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidateStatic(req));
    return;
  }

  // Imagens locais (/uploads e demais)
  if (isImage(url)) {
    event.respondWith(cacheFirstImage(req));
    return;
  }

  // Default: tenta rede, cai no cache se existir
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      const cached = await caches.match(req);
      return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});

// ------------------------------ Mensagens ------------------------------
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;
  if (data === 'SKIP_WAITING' || data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});