/**
 * ถ่ายภาพหน้าจอสำหรับ manifest.screenshots (ใช้ในหน้าติดตั้งแอปของ Chrome)
 * รันหลัง build และมีเซิร์ฟเวอร์ให้บริการ dist อยู่แล้ว:
 *   node scripts/pwa-screenshots.mjs http://localhost:4100
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4100';
const outDir = path.resolve('public/screenshots');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const shots = [
    { file: 'install-wide.png', viewport: { width: 1280, height: 720 }, mobile: false },
    { file: 'install-narrow.png', viewport: { width: 390, height: 844 }, mobile: true },
  ];

  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: 1,
      isMobile: shot.mobile,
      hasTouch: shot.mobile,
      locale: 'th-TH',
      userAgent: shot.mobile
        ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
        : undefined,
    });
    // ซ่อนแบนเนอร์ติดตั้งไม่ให้บังภาพ
    await context.addInitScript(() => {
      try {
        localStorage.setItem('nakhonmaesot.install.dismissedAt', String(Date.now()));
      } catch {
        /* ignore */
      }
    });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.brand-text', { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, shot.file) });
    console.log(`saved public/screenshots/${shot.file}`);
    await context.close();
  }
} finally {
  await browser.close();
}
