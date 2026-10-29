// Vercel Functions entry point. The Express app runs per request; Turso
// (libSQL) holds the database and Vercel Blob holds uploads, because a Function
// bundle is read-only and instances do not share a disk.
import { app } from '../server/app.js';
import { cloudConfig, configureCloud, ensureCloudSchema, ensureUploadSchema, isCloudConfigured } from '../server/cloud.js';
import { getObject, getStorageDriver } from '../server/storage.js';

// Hobby plans allow up to 60s; seeding happens at build time, so requests are
// normally far below this.
export const config = { maxDuration: 60 };

const SMALL_FILE_BYTES = 4 * 1024 * 1024;
// Vercel rejects a Function response body above 4.5 MB, so ranged reads are cut
// to this window; readers such as PDF.js keep asking for the next window.
const MAX_SLICE_BYTES = 3 * 1024 * 1024;

let booted = null;

async function boot() {
  const settings = cloudConfig();
  if (!isCloudConfigured(settings)) return { ready: false, reason: 'database' };
  const client = configureCloud(settings);
  await ensureCloudSchema(client);
  await ensureUploadSchema(client);
  // configureCloud() has picked the storage backend for this deployment: Vercel
  // Blob when a token is configured, otherwise the database itself, so a
  // read-only Function bundle never needs a writable disk.
  return { ready: true };
}

function bootstrap() {
  if (!booted) {
    booted = boot().catch((error) => {
      booted = null;
      throw error;
    });
  }
  return booted;
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'ไม่พบไฟล์ที่ร้องขอ' }));
}

function sendWhole(req, res, object) {
  res.statusCode = 200;
  res.setHeader('Content-Type', object.contentType);
  res.setHeader('Content-Length', String(object.size));
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(Buffer.from(object.bytes));
}

/** "bytes=0-1023" → {start, end}; {invalid} when unsatisfiable. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start;
  let end;
  if (rawStart === '') {
    if (rawEnd === '') return null;
    end = size - 1;
    start = Math.max(0, size - Number(rawEnd));
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { invalid: true };
  return { start, end };
}

async function serveUpload(req, res, pathname) {
  // Plain Node response: Express helpers such as res.status()/res.json() are
  // only attached once the request goes through app().
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end();
    return;
  }
  const key = decodeURIComponent(pathname.slice('/uploads/'.length));
  if (!key || key.includes('..')) {
    res.statusCode = 404;
    res.end();
    return;
  }

  const driver = getStorageDriver();
  const stat = typeof driver.stat === 'function' ? await driver.stat(key) : null;

  // No metadata support (older driver): one full read, size is then implicit.
  if (!stat) {
    const object = await getObject(key);
    if (!object) return notFound(res);
    return sendWhole(req, res, object);
  }

  // Public bucket: hand large files to the CDN instead of the 4.5 MB window.
  if (stat.size > SMALL_FILE_BYTES && typeof driver.link === 'function') {
    const link = await driver.link(key).catch(() => null);
    if (link) {
      res.statusCode = 302;
      res.setHeader('Location', link.url);
      res.end();
      return;
    }
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range?.invalid) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.setHeader('Content-Type', stat.contentType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.end();
    return;
  }

  if (range) {
    const end = Math.min(range.end, range.start + MAX_SLICE_BYTES - 1, stat.size - 1);
    const chunk =
      typeof driver.readRange === 'function' ? await driver.readRange(key, range.start, end) : null;
    let bytes;
    let total = stat.size;
    if (chunk) {
      bytes = chunk.bytes;
      total = chunk.total ?? stat.size;
    } else {
      const object = await getObject(key);
      if (!object) return notFound(res);
      bytes = object.bytes.subarray(range.start, end + 1);
    }
    res.statusCode = 206;
    res.setHeader('Content-Type', stat.contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Range', `bytes ${range.start}-${range.start + bytes.length - 1}/${total}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.end(Buffer.from(bytes));
    return;
  }

  const object = await getObject(key);
  if (!object) return notFound(res);
  sendWhole(req, res, object);
}

export default async function handler(req, res) {
  let status;
  try {
    status = await bootstrap();
  } catch (error) {
    console.error('[nakhonmaesot:vercel]', error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ — กรุณาตรวจสอบการตั้งค่า' }));
    return;
  }

  if (!status.ready) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error:
          status.reason === 'database'
            ? 'ยังไม่ได้ตั้งค่า TURSO_DATABASE_URL สำหรับดีพลอยบน Vercel'
            : 'ระบบยังไม่พร้อมใช้งาน',
      }),
    );
    return;
  }

  // Vercel may pre-parse JSON/urlencoded bodies into req.body. body-parser
  // skips a body that is already parsed when req._body is set.
  if (req.body !== undefined && req.body !== null && !Buffer.isBuffer(req.body)) {
    req._body = true;
  }

  const pathname = String(req.url ?? '/').split('?')[0];
  if (pathname.startsWith('/uploads/')) {
    await serveUpload(req, res, pathname);
    return;
  }

  app(req, res);
}
