import path from 'node:path';
import { unzipSync } from 'fflate';
import { db, runMany } from './db.js';

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });

const STOPWORDS = new Set(
  `และ ที่ ของ ใน การ ให้ ได้ เป็น มี ไป มา กับ จาก โดย อยู่ จะ ก็ แต่ หรือ ไม่ นี้ นั้น ซึ่ง วัน เรา ท่าน เขา มัน ต้อง ว่า ไว้ แล้ว ยัง อย่าง เช่น เพื่อ เมื่อ เพราะ หาก จึง ต่อ ถึง ระหว่าง ภาย กำลัง จำนวน หลาย บาง ทั้ง เรื่อง ส่วน พร้อม อย่างไร ก็ตาม กล่าว คือ อาจ จะต้อง ควร อีก ทั้งหมด ต่าง ๆ ๆๆ นะ ครับ ค่ะ คะ จ้ะ จ้า อ่ะ ฮะ
  ผู้ ใช้ ความ ข้อ เข้า ผล ด้าน ด้วย พบ พบว่า ครั้ง สำคัญ ทำ ทำให้ ขึ้น ลง ออก รับ ส่ง ประกอบ ตาม กว่า มาก น้อย ใหม่ เก่า ใด ไหน ทุก แต่ละ อื่น ต่าง กัน จน ยิ่ง เสีย คง น่า อยาก สามารถ จำเป็น เนื่องจาก ในขณะที่ ขณะที่ ที่สุด เท่านั้น เช่นกัน เช่นเดียวกัน รวมทั้ง รวมถึง ตลอดจน เป็นต้น ดังนี้ ดังกล่าว ดังที่ กล่าวคือ ตัวอย่าง ตัวอย่างเช่น ตาราง รูป ภาพ หน้า บท บทที่ ตอน หัวข้อ ส่วนใหญ่ โดยรวม โดยทั่วไป โดยเฉพาะ โดยตรง ต่อมา ต่อไป แรก สุดท้าย กลาง ภายใน ภายนอก เหนือ ใต้ บน ล่าง หลัง ก่อน เร็ว ช้า ใหญ่ เล็ก สูง ต่ำ ยาว สั้น ดี ง่าย ยาก ถูก ผิด จริง เท็จ ชัด เป็นไป
  ห้อง หอ สำนัก ฉบับ ปี ประจำ เล่ม สำหรับ ตลอด ร่วม ขอบ ชาย เล่า สมัย งาน ดำเนิน คณะ แห่ง
  the a an and or of to in for on at by with from as is are was were be been being this that these those it its into their our your his her they we you i not no but if then than so such can could should would may might will just also more most other some any each which who whom whose what when where why how all both few many much own same very too only own out up down over under again further once here there about above below after before during between through during
    `.split(/\s+/),
);

const normalize = (text) => String(text ?? '').normalize('NFC');

export function tokenize(text) {
  const cleaned = normalize(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .toLowerCase();
  const tokens = [];
  for (const part of segmenter.segment(cleaned)) {
    if (!part.isWordLike) continue;
    const word = part.segment.trim();
    if (!word) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^[\d.,%]+$/.test(word)) continue;
    if (word.length < 2) continue;
    if (/^[\u0E00-\u0E7F]+$/.test(word) && word.length < 2) continue;
    tokens.push(word);
  }
  return tokens;
}

export function buildKeywordIndex(text, { title = '', author = '' } = {}) {
  const counts = new Map();
  const push = (token) => counts.set(token, (counts.get(token) ?? 0) + 1);
  tokenize(text).forEach(push);
  const titleTokens = new Set(tokenize(`${title} ${author}`));
  const keywords = [...counts.entries()]
    .map(([term, count]) => ({
      term,
      count,
      weight: Number((count * (titleTokens.has(term) ? 2.6 : 1)).toFixed(3)),
    }))
    .sort((a, b) => b.weight - a.weight);
  return keywords;
}

export async function saveKeywords(publicationId, keywords) {
  await db.prepare('DELETE FROM keywords WHERE publication_id = ?').run(publicationId);
  await runMany(
    'INSERT OR REPLACE INTO keywords (term, publication_id, weight, count) VALUES (?, ?, ?, ?)',
    keywords.slice(0, 400).map((keyword) => [keyword.term, publicationId, keyword.weight, keyword.count]),
  );
}

const stripEntities = (input) =>
  input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

export function htmlToText(html) {
  return stripEntities(
    String(html)
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeEpubHtml(html) {
  return String(html)
    .replace(/<(script|style|iframe|object|embed|link|meta|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function decodeXmlAttr(value) {
  return stripEntities(String(value ?? ''));
}

function readXmlAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return match ? decodeXmlAttr(match[1]) : null;
}

/** Extract readable chapters + assets from an ePub archive. */
export function readEpub(buffer, { publicBase = '' } = {}) {
  const files = unzipSync(new Uint8Array(buffer));
  const decoder = new TextDecoder('utf-8');
  const containerXml = files['META-INF/container.xml'];
  if (!containerXml) throw new Error('ไฟล์ ePub ไม่ถูกต้อง (ไม่พบ container.xml)');
  const container = decoder.decode(containerXml);
  const rootTag = container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '';
  const opfPath = readXmlAttr(rootTag, 'full-path');
  if (!opfPath || !files[opfPath]) throw new Error('ไม่พบไฟล์ OPF ภายใน ePub');
  const opfDir = path.posix.dirname(opfPath);
  const opf = decoder.decode(files[opfPath]);

  const baseHref = readXmlAttr(opf.match(/<package[^>]*>/i)?.[0] ?? '', 'xml:base') ?? '';
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = readXmlAttr(match[0], 'id');
    const href = readXmlAttr(match[0], 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: readXmlAttr(match[0], 'media-type') ?? '',
      properties: readXmlAttr(match[0], 'properties') ?? '',
    });
  }

  const spine = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = readXmlAttr(match[0], 'idref');
    const item = manifest.get(idref);
    if (item) spine.push(item);
  }

  const resolve = (fromFile, href) => {
    const clean = href.split('#')[0];
    if (!clean) return null;
    if (/^[a-z]+:/i.test(clean)) return null;
    const dir = path.posix.dirname(fromFile);
    return path.posix.normalize(path.posix.join(dir, clean));
  };

  // Extract assets referenced by chapters so <img> tags keep working.
  const assets = new Map();
  const assetUrl = (zipPath) => {
    if (!zipPath || !files[zipPath]) return null;
    if (!assets.has(zipPath)) assets.set(zipPath, files[zipPath]);
    return `${publicBase}/${zipPath.split('/').map(encodeURIComponent).join('/')}`;
  };

  const chapters = [];
  const textParts = [];
  let index = 0;
  for (const item of spine) {
    const filePath = resolve(opfPath, `${baseHref}${item.href}`);
    if (!filePath || !files[filePath]) continue;
    const raw = decoder.decode(files[filePath]);
    let html = sanitizeEpubHtml(raw);
    html = html.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = readXmlAttr(tag, 'src');
      const resolved = src ? resolve(filePath, src) : null;
      const url = resolved ? assetUrl(resolved) : null;
      return url ? `<img src="${url}" alt="${readXmlAttr(tag, 'alt') ?? ''}" loading="lazy" />` : '';
    });
    // Convert stylesheet-driven colours into neutral reading typography.
    const title =
      htmlToText(html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ?? '').slice(0, 120) ||
      `บทที่ ${index + 1}`;
    const body = html
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!doctype[\s\S]*?>/gi, '')
      .replace(/<\/?(html|head|body)[^>]*>/gi, '')
      .replace(/<a\b[^>]*href="#[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    if (!htmlToText(body)) continue;
    chapters.push({ id: `ch-${index + 1}`, title, html: body });
    textParts.push(htmlToText(body));
    index += 1;
  }

  if (!chapters.length) {
    // Fall back to any xhtml files present in the archive.
    for (const [name, bytes] of Object.entries(files)) {
      if (!/\.x?html?$/i.test(name)) continue;
      const text = htmlToText(decoder.decode(bytes));
      if (text.length < 40) continue;
      const body = sanitizeEpubHtml(decoder.decode(bytes)).replace(/<\/?(html|head|body)[^>]*>/gi, '');
      chapters.push({ id: `ch-${chapters.length + 1}`, title: `บทที่ ${chapters.length + 1}`, html: body });
      textParts.push(text);
    }
  }

  const title =
    htmlToText(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? '') ||
    'หนังสือ ePub';

  return {
    title,
    chapters,
    assets,
    text: textParts.join('\n\n'),
    pageCount: chapters.length,
    extracted: assets.size,
  };
}

/** Read image pages from a zip archive to build a flipbook. */
export function readFlipbookZip(buffer, { publicBase = '' }) {
  const files = unzipSync(new Uint8Array(buffer));
  const images = Object.keys(files)
    .filter((name) => /\.(jpe?g|png|webp|gif|avif)$/i.test(name) && !name.startsWith('__MACOSX'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (!images.length) throw new Error('ไม่พบไฟล์รูปภาพในไฟล์ ZIP สำหรับ Flipbook');
  const pages = [];
  const assets = [];
  for (const name of images) {
    const safeName = path.posix.basename(name);
    assets.push({ name: safeName, bytes: files[name] });
    pages.push(`${publicBase}/${encodeURIComponent(safeName)}`);
  }
  return {
    pages,
    assets,
    pageCount: pages.length,
    text: images.map((name) => path.posix.basename(name, path.posix.extname(name)).replace(/[_-]+/g, ' ')).join('\n'),
  };
}

/** Extract text and page count from a PDF using pdf.js. */
export async function readPdf(buffer, { maxPages = 400, standardFontDataUrl } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const total = doc.numPages;
  const parts = [];
  for (let pageNumber = 1; pageNumber <= Math.min(total, maxPages); pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    parts.push(text);
    page.cleanup();
  }
  await doc.destroy();
  return { text: parts.join('\n\n'), pageCount: total };
}

export function makeExcerpt(text, limit = 320) {
  const compact = normalize(text).replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit).trimEnd()}…` : compact;
}

export function readingMinutes(text) {
  const tokens = tokenize(text).length;
  return Math.max(1, Math.round(tokens / 220));
}
