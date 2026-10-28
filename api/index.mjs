// Vercel Functions entry point. The Express app runs per request; Turso
// (libSQL) holds the database and Vercel Blob holds uploads, because a Function
// bundle is read-only and instances do not share a disk.
import { app } from '../server/app.js';
import { cloudConfig, configureCloud, ensureCloudSchema, isCloudConfigured } from '../server/cloud.js';
import { getObject, getStorageDriver } from '../server/storage.js';

// Hobby plans allow up to 60s; seeding happens at build time, so requests are
// normally far below this.
export const config = { maxDuration: 60 };

const SMALL_FILE_BYTES = 4 * 1024 * 1024;

let booted = null;

async function boot() {
  const settings = cloudConfig();
  if (!isCloudConfigured(settings)) return { ready: false, reason: 'database' };
  const client = configureCloud(settings);
  await ensureCloudSchema(client);
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

  const object = await getObject(key);
  if (!object) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'ไม่พบไฟล์ที่ร้องขอ' }));
    return;
  }

  const driver = getStorageDriver();
  // Vercel caps a Function response at 4.5 MB: hand larger files to the CDN.
  if (object.size > SMALL_FILE_BYTES && typeof driver.url === 'function') {
    const target = await driver.url(key);
    if (target) {
      res.statusCode = 302;
      res.setHeader('Location', target);
      res.end();
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', object.contentType);
  res.setHeader('Content-Length', String(object.size));
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.setHeader('Accept-Ranges', 'none');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(Buffer.from(object.bytes));
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
