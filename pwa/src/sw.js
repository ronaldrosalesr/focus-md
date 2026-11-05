// Focus.MD service worker. The app is one HTML file plus fonts, so offline is simple:
// the page comes from the network when it answers quickly (so updates arrive on their
// own) and from the cache otherwise. Documents live in localStorage and never pass here.
const CACHE = 'focusmd-__BUILD__';
const PAGE = new URL('./index.html', self.location).href;
const SHELL = ['./index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png'];
const FONT_CSS = '__FONT_CSS__';
const PAGE_TIMEOUT_MS = 3000;

// Fonts are nice to have offline, so a failure here must not block installing.
async function cacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const css = await res.text();
    const latin = css.split('/* ').filter(b => b.startsWith('latin */'));
    const urls = [...new Set(latin.flatMap(b => b.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/g) || []))];
    await Promise.all(urls.map(u => cache.add(u).catch(() => {})));
  } catch { /* offline during install: fonts fall back to system ones */ }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('focusmd-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function pageFirst(request) {
  const cache = await caches.open(CACHE);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (res.ok) await cache.put(PAGE, res.clone());
    return res;
  } catch {
    return (await cache.match(PAGE)) || Response.error();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === self.location.origin) { e.respondWith(pageFirst(request)); return; }
  const sameApp = url.href.startsWith(new URL('./', self.location).href);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (sameApp || font) e.respondWith(cacheFirst(request));
});
