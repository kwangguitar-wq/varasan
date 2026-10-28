/**
 * ตรวจสอบ PWA แบบ end-to-end บน production build
 * ใช้งาน: npm run build && PORT=4100 node server/index.js &
 *        node scripts/pwa-check.mjs http://localhost:4100
 *
 * ต้องมี Chromium ของ Playwright และ env: LD_LIBRARY_PATH / FONTCONFIG_FILE (ดู README)
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = (process.argv[2] ?? 'http://localhost:4100').replace(/\/$/, '');
const artifactDir = path.resolve('artifacts');
await mkdir(artifactDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function fetchAsset(url) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

// ---------- 1. manifest & asset files ----------
const manifestRes = await fetch(`${base}/manifest.webmanifest`);
const manifestText = await manifestRes.text();
let manifest = null;
try {
  manifest = JSON.parse(manifestText);
} catch {
  manifest = null;
}
check('manifest 200 + JSON ถูกต้อง', manifestRes.ok && manifest !== null, `status ${manifestRes.status}`);
check(
  'manifest content-type ถูกต้อง',
  (manifestRes.headers.get('content-type') ?? '').includes('manifest+json'),
  manifestRes.headers.get('content-type') ?? '',
);
if (manifest) {
  check('ชื่อแอป + short_name', Boolean(manifest.name && manifest.short_name), `${manifest.short_name}`);
  check('start_url & scope = /', manifest.start_url === '/' && manifest.scope === '/');
  check('display = standalone', manifest.display === 'standalone');
  const icons = manifest.icons ?? [];
  const has192 = icons.some((icon) => icon.sizes === '192x192');
  const has512 = icons.some((icon) => icon.sizes === '512x512');
  const hasMaskable = icons.some((icon) => (icon.purpose ?? '').includes('maskable'));
  check('มีไอคอน 192, 512 และ maskable', has192 && has512 && hasMaskable, `${icons.length} ไอคอน`);
  check('มี shortcuts', (manifest.shortcuts ?? []).length >= 2, `${(manifest.shortcuts ?? []).length} รายการ`);
  check('มี screenshots สำหรับหน้าติดตั้ง', (manifest.screenshots ?? []).length >= 2);
}

// ---------- 2. ไฟล์จริงของ manifest ----------
const assetChecks = [];
for (const icon of manifest?.icons ?? []) {
  const url = `${base}${icon.src}`;
  const { response, buffer } = await fetchAsset(url);
  const size = pngSize(buffer);
  const expected = (icon.sizes ?? '').split('x').map(Number);
  const ok =
    response.ok &&
    (response.headers.get('content-type') ?? '').startsWith('image/png') &&
    size &&
    size.width === expected[0] &&
    size.height === expected[1];
  assetChecks.push({ url, ok, detail: `status ${response.status}, ${size ? `${size.width}x${size.height}` : 'ไม่ใช่ PNG'}` });
}
for (const shot of manifest?.screenshots ?? []) {
  const url = `${base}${shot.src}`;
  const { response, buffer } = await fetchAsset(url);
  const size = pngSize(buffer);
  const expected = (shot.sizes ?? '').split('x').map(Number);
  assetChecks.push({
    url,
    ok: response.ok && size?.width === expected[0] && size?.height === expected[1],
    detail: `status ${response.status}, ${size ? `${size.width}x${size.height}` : 'ไม่ใช่ PNG'}`,
  });
}
check(
  'ไฟล์ไอคอน/สกรีนช็อตใน manifest โหลดได้ครบ',
  assetChecks.every((item) => item.ok),
  assetChecks.map((item) => `${item.ok ? '✓' : '✗'} ${item.url.replace(base, '')} (${item.detail})`).join(', '),
);

const offlineRes = await fetch(`${base}/offline.html`);
const offlineHtml = await offlineRes.text();
check('offline.html พร้อมใช้', offlineRes.ok && offlineHtml.includes('ออฟไลน์'));

const swRes = await fetch(`${base}/sw.js`);
const swText = await swRes.text();
check(
  'sw.js พร้อมใช้ + ไม่ถูก HTTP cache',
  swRes.ok && swText.includes("addEventListener('fetch'") && (swRes.headers.get('cache-control') ?? '').includes('no-cache'),
  swRes.headers.get('cache-control') ?? '',
);

// ---------- 3. service worker + cache ----------
const browser = await chromium.launch();
const consoleErrors = [];
const pageErrors = [];
let installability = [];
let manifestErrors = [];

const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(base, { waitUntil: 'networkidle' });

const registration = await page
  .evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.ready;
    return { supported: true, scope: reg.scope, state: reg.active?.state ?? null };
  })
  .catch((error) => ({ supported: false, error: String(error) }));
check(
  'service worker ลงทะเบียนและ activated',
  registration.supported && registration.state === 'activated' && registration.scope?.endsWith('/'),
  JSON.stringify(registration),
);

await page.reload({ waitUntil: 'networkidle' });
const controller = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check('หน้ามี service worker ควบคุมหลัง reload', controller);

const cacheInfo = await page.evaluate(async () => {
  const names = await caches.keys();
  const detail = {};
  for (const name of names) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    detail[name] = { count: keys.length, urls: keys.slice(0, 6).map((request) => new URL(request.url).pathname) };
  }
  return { names, detail };
});
const shellCount = cacheInfo.detail['nakhonmaesot-shell-v1']?.count ?? 0;
const assetCount = cacheInfo.detail['nakhonmaesot-asset-v1']?.count ?? 0;
check('แคช app shell ถูกสร้าง', shellCount > 0, `shell ${shellCount} รายการ`);
check('แคช JS/CSS/ฟอนต์ถูกสร้าง', assetCount > 2, `asset ${assetCount} รายการ`);
const appShellCached = await page.evaluate(async () => {
  const cache = await caches.open('nakhonmaesot-shell-v1');
  return Boolean(await cache.match('/__app-shell'));
});
check('มี HTML app shell เก็บไว้จริง', appShellCached);

// ---------- 4. DevTools installability ----------
try {
  const cdp = await context.newCDPSession(page);
  const appManifest = await cdp.send('Page.getAppManifest');
  manifestErrors = (appManifest.errors ?? []).map((error) => error.message);
  const errors = await cdp.send('Page.getInstallabilityErrors');
  installability = (errors.installabilityErrors ?? []).map((error) => error.errorId);
} catch (error) {
  installability = [`ไม่สามารถเรียก CDP: ${String(error).slice(0, 120)}`];
}
check(
  'Chrome อ่าน manifest โดยไม่มี parse error',
  Array.isArray(manifestErrors) && manifestErrors.length === 0,
  manifestErrors.join(' | '),
);
check(
  'Chrome ไม่พบ installability error',
  Array.isArray(installability) && installability.length === 0,
  installability.join(', ') || 'ไม่มีข้อผิดพลาด',
);

// ---------- 5. โหมดออฟไลน์ ----------
await page.goto(`${base}/library`, { waitUntil: 'networkidle' });
await page.waitForSelector('.brand-text', { timeout: 15000 });
await context.setOffline(true);
let offlineReloadOk = false;
let offlineDetail = '';
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.brand-text', { timeout: 8000 });
  offlineReloadOk = true;
  const noticeVisible = await page
    .locator('.offline-notice')
    .waitFor({ state: 'visible', timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  offlineDetail = noticeVisible ? 'แสดงแถบออฟไลน์' : 'โหลดแอปได้ แต่ไม่พบแถบออฟไลน์';
  check('แถบแจ้งเตือนออฟไลน์แสดงผล', noticeVisible);
  const libraryText = (await page.locator('main').innerText().catch(() => '')) ?? '';
  check(
    'ข้อความแจ้งเมื่อโหลดข้อมูลไม่ได้ (ออฟไลน์)',
    libraryText.includes('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'),
    libraryText.replace(/\s+/g, ' ').slice(0, 90),
  );
  await page.screenshot({ path: path.join(artifactDir, 'pwa-offline-app.png') });
} catch (error) {
  offlineDetail = String(error).split('\n')[0].slice(0, 160);
}
check('เปิดหน้าเดิมซ้ำได้ตอนออฟไลน์ (app shell)', offlineReloadOk, offlineDetail);

let offlinePageOk = false;
try {
  await page.goto(`${base}/offline.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  offlinePageOk = (await page.textContent('h1'))?.includes('ออฟไลน์') ?? false;
  await page.screenshot({ path: path.join(artifactDir, 'pwa-offline-page.png') });
} catch (error) {
  offlinePageOk = false;
}
check('หน้า /offline.html เปิดได้ตอนออฟไลน์', offlinePageOk);
await context.setOffline(false);

// ---------- 6. UI แนะนำการติดตั้ง (Android/Chrome) ----------
const installContext = await browser.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, locale: 'th-TH' });
const installPage = await installContext.newPage();
await installPage.goto(base, { waitUntil: 'networkidle' });
await installPage.evaluate(() => {
  const event = new Event('beforeinstallprompt');
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(event);
});
let bannerVisible = false;
try {
  await installPage.waitForSelector('.pwa-install', { timeout: 6000 });
  bannerVisible = true;
} catch {
  bannerVisible = false;
}
check('แบนเนอร์ติดตั้งแอปแสดงเมื่อเบราว์เซอร์พร้อมติดตั้ง', bannerVisible);
if (bannerVisible) {
  await installPage.screenshot({ path: path.join(artifactDir, 'pwa-install-android.png') });
  await installPage.getByRole('button', { name: 'ติดตั้งเลย' }).click();
  const hidden = await installPage
    .waitForSelector('.pwa-install', { state: 'detached', timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check('กดติดตั้งแล้วแบนเนอร์ปิดลง', hidden);
}
await installContext.close();

// ---------- 7. UI แนะนำการติดตั้ง (iOS) ----------
const iosContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'th-TH',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
});
const iosPage = await iosContext.newPage();
await iosPage.goto(base, { waitUntil: 'networkidle' });
let iosBanner = false;
let iosText = '';
try {
  await iosPage.waitForSelector('.pwa-install', { timeout: 8000 });
  iosBanner = true;
  iosText = (await iosPage.textContent('.pwa-install-steps')) ?? '';
  await iosPage.screenshot({ path: path.join(artifactDir, 'pwa-install-ios.png') });
} catch {
  iosBanner = false;
}
check('iOS แสดงคำแนะนำเพิ่มไปยังหน้าจอโฮม', iosBanner && iosText.includes('หน้าจอโฮม'), iosText.replace(/\s+/g, ' ').slice(0, 80));
await iosContext.close();

// ---------- 8. console/page errors ----------
const meaningfulConsoleErrors = consoleErrors.filter(
  (text) => !text.includes('Failed to load resource') && !text.includes('the server responded with a status of 401'),
);
check('ไม่มี console error จากหน้าแอป', meaningfulConsoleErrors.length === 0, meaningfulConsoleErrors.slice(0, 2).join(' | '));
check('ไม่มี page error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await context.close();
await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks ผ่าน`);
console.log('cache:', JSON.stringify(cacheInfo.detail));
if (failed.length) {
  console.log('ไม่ผ่าน:', failed.map((result) => result.name).join(', '));
  process.exit(1);
}
