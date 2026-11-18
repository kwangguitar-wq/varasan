// Cloudflare Workers entry point for Nakhonmaesot Library.
// Express 5 runs on the runtime's node:http server bridge; D1 stores application data,
// Backblaze B2 stores uploaded files, and assets serve the SPA.
import { handleAsNodeRequest } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { installDomPolyfills } from './server/dom-polyfills.js';
import { app } from './server/app.js';
import { runtime, setDatabaseDriver } from './server/db.js';
import { createD1Driver } from './server/drivers/d1.js';
import { createB2Storage } from './server/drivers/b2-storage.js';
import { getObject, setStorageDriver } from './server/storage.js';
import { ensureDatabase } from './server/seed-import.js';

installDomPolyfills();
globalThis.pdfjsWorker = pdfjsWorker;

runtime.platform = 'worker';
runtime.maxUploadBytes = 64 * 1024 * 1024;
runtime.storageBackend = 'backblaze-b2';
runtime.databaseHost = 'd1';

setDatabaseDriver(createD1Driver(env.DB));
setStorageDriver(createB2Storage(env));

const PORT = 3000;
app.listen(PORT);

const HTML_ACCEPT = /text\/html/;

async function serveUpload(url, env, request) {
  const key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  const isHead = request.method === 'HEAD';
  // Cache the complete object at the Cloudflare edge. Range requests are served
  // from that cached object, so PDF.js page navigation does not create a B2
  // Class B transaction for every byte range.
  const cache = caches.default;
  const cacheKey = new Request(new URL(url.pathname, url.origin).toString(), { method: 'GET' });
  let object = null;
  let cachedResponse = null;

  if (request.method === 'GET' || isHead) {
    try {
      cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const bytes = new Uint8Array(await cachedResponse.arrayBuffer());
        object = {
          bytes,
          size: bytes.length,
          contentType: cachedResponse.headers.get('content-type') || 'application/octet-stream',
        };
      }
    } catch {
      // Cache is an optimization only; continue to the durable object store.
      cachedResponse = null;
      object = null;
    }
  }

  if (!object) {
    let storageError = null;
    try {
      object = await getObject(key);
      if (!object) {
        // A cold isolate may not have mirrored the bundled uploads yet.
        await ensureDatabase(env);
        object = await getObject(key);
      }
    } catch (error) {
      storageError = error;
    }

    // Bundled seed books/covers are part of the deployed static assets. Serve
    // those directly when B2 is capped or temporarily unavailable, avoiding
    // repeated failed Class B requests for demo content.
    if (!object) {
      try {
        const seedResponse = await env.ASSETS.fetch(
          new Request(new URL(`/seed/uploads/${key.split('/').map(encodeURIComponent).join('/')}`, url.origin), {
            method: isHead ? 'HEAD' : 'GET',
            headers: new Headers([...request.headers].filter(([name]) => name.toLowerCase() !== 'range')),
          }),
        );
        if (seedResponse.ok) {
          const seedHeaders = new Headers(seedResponse.headers);
          seedHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
          seedHeaders.set('Accept-Ranges', 'bytes');
          const seedBytes = isHead ? null : await seedResponse.arrayBuffer();
          const seedSize = Number(seedHeaders.get('content-length')) || (seedBytes ? seedBytes.byteLength : 0);
          if (!isHead && seedBytes) {
            try {
              await cache.put(cacheKey, new Response(seedBytes.slice(0), {
                status: 200,
                headers: seedHeaders,
              }));
            } catch {
              // Cache is optional; the deployed seed asset remains available.
            }
          }
          if (request.headers.has('range') && !isHead && seedBytes) {
            const rangeMatch = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range'));
            if (rangeMatch) {
              const rangeStart = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
              const rangeEnd = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), seedSize - 1) : seedSize - 1;
              if (rangeStart <= rangeEnd && rangeStart < seedSize) {
                const part = new Uint8Array(seedBytes).subarray(rangeStart, rangeEnd + 1);
                seedHeaders.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${seedSize}`);
                seedHeaders.set('Content-Length', String(part.length));
                return new Response(part, { status: 206, headers: seedHeaders });
              }
            }
          }
          seedHeaders.set('Content-Length', String(seedSize));
          return new Response(seedBytes, { status: 200, headers: seedHeaders });
        }
      } catch {
        // Continue to the storage error response below.
      }
    }

    if (storageError) {
      console.error('[varasan:uploads] object storage read failed:', storageError);
      return new Response('File storage is temporarily unavailable. Please try again after the storage limit resets.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' },
      });
    }
    if (!object) return new Response('Not found', { status: 404 });

    // Cache successful full-object reads only. Never cache errors or partial
    // responses. Cache failures must not prevent a book from being served.
    if (request.method === 'GET') {
      const cacheHeaders = new Headers({
        'Content-Type': object.contentType,
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'Accept-Ranges': 'bytes',
      });
      try {
        await cache.put(cacheKey, new Response(object.bytes, { status: 200, headers: cacheHeaders }));
      } catch {
        // Large objects or transient cache failures fall back to B2 on next read.
      }
    }
  }

  const headers = new Headers({
    'Content-Type': object.contentType,
    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
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
