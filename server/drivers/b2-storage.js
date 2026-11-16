import { AwsClient } from 'aws4fetch';
import { contentTypeFor } from '../storage.js';

/**
 * Private Backblaze B2 bucket through its S3-compatible API.
 * Required Worker bindings/vars: B2_KEY_ID, B2_APPLICATION_KEY,
 * B2_ENDPOINT (for example https://s3.us-west-004.backblazeb2.com),
 * B2_REGION (for example us-west-004), and B2_BUCKET.
 */
export function createB2Storage(env) {
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT, B2_REGION, B2_BUCKET } = env;
  const required = { B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT, B2_REGION, B2_BUCKET };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`Missing B2 configuration: ${missing.join(', ')}`);

  const endpoint = B2_ENDPOINT.replace(/\/+$/, '');
  const client = new AwsClient({
    accessKeyId: B2_KEY_ID,
    secretAccessKey: B2_APPLICATION_KEY,
    service: 's3',
    region: B2_REGION,
  });

  // Encode each key segment separately so "/" remains the object-key separator.
  const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');
  const objectUrl = (key) => `${endpoint}/${encodeURIComponent(B2_BUCKET)}/${encodeKey(key)}`;
  const bucketUrl = () => `${endpoint}/${encodeURIComponent(B2_BUCKET)}`;

  async function signedFetch(url, options = {}) {
    const response = await client.fetch(url, options);
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Backblaze B2 S3 API error ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response;
  }

  async function list(prefix = '') {
    const keys = [];
    let token;
    do {
      const url = new URL(bucketUrl());
      url.searchParams.set('list-type', '2');
      if (prefix) url.searchParams.set('prefix', prefix);
      if (token) url.searchParams.set('continuation-token', token);
      const response = await signedFetch(url.toString());
      if (response.status === 404) return keys;
      const xml = await response.text();
      const decodeXml = (value) => value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
        keys.push(decodeXml(match[1]));
      }
      const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      token = next ? decodeXml(next[1]) : undefined;
    } while (token);
    return keys;
  }

  return {
    async put(key, bytes, contentType) {
      await signedFetch(objectUrl(key), {
        method: 'PUT',
        headers: { 'Content-Type': contentType || contentTypeFor(key) },
        body: bytes,
      });
    },
    async get(key) {
      const response = await signedFetch(objectUrl(key));
      if (response.status === 404) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        bytes,
        contentType: response.headers.get('content-type') || contentTypeFor(key),
        size: bytes.length,
      };
    },
    async exists(key) {
      return (await signedFetch(objectUrl(key), { method: 'HEAD' })).status !== 404;
    },
    async stat(key) {
      const response = await signedFetch(objectUrl(key), { method: 'HEAD' });
      if (response.status === 404) return null;
      return {
        size: Number(response.headers.get('content-length')) || 0,
        contentType: response.headers.get('content-type') || contentTypeFor(key),
      };
    },
    async delete(key) {
      await signedFetch(objectUrl(key), { method: 'DELETE' });
    },
    async deletePrefix(prefix) {
      const keys = await list(prefix);
      for (let i = 0; i < keys.length; i += 50) {
        await Promise.all(keys.slice(i, i + 50).map((key) =>
          signedFetch(objectUrl(key), { method: 'DELETE' })
        ));
      }
    },
    list,
    // The bucket is private; uploads are streamed through the Worker endpoint.
    link() {
      return null;
    },
  };
}
