/* ============================================================
   Lumen Library — service worker
   - app shell cache: เปิดแอปได้แม้ไม่มีเน็ตในเส้นทางที่เคยเข้าชม
   - runtime cache: JS/CSS/ฟอนต์/ไอคอน (cache-first)
   - ไม่แคช /api เลย เพื่อไม่ให้ข้อมูลบัญชีของผู้ใช้ค้างในเครื่อง
   ============================================================ */

const IS_DEV = new URL(self.location.href).searchParams.get('env') === 'dev';
const VERSION = 'v1';

const SHELL_CACHE = `lumen-shell-${VERSION}`;
const ASSET_CACHE = `lumen-asset-${VERSION}`;
const MEDIA_CACHE = `lumen-media-${VERSION}`;

const APP_SHELL_KEY = '/__app-shell';
const MEDIA_LIMIT = 60;

const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      // เก็บ HTML ของแอปไว้ล่วงหน้า เพื่อให้เปิดออฟไลน์ได้ตั้งแต่ครั้งแรก
      if (!IS_DEV) {
        try {
          const response = await fetch('/', { cache: 'reload' });
          if (response.ok) await cache.put(APP_SHELL_KEY, response);
        } catch {
          /* ไม่มีเน็ตตอนติดตั้ง — ใช้แคชตอนเปิดหน้าแทน */
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, MEDIA_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('lumen-') && !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // ห้ามแคช API: ข้อมูลผู้ใช้/สิทธิ์ต้องสดเสมอ
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // โหมด dev: ปล่อยผ่านทั้งหมดเพื่อไม่ให้ HMR ได้ไฟล์เก่า
  if (IS_DEV) return;

  if (url.pathname.startsWith('/uploads/')) {
    if (request.destination === 'image') event.respondWith(handleMedia(request));
    return;
  }

  if (['script', 'style', 'font', 'image', 'manifest'].includes(request.destination)) {
    event.respondWith(handleAsset(request));
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(APP_SHELL_KEY, response.clone());
    }
    return response;
  } catch {
    // หน้า static ที่แคชไว้ตรง ๆ (เช่น /offline.html) ต้องได้ไฟล์นั้นก่อน
    const exact = await caches.match(request, { ignoreSearch: true });
    if (exact) return exact;
    const cached = (await caches.match(APP_SHELL_KEY)) || (await caches.match('/offline.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>ออฟไลน์</title><body style="font-family:sans-serif;padding:40px;text-align:center">ยังไม่มีข้อมูลที่บันทึกไว้ — กรุณาเชื่อมต่ออินเทอร์เน็ต</body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function handleMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache, MEDIA_LIMIT);
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
