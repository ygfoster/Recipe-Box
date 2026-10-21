// オフラインでも開けるように、アプリ本体をキャッシュする
const CACHE = 'rb-v4';
const SHELL = [
  './', './index.html', './style.css', './app.js', './cloud.js', './firebase-config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 通信が遅いときは3秒でキャッシュに切り替える
function networkFirst(req, cacheKey) {
  return caches.open(CACHE).then((cache) => {
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(cacheKey, res.clone());
      return res;
    });
    const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => cache.match(cacheKey));
    return Promise.race([net, slow])
      .then((res) => res || net)
      .catch(() => cache.match(cacheKey));
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // バージョン固定の Firebase SDK はキャッシュ優先
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }))
    ));
    return;
  }
  if (url.origin !== location.origin) return;

  // 共有メニューから開いたとき(?share_text=...)も同じページを返す
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }
  e.respondWith(networkFirst(req, req));
});
