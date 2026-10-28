import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const outDir = path.resolve('artifacts/book');
fs.mkdirSync(outDir, { recursive: true });

const PDF_BOOK = '/read/walkable-city-public-space';
const EPUB_BOOK = '/read/stories-from-the-library-25-years';
const FLIP_BOOK = '/read/flipbook-library-services';

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function openBook(page, route) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.book-stage[data-cover="closed"]', { timeout: 15000 });
  return errors;
}

/** Waits for the pager to satisfy a test and returns how long the turn took. */
async function waitForPager(page, test, timeout = 3500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const label = await page.evaluate(() => document.querySelector('.reader-pager')?.textContent ?? '');
    if (test(label)) return Date.now() - started;
    await page.waitForTimeout(40);
  }
  return Date.now() - started;
}

const browser = await chromium.launch();

try {
  // ---------------------------------------------------------------- desktop PDF
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = await openBook(page, PDF_BOOK);

    const coverLoaded = await page.evaluate(() => {
      const image = document.querySelector('.book-cover-front img');
      return image ? image.naturalWidth > 0 : false;
    });
    check('PDF: cover art renders', coverLoaded);
    await page.screenshot({ path: path.join(outDir, '01-pdf-cover.png') });

    await page.click('.book-open-btn');
    await page.waitForTimeout(280);
    const opening = await page.evaluate(() => {
      const leaf = document.querySelector('.book-cover-leaf');
      const transform = leaf ? getComputedStyle(leaf).transform : '';
      return { hasLeaf: Boolean(leaf) && leaf.classList.contains('is-opening'), transform };
    });
    check('PDF: cover swings open (3D transform running)', opening.hasLeaf && opening.transform !== 'none');
    await page.screenshot({ path: path.join(outDir, '02-pdf-cover-opening.png') });

    await page.waitForSelector('.book-cover-leaf', { state: 'detached', timeout: 4000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector('.book-page-right img.book-pdf-page');
        return image instanceof HTMLImageElement && image.naturalWidth > 0;
      },
      null,
      { timeout: 15000 },
    );
    const spread = await page.evaluate(() => ({
      pages: document.querySelectorAll('.book-page').length,
      left: Boolean(document.querySelector('.book-page-left .book-frontmatter')),
      label: document.querySelector('.reader-pager')?.textContent ?? '',
    }));
    check('PDF: two-page spread with inside-cover front matter', spread.pages === 2 && spread.left);
    const banner = await page.evaluate(() => Boolean(document.querySelector('.pwa-install')));
    check('PDF: install banner stays out of the reading view', !banner);
    check('PDF: first page rendered as image', true);
    check('PDF: pager shows the spread', spread.label.includes('หน้า'), spread.label);
    await page.screenshot({ path: path.join(outDir, '03-pdf-spread.png') });

    // Real drag of the right page corner, mid-gesture snapshot.
    const box = await page.locator('.book-page-right').boundingBox();
    await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(box.x + box.width - 40 - step * 24, box.y + box.height / 2, { steps: 2 });
      await page.waitForTimeout(16);
    }
    const dragging = await page.evaluate(() => {
      const stripNodes = Array.from(document.querySelectorAll('.book-curl-strip'));
      const angles = [];
      let projected = 0;
      for (const strip of stripNodes) {
        const matrix = getComputedStyle(strip).transform;
        const match = matrix.match(/matrix\(([^)]+)\)/);
        if (!match) continue;
        const scaleX = Number(match[1].split(',')[0]);
        angles.push((Math.acos(Math.max(-1, Math.min(1, scaleX))) * 180) / Math.PI);
        projected += strip.getBoundingClientRect().width;
      }
      const page = document.querySelector('.book-page-right')?.getBoundingClientRect().width ?? 0;
      return { count: stripNodes.length, angles, projected, page };
    });
    const bow = dragging.angles.length ? Math.max(...dragging.angles) - Math.min(...dragging.angles) : 0;
    check('PDF: turning page is a chain of curl strips', dragging.count >= 10, `${dragging.count} strips`);
    check('PDF: strips bow the sheet instead of swinging a plate', bow >= 8, `bow ${bow.toFixed(1)}deg`);
    check(
      'PDF: the sheet foreshortens as it turns',
      dragging.page > 0 && dragging.projected < dragging.page * 0.95,
      `${dragging.projected.toFixed(0)}px of ${dragging.page.toFixed(0)}px`,
    );
    await page.screenshot({ path: path.join(outDir, '04-pdf-drag.png') });
    await page.mouse.up();
    await waitForPager(page, (label) => label.includes('2'));
    await page.waitForTimeout(200);
    const afterDrag = await page.evaluate(() => ({
      label: document.querySelector('.reader-pager')?.textContent ?? '',
      leaf: Boolean(document.querySelector('.book-leaf')),
    }));
    check('PDF: released drag lands on the next spread', afterDrag.label.includes('2'), afterDrag.label);
    check('PDF: leaf is removed after the turn', !afterDrag.leaf);

    // Click the right half → next spread, with a mid-turn snapshot.
    await page.screenshot({ path: path.join(outDir, '05-pdf-second-spread.png') });
    const box2 = await page.locator('.book-page-right').boundingBox();
    const clickedAt = Date.now();
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.waitForTimeout(140);
    await page.waitForTimeout(0);
    const midTurn = await page.evaluate(() => {
      const leaf = document.querySelector('.book-leaf');
      return leaf ? getComputedStyle(leaf).transform : '';
    });
    check('PDF: click starts a page-turn animation', Boolean(midTurn) && midTurn !== 'none');
    await page.screenshot({ path: path.join(outDir, '06-pdf-mid-turn.png') });
    await waitForPager(page, (label) => label.includes('4'));
    const turnMs = Date.now() - clickedAt;
    check('PDF: the turn is slow enough to read as paper', turnMs >= 700, `${turnMs}ms`);
    const afterClick = await page.evaluate(() => ({
      label: document.querySelector('.reader-pager')?.textContent ?? '',
      rightPage: document.querySelector('.book-page-right img.book-pdf-page')?.getAttribute('alt') ?? '',
    }));
    check('PDF: page advanced to the next spread', afterClick.label.includes('4'), afterClick.label);

    // Keyboard turn back.
    await page.keyboard.press('ArrowLeft');
    await waitForPager(page, (label) => label.includes('2'));
    const afterKey = await page.evaluate(() => document.querySelector('.reader-pager')?.textContent ?? '');
    check('PDF: ArrowLeft turns back', afterKey.includes('2'), afterKey);

    // Frame pacing of an animated turn: the curl is driven by rAF, not a CSS transition.
    await page.keyboard.press('ArrowRight');
    const frameGaps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const gaps = [];
          let last = performance.now();
          const tick = (now) => {
            gaps.push(now - last);
            last = now;
            if (gaps.length < 36) requestAnimationFrame(tick);
            else resolve(gaps.slice(1));
          };
          requestAnimationFrame(tick);
        }),
    );
    await waitForPager(page, (label) => label.includes('4'));
    const sortedGaps = [...frameGaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    check('PDF: page turn animates smoothly', medianGap <= 24, `median frame ${medianGap.toFixed(1)}ms`);

    // Jump to the last page: the verso side of the final spread shows the endpaper.
    await page.fill('.reader-jump input', '6');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const lastSpread = await page.evaluate(() => ({
      endpaper: Boolean(document.querySelector('.book-page-right .book-endpaper')),
      label: document.querySelector('.reader-pager')?.textContent ?? '',
      left: document.querySelector('.book-page-left img.book-pdf-page')?.getAttribute('alt') ?? '',
    }));
    check('PDF: final spread shows the endpaper, not a broken page', lastSpread.endpaper && lastSpread.label.includes('6'), lastSpread.label);
    await page.screenshot({ path: path.join(outDir, '05b-pdf-last-spread.png') });

    // Paper sound: a switch in the toolbar, remembered between sessions.
    const soundSwitch = page.locator('button[aria-label="ปิดเสียงพลิกหน้า"]');
    const hasSwitch = (await soundSwitch.count()) > 0;
    check('PDF: paper-sound switch sits in the toolbar', hasSwitch);
    if (hasSwitch) {
      await soundSwitch.click();
      const off = await page.evaluate(() => ({
        stored: localStorage.getItem('nakhonmaesot-book-sound'),
        pressed: document.querySelector('button[aria-label="เปิดเสียงพลิกหน้า"]')?.getAttribute('aria-pressed'),
      }));
      check('PDF: switch mutes the page-turn sound', off.stored === 'off' && off.pressed === 'false', JSON.stringify(off));
      await page.click('button[aria-label="เปิดเสียงพลิกหน้า"]');
      const backOn = await page.evaluate(() => ({
        stored: localStorage.getItem('nakhonmaesot-book-sound'),
        pressed: document.querySelector('button[aria-label="ปิดเสียงพลิกหน้า"]')?.getAttribute('aria-pressed'),
      }));
      check('PDF: switch unmutes the page-turn sound', backOn.stored === 'on' && backOn.pressed === 'true', JSON.stringify(backOn));
    }

    check('PDF: no console or page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---------------------------------------------------------------- desktop ePub
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = await openBook(page, EPUB_BOOK);
    await page.screenshot({ path: path.join(outDir, '07-epub-cover.png') });
    await page.click('.book-open-btn');
    await page.waitForSelector('.book-cover-leaf', { state: 'detached', timeout: 4000 });
    await page.waitForSelector('.book-page-right .book-text', { timeout: 8000 });

    const epub = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('.book-page .book-text')).map((node) => node.textContent ?? '');
      return {
        count: pages.length,
        hasText: pages.every((text) => text.trim().length > 40),
        frontmatter: Boolean(document.querySelector('.book-page-left .book-frontmatter')),
        head: document.querySelector('.book-running-head')?.textContent ?? '',
        folio: document.querySelector('.book-folio')?.textContent ?? '',
        label: document.querySelector('.reader-pager')?.textContent ?? '',
      };
    });
    check('ePub: first spread is inside-cover + page 1', epub.count === 1 && epub.hasText && epub.frontmatter, `${epub.count} pages`);
    check('ePub: running head and folio are printed', Boolean(epub.head) && Boolean(epub.folio), `${epub.head}/${epub.folio}`);
    await page.screenshot({ path: path.join(outDir, '08-epub-spread.png') });

    const pagesTotal = Number((epub.label.match(/\/\s*(\d+)/) ?? [])[1] ?? 0);
    check('ePub: book has several printed pages', pagesTotal >= 3, epub.label);

    const box = await page.locator('.book-page-right').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '09-epub-mid-turn.png') });
    await waitForPager(page, (label) => label !== epub.label);
    const after = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('.book-page .book-text'));
      return {
        label: document.querySelector('.reader-pager')?.textContent ?? '',
        texts: texts.length,
        left: document.querySelector('.book-page-left .book-text')?.textContent?.trim().slice(0, 20) ?? '',
      };
    });
    check(
      'ePub: page turn fills both pages with text',
      after.label !== epub.label && after.texts === 2 && after.left.length > 0,
      `${after.label} / ${after.texts} pages`,
    );
    await page.screenshot({ path: path.join(outDir, '10-epub-second-spread.png') });
    check('ePub: no console or page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---------------------------------------------------------------- flipbook
  {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    const errors = await openBook(page, FLIP_BOOK);
    await page.click('.book-open-btn');
    await page.waitForSelector('.book-cover-leaf', { state: 'detached', timeout: 4000 });
    await page.waitForFunction(
      () => {
        const image = document.querySelector('.book-page-right img.book-pdf-page, .book-page-right img.book-image-page');
        return image instanceof HTMLImageElement && image.naturalWidth > 0;
      },
      null,
      { timeout: 10000 },
    );
    check('Flipbook: pages render inside the same book', true);
    await page.screenshot({ path: path.join(outDir, '11-flipbook-spread.png') });
    check('Flipbook: no console or page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // ---------------------------------------------------------------- mobile
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = await openBook(page, PDF_BOOK);
    await page.screenshot({ path: path.join(outDir, '12-mobile-cover.png') });
    await page.tap('.book-open-btn');
    await page.waitForSelector('.book-cover-leaf', { state: 'detached', timeout: 4000 });
    await page.waitForTimeout(900);
    const single = await page.evaluate(() => ({
      pages: document.querySelectorAll('.book-page').length,
      label: document.querySelector('.reader-pager')?.textContent ?? '',
      overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    check('Mobile: single page book (no cramped spread)', single.pages === 1, `${single.pages}`);
    check('Mobile: no horizontal overflow', single.overflow);
    await page.screenshot({ path: path.join(outDir, '13-mobile-page.png') });

    const box = await page.locator('.book-page').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForPager(page, (label) => label !== single.label);
    const after = await page.evaluate(() => document.querySelector('.reader-pager')?.textContent ?? '');
    check('Mobile: tapping the page turns it', after !== single.label, `${single.label} → ${after}`);

    // Swipe the page like a finger would.
    await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(box.x + box.width - 30 - step * 22, box.y + box.height / 2, { steps: 2 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await waitForPager(page, (label) => label !== after);
    const afterSwipe = await page.evaluate(() => document.querySelector('.reader-pager')?.textContent ?? '');
    check('Mobile: swiping the page turns it', afterSwipe !== after, `${after} → ${afterSwipe}`);
    check('Mobile: no console or page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}
