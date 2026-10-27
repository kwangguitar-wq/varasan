import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = 'artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const shot = async (name, options = {}) => {
  await page.waitForTimeout(options.wait ?? 900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options.fullPage ?? false });
  console.log('shot', name);
};

// Home
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('home-desktop', { fullPage: true });
await shot('home-hero', { fullPage: false, wait: 200 });

// Login flow
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot('login');
await page.fill('input[type=email]', 'admin@lumen.app');
await page.fill('input[type=password]', 'Lumen@2026');
await page.click('button[type=submit]');
await page.waitForTimeout(1500);
console.log('after login url:', page.url());

// Library
await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
await shot('library');
await page.fill('.searchbar input', 'ระบบสืบค้น');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
await shot('library-search');
console.log('search results count:', await page.locator('.pub-grid .pub-card').count());

// Detail
await page.goto(`${BASE}/item/smart-search-digital-library`, { waitUntil: 'networkidle' });
await shot('detail', { fullPage: true });

// Reader PDF
await page.goto(`${BASE}/read/walkable-city-public-space`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await shot('reader-pdf', { wait: 300 });
console.log('pdf pages rendered:', await page.locator('.pdf-page img').count());
await page.click('.reader-topbar-right button[aria-label="ตั้งค่าการอ่าน"]');
await page.waitForTimeout(400);
await page.click('.segmented button:has-text("พลิกหน้า")');
await page.waitForTimeout(1800);
await shot('reader-flip');
await page.click('.reader-panel-right .reader-icon[aria-label="ปิด"]');

// Reader ePub
await page.goto(`${BASE}/read/stories-from-the-library-25-years`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('reader-epub');

// Admin
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('admin-dashboard', { fullPage: true });
await page.goto(`${BASE}/admin/content`, { waitUntil: 'networkidle' });
await shot('admin-content', { fullPage: true });
await page.goto(`${BASE}/admin/content/new`, { waitUntil: 'networkidle' });
await shot('admin-new', { fullPage: true });
await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
await shot('admin-users', { fullPage: true });
await page.goto(`${BASE}/admin/taxonomy`, { waitUntil: 'networkidle' });
await shot('admin-taxonomy', { fullPage: true });

// Mobile
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  storageState: await context.storageState(),
});
const mobilePage = await mobile.newPage();
mobilePage.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`));
await mobilePage.goto(BASE, { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(900);
await mobilePage.screenshot({ path: `${OUT}/mobile-home.png` });
await mobilePage.screenshot({ path: `${OUT}/mobile-home-full.png`, fullPage: true });
await mobilePage.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(800);
await mobilePage.screenshot({ path: `${OUT}/mobile-library.png` });
await mobilePage.goto(`${BASE}/read/walkable-city-public-space`, { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(3000);
await mobilePage.screenshot({ path: `${OUT}/mobile-reader.png` });
await mobilePage.goto(`${BASE}/item/smart-search-digital-library`, { waitUntil: 'networkidle' });
await mobilePage.waitForTimeout(700);
await mobilePage.screenshot({ path: `${OUT}/mobile-detail.png`, fullPage: true });

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
