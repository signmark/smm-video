// Service Worker для PWA - SMM Manager
// NETWORK-ONLY стратегия для JS/HTML - всегда свежие файлы!
const CACHE_VERSION = 'v2.1.0-no-js-intercept';
const CACHE_NAME = `smm-manager-${CACHE_VERSION}`;

// Только статические ресурсы (иконки, шрифты)
const STATIC_ASSETS = [
  '/favicon.png',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png'
];

// Установка - очищаем ВСЕ старые кеши
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v2.1.0 NO-JS-INTERCEPT');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(names.map(name => caches.delete(name)));
    }).then(() => {
      return caches.open(CACHE_NAME);
    }).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Активация - захватываем все вкладки
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v2.1.0 NO-JS-INTERCEPT');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch - НЕ перехватываем HTML/JS (браузер работает с ними напрямую)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // API - пропускаем
  if (url.pathname.startsWith('/api/')) return;

  // HTML и JS - НЕ перехватываем: браузер сам делает запрос напрямую.
  // Если SW делает event.respondWith(fetch(...)) и fetch падает (сеть недоступна,
  // сервер перезапускается), браузер получает "network error response" и
  // dynamic import() ломается с "Failed to fetch" -> Invalid hook call.
  const isHTML = event.request.headers.get('accept')?.includes('text/html') ||
                 url.pathname === '/' ||
                 url.pathname.endsWith('.html');
  const isJS = url.pathname.endsWith('.js') ||
               url.pathname.endsWith('.mjs') ||
               url.pathname.includes('/assets/');

  if (isHTML || isJS) {
    return; // Не перехватываем — браузер обрабатывает сам
  }

  // Статика (изображения, шрифты) - кеш с фоллбеком на сеть
  const isStatic = /\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|ico|css)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Всё остальное - сеть с graceful fallback
  event.respondWith(
    fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
  );
});

// Сообщения от клиента
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  }
});

console.log('[SW] Loaded v2.1.0 NO-JS-INTERCEPT');
