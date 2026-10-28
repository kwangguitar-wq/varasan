// Cloudflare Workers entry point for Nakhonmaesot Library.
// Express 5 runs on the runtime's node:http server bridge; D1 replaces
// node:sqlite, R2 replaces the uploads directory and assets serve the SPA.
import { handleAsNodeRequest } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { installDomPolyfills } from './server/dom-polyfills.js';
import { app } from './server/app.js';
import { runtime, setDatabaseDriver } from './server/db.js';
import { createD1Driver } from './server/drivers/d1.js';
import { createR2Storage } from './server/drivers/r2-storage.js';
import { getObject, setStorageDriver } from './server/storage.js';
import { ensureDatabase } from './server/seed-import.js';

installDomPolyfills();
globalThis.pdfjsWorker = pdfjsWorker;

runtime.platform = 'worker';
runtime.maxUploadBytes = 64 * 1024 * 1024;

setDatabaseDriver(createD1Driver(env.DB));
setStorageDriver(createR2Storage(env.FILES));

const PORT = 3000;
app.listen(PORT);

const HTML_ACCEPT = /text\/html/;

async function serveUpload(url, env, request) {
  const key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  const isHead = request.method === 'HEAD';
  let object = await getObject(key);
  if (!object) {
    // A cold isolate may not have mirrored the bundled uploads yet.
    await ensureDatabase(env);
    object = await getObject(key);
  }
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'Content-Type': object.contentType,
    'Cache-Control': 'public, max-age=604800',
    'Accept-Ranges': 'bytes',
  });

  const range = request.headers.get('range');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), object.size - 1) : object.size - 1;
      if (start <= end && start < object.size) {
        const slice = object.bytes.subarray(start, end + 1);
        headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
        headers.set('Content-Length', String(slice.length));
        return new Response(isHead ? null : slice, { status: 206, headers });
      }
    }
  }

  headers.set('Content-Length', String(object.size));
  return new Response(isHead ? null : object.bytes, { status: 200, headers });
}

async function serveAsset(request, url) {
  const response = await env.ASSETS.fetch(request);

  // The asset layer redirects "/page.html" to "/page". Follow it here so pages
  // are served with a plain 200 (a cached redirect breaks offline navigation).
  if (url.pathname.endsWith('.html') && response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      const target = await env.ASSETS.fetch(new Request(new URL(location, url.origin), request));
      if (target.ok) {
        return new Response(target.body, {
          status: 200,
          headers: {
            'Content-Type': target.headers.get('content-type') ?? 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        });
      }
    }
  }

  if (response.status !== 404) {
    // The service worker, manifest and shell must be revalidated on every load.
    if (/\.(webmanifest|html)$/.test(url.pathname) || url.pathname.endsWith('sw.js')) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
  // Single-page app: unknown paths fall back to the shell, but not for files.
  const lastSegment = url.pathname.split('/').pop() ?? '';
  if (lastSegment.includes('.')) return response;
  if (!HTML_ACCEPT.test(request.headers.get('accept') ?? '')) return response;
  // The asset handler redirects /index.html to /, so request the root itself.
  const shell = await env.ASSETS.fetch(
    new Request(new URL('/', url.origin), { method: 'GET', headers: { accept: 'text/html' } }),
  );
  if (!shell.ok) return response;
  return new Response(shell.body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await ensureDatabase(env);
      return handleAsNodeRequest(PORT, request);
    }

    if (url.pathname.startsWith('/uploads/')) {
      return serveUpload(url, env, request);
    }

    return serveAsset(request, url);
  },
};
