// Object storage facade. Uploaded books, covers and derived files live in R2 in
// the Worker and on disk during local development.
// Keys are relative paths under the uploads root, e.g. "books/12/book.pdf".

import { runtime } from './db.js';

let driver = null;

export function setStorageDriver(next) {
  driver = next;
}

export function getStorageDriver() {
  if (!driver) throw new Error('storage driver is not configured');
  return driver;
}

const MIME = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.html': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(key) {
  const match = String(key).toLowerCase().match(/\.[a-z0-9]+$/);
  return (match && MIME[match[0]]) || 'application/octet-stream';
}

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextEncoder().encode(String(value));
}

export const uploadUrl = (key) => `/uploads/${key}`;

export function keyFromUrl(url) {
  return String(url ?? '').replace(/^\/uploads\//, '');
}

export async function putObject(key, body, contentType) {
  if (runtime.storageIssue) {
    const error = new Error(runtime.storageIssue);
    error.status = 503;
    error.expose = true;
    throw error;
  }
  const bytes = toBytes(body);
  await getStorageDriver().put(key, bytes, contentType ?? contentTypeFor(key));
  return { key, size: bytes.length };
}

/** @returns {Promise<{bytes: Uint8Array, contentType: string, size: number} | null>} */
export async function getObject(key) {
  return (await getStorageDriver().get(key)) ?? null;
}

export async function getText(key) {
  const object = await getObject(key);
  if (!object) return null;
  if (typeof object.text === 'string') return object.text;
  return new TextDecoder().decode(object.bytes);
}

export async function objectExists(key) {
  const current = getStorageDriver();
  if (typeof current.exists === 'function') return current.exists(key);
  return Boolean(await current.get(key));
}

export async function deleteObject(key) {
  await getStorageDriver().delete(key);
}

export async function deleteObjects(prefix) {
  await getStorageDriver().deletePrefix(prefix);
}

/** Metadata only (no body read) when the driver can provide it. */
export async function statObject(key) {
  const current = getStorageDriver();
  if (typeof current.stat === 'function') return current.stat(key);
  const object = await current.get(key);
  return object ? { size: object.size, contentType: object.contentType } : null;
}

/** Browser-usable CDN links, or null when files must be proxied (private store). */
export async function objectLink(key) {
  const current = getStorageDriver();
  return typeof current.link === 'function' ? current.link(key) : null;
}
