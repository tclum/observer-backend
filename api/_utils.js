// ── AIRTABLE ──
const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
export const AT_HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
};

export async function atGet(table, formula) {
  const url = `${AT_BASE}/${encodeURIComponent(table)}${formula ? '?filterByFormula=' + encodeURIComponent(formula) : ''}`;
  const r = await fetch(url, { headers: AT_HEADERS });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

export async function atGetAll(table, formula) {
  let records = [];
  let offset = null;
  do {
    let url = `${AT_BASE}/${encodeURIComponent(table)}?pageSize=100`;
    if (formula) url += `&filterByFormula=${encodeURIComponent(formula)}`;
    if (offset) url += `&offset=${offset}`;
    const r = await fetch(url, { headers: AT_HEADERS });
    if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
    const data = await r.json();
    records = records.concat(data.records || []);
    offset = data.offset || null;
  } while (offset);
  return records;
}

export async function atCreate(table, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}`, {
    method: 'POST', headers: AT_HEADERS,
    body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

export async function atUpdate(table, id, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'PATCH', headers: AT_HEADERS,
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

export async function atDelete(table, id) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'DELETE', headers: AT_HEADERS,
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

// ── JWT (no external lib — simple HMAC-SHA256 implementation) ──
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRY_HOURS = 12;

async function hmacSha256(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function signJWT(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + JWT_EXPIRY_HOURS * 3600 }));
  const sig = await hmacSha256(JWT_SECRET, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = await hmacSha256(JWT_SECRET, `${header}.${body}`);
    if (sig !== expected) return null;
    const payload = JSON.parse(decodeURIComponent(escape(atob(body.replace(/-/g, '+').replace(/_/g, '/')))));
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

// ── BCRYPT (pure JS — no external lib) ──
// Uses a simple but secure PBKDF2-based approach since bcrypt isn't available in edge runtime
const HASH_ITERATIONS = 100000;

export async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: HASH_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
  const hash = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2,'0')).join('');
  return `pbkdf2:${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  // Handle plain-text legacy passwords (before hashing was introduced)
  if (!stored.startsWith('pbkdf2:')) return password === stored;
  const [, salt, storedHash] = stored.split(':');
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: HASH_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
  const hash = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2,'0')).join('');
  return hash === storedHash;
}

// ── RATE LIMITING (in-memory, resets on cold start) ──
const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000 / 60);
    return { allowed: false, resetIn };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

export function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
}

// ── TOKEN AUTH HELPER ──
export async function verifyToken(req) {
  const auth = req.headers['authorization'] || req.body?._token;
  if (!auth) return null;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  return verifyJWT(token);
}
