import crypto from 'node:crypto';
import { db, nowIso } from './db.js';

const SESSION_COOKIE = 'nakhonmaesot_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, nowIso(), expires);
  return { token, expires };
}

/** Cookies are only marked Secure when the request actually came over HTTPS. */
export function isSecureRequest(req) {
  if (process.env.COOKIE_SECURE === 'false') return false;
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  return forwarded === 'https' || req.protocol === 'https';
}

export function sessionCookie(token, maxAgeSeconds = SESSION_DAYS * 86400, { secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header = '') {
  return header.split(';').reduce((acc, chunk) => {
    const index = chunk.indexOf('=');
    if (index > -1) acc[chunk.slice(0, index).trim()] = decodeURIComponent(chunk.slice(index + 1).trim());
    return acc;
  }, {});
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    affiliation: row.affiliation,
    bio: row.bio,
    avatarHue: row.avatar_hue,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.*, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.status = 'active'`,
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return publicUser(row);
}

export async function attachUser(req, _res, next) {
  try {
    req.user = await userFromRequest(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
    }
    next();
  };
}

export const canManageContent = requireRole('admin', 'editor');
export const canAdminister = requireRole('admin');

export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Lightweight in-memory throttle for credential endpoints.
const attempts = new Map();
export function throttle(key, limit = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const entry = attempts.get(key) ?? { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= limit;
}
