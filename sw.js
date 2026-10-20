// Offline cache. Bump VERSION when files change so students get the update.
const VERSION = 'v69';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'lib/ts-fsrs.umd.js', 'manifest.webmanifest', 'icons/v2/favicon-64.png', 'icons/v2/icon-maskable-512.png', 'icons/v2/apple-touch-icon.png', 'icons/v2/icon-192.png', 'icons/v2/icon-512.png', 'icons/landing.png', 'icons/landing-duo.png', 'icons/logo.png', 'icons/tab0.png', 'icons/tab1.png', 'icons/tab2.png', 'icons/tab3.png', 'icons/tab4.png', 'data/gsat.json', 'data/material.json', 'data/questions.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // network-first (always get the newest files), cache fallback for offline
  const net = fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
  e.respondWith(Promise.race([net, timeout]).catch(() => caches.match(e.request).then(m => m || net)));
});
