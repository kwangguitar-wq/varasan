/**
 * สร้างไอคอน PWA จากอาร์ตเวิร์กเดียวกับ favicon
 * รัน: node scripts/pwa-icons.mjs [baseUrl]
 * ต้องมี Chromium ของ Playwright (npx playwright install chromium)
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = path.resolve('public/icons');

const GLYPH = `
  <path d="M11 12.5c3.2-1.6 6.1-1.6 9 0v16c-2.9-1.6-5.8-1.6-9 0z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
  <path d="M29 12.5c-3.2-1.6-6.1-1.6-9 0v16c2.9-1.6 5.8-1.6 9 0z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
  <circle cx="20" cy="9" r="1.8" fill="#fff" />`;

function iconSvg({ size, maskable }) {
  // maskable: เต็มสี่เหลี่ยม ขยายกราฟิกให้อยู่ใน safe zone ~66%
  const scale = maskable ? 0.74 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop stop-color="#14b8a6" />
        <stop offset="1" stop-color="#0f766e" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" fill="url(#g)" />
    <g transform="translate(20 20) scale(${scale}) translate(-20 -20)">${GLYPH}</g>
  </svg>`;
}

function pageHtml(svg, size, pad) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
    svg{display:block;width:${size - pad * 2}px;height:${size - pad * 2}px}
  </style></head><body style="padding:${pad}px">${svg}</body></html>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false, pad: 0 },
  { file: 'icon-512.png', size: 512, maskable: false, pad: 0 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, pad: 0 },
  { file: 'apple-touch-icon.png', size: 180, maskable: false, pad: 0 },
];

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(pageHtml(iconSvg({ size: target.size, maskable: target.maskable }), target.size, target.pad));
    const file = path.join(OUT_DIR, target.file);
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
    console.log(`created ${path.relative(process.cwd(), file)} (${target.size}x${target.size})`);
  }
} finally {
  await browser.close();
}
