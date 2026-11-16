// Cloudflare R2 over its S3 API, for hosts that cannot use a Worker binding
// (the Vercel deployment). Keys are the same relative paths used everywhere
// else ("books/12/book.pdf"), so stored file URLs keep working unchanged.
//
// Files are served by the app itself, never by a public bucket URL: the reader
// fetches with credentials and needs Content-Range on ranged reads, which a
// public bucket does not answer with CORS credentials.
import { AwsClient } from 'aws4fetch';
import { contentTypeFor } from '../storage.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** XML from R2 is tiny and flat here, so a tag scan beats shipping a parser. */
function tag(xml, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function tags(xml, name) {
  const found = [];
  const pattern = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  let match;
  while ((match = pattern.exec(xml))) found.push(decodeXml(match[1]));
  return found;
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');

/**
 * @param {{accountId?: string, endpoint?: string, accessKeyId: string, secretAccessKey: string, bucket: string}} config
 */
export function createR2Storage({ accountId, endpoint, accessKeyId, secretAccessKey, bucket }) {
  const origin = String(endpoint || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

  const wrap = (action) => (cause) => {
    const error = new Error(`Cloudflare R2: ${action}ไม่สำเร็จ — ${cause?.message ?? cause}`);
    error.expose = true;
    error.status = 502;
    throw error;
  };

  async function send(method, key, { headers = {}, body, query } = {}) {
    const url = new URL(`${origin}/${bucket}/${key ? encodeKey(key) : ''}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    return client.fetch(url.toString(), { method, headers, body });
  }

  async function failure(action, response) {
    const detail = await response.text().catch(() => '');
    const error = new Error(
      `Cloudflare R2: ${action}ไม่สำเร็จ (HTTP ${response.status})${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
    );
    error.expose = true;
    error.status = 502;
    return error;
  }

  async function bytesOf(response) {
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Lists one page of keys; R2 caps a page at 1000 entries. */
  async function listPage(prefix, continuationToken) {
    const response = await send('GET', '', {
      query: {
        'list-type': '2',
        prefix: prefix || undefined,
        'continuation-token': continuationToken || undefined,
        'max-keys': 1000,
      },
    }).catch(wrap('อ่านรายการไฟล์'));
    if (!response.ok) throw await failure('อ่านรายการไฟล์', response);
    const xml = decoder.decode(await bytesOf(response));
    return {
      keys: tags(xml, 'Key'),
      truncated: tag(xml, 'IsTruncated') === 'true',
      next: tag(xml, 'NextContinuationToken'),
    };
  }

  return {
    async put(key, bytes, contentType) {
      const response = await send('PUT', key, {
        headers: { 'content-type': contentType ?? contentTypeFor(key) },
        body: bytes,
      }).catch(wrap('บันทึกไฟล์'));
      if (!response.ok) throw await failure('บันทึกไฟล์', response);
    },
    async get(key) {
      const response = await send('GET', key).catch(wrap('อ่านไฟล์'));
      if (response.status === 404) return null;
      if (!response.ok) throw await failure('อ่านไฟล์', response);
      const bytes = await bytesOf(response);
      return {
        bytes,
        contentType: response.headers.get('content-type') ?? contentTypeFor(key),
        size: bytes.length,
      };
    },
    /** Metadata only, so a range request never downloads the whole book. */
    async stat(key) {
      const response = await send('HEAD', key).catch(wrap('อ่านข้อมูลไฟล์'));
      if (response.status === 404) return null;
      if (!response.ok) throw await failure('อ่านข้อมูลไฟล์', response);
      const size = Number(response.headers.get('content-length'));
      if (!Number.isFinite(size)) return null;
      return { size, contentType: response.headers.get('content-type') ?? contentTypeFor(key) };
    },
    /** Reads `start`..`end` (inclusive) without buffering the whole object. */
    async readRange(key, start, end) {
      const response = await send('GET', key, {
        headers: { range: `bytes=${start}-${end}` },
      }).catch(wrap('อ่านไฟล์'));
      if (response.status === 404) return null;
      if (!response.ok) throw await failure('อ่านไฟล์', response);
      const bytes = await bytesOf(response);
      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        const total = Number(contentRange.split('/').pop());
        return {
          bytes,
          contentType: response.headers.get('content-type') ?? contentTypeFor(key),
          total: Number.isFinite(total) ? total : bytes.length,
        };
      }
      // The store ignored the Range header and sent everything: cut the window.
      return {
        bytes: bytes.subarray(Math.min(start, bytes.length), Math.min(end + 1, bytes.length)),
        contentType: response.headers.get('content-type') ?? contentTypeFor(key),
        total: bytes.length,
      };
    },
    async exists(key) {
      const response = await send('HEAD', key).catch(wrap('ตรวจไฟล์'));
      if (response.status === 404) return false;
      if (!response.ok) throw await failure('ตรวจไฟล์', response);
      return true;
    },
    /** Every key under `prefix`, paged, for restoring a library from the bucket. */
    async list(prefix) {
      const keys = [];
      let token;
      do {
        const page = await listPage(prefix, token);
        keys.push(...page.keys);
        token = page.truncated ? page.next : undefined;
      } while (token);
      return keys;
    },
    async delete(key) {
      const response = await send('DELETE', key).catch(wrap('ลบไฟล์'));
      if (!response.ok && response.status !== 404) throw await failure('ลบไฟล์', response);
    },
    async deletePrefix(prefix) {
      let token;
      do {
        const page = await listPage(prefix, token);
        for (const key of page.keys) {
          const response = await send('DELETE', key).catch(wrap('ลบไฟล์'));
          if (!response.ok && response.status !== 404) throw await failure('ลบไฟล์', response);
        }
        token = page.truncated ? page.next : undefined;
      } while (token);
    },
    // Files are proxied through the app, so there is no public CDN link.
    async link() {
      return null;
    },
  };
}

/** True when every value the driver needs is present. */
export function r2Configured(config) {
  return Boolean(
    config &&
      (config.endpoint || config.accountId) &&
      config.accessKeyId &&
      config.secretAccessKey &&
      config.bucket,
  );
}

/** Names of the settings that are still missing, for an actionable error. */
export function missingR2Settings(config) {
  const missing = [];
  if (!config?.endpoint && !config?.accountId) missing.push('R2_ACCOUNT_ID');
  if (!config?.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!config?.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!config?.bucket) missing.push('R2_BUCKET');
  return missing;
}
