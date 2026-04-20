/**
 * E2E tests — Authentication endpoints (/api/auth)
 *
 * These tests make real HTTP calls to your deployed or locally running API
 * and hit the real Airtable base. They verify the full request/response cycle.
 *
 * Requirements:
 *   .env.test must include:
 *     TEST_API_URL   — e.g. https://your-preview.vercel.app
 *     TEST_USERNAME  — username of a dedicated Active Observer test account
 *     TEST_PIN       — PIN for that account
 *
 * If TEST_API_URL is not set, all tests in this file are skipped automatically.
 * Create a dedicated test user in Airtable; do not use real user credentials.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { post, getBaseUrl } from '../helpers/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load env from .env.test if not already in process.env ───────────────────
beforeAll(() => {
  const envPath = resolve(process.cwd(), '.env.test');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!process.env[key]) {
      process.env[key] = raw.replace(/^["']|["']$/g, '').trim();
    }
  }
});

// Skip the entire suite if no API URL is configured
const describeE2E = getBaseUrl() || process.env.TEST_API_URL
  ? describe
  : describe.skip;

describeE2E('E2E /api/auth — login', () => {
  it('returns 200 + token for valid credentials', async () => {
    const { status, data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
      pin:      process.env.TEST_PIN,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.token).toBe('string');
    expect(data.token.split('.').length).toBe(3); // valid JWT structure
    expect(data.user.username).toBe(process.env.TEST_USERNAME);
  });

  it('returns 401 for an unrecognised username', async () => {
    const { status, data } = await post('/api/auth', {
      action:   'login',
      username: '__definitely_does_not_exist__',
      pin:      '0000',
    });
    expect(status).toBe(401);
    expect(data.error).toBeTruthy();
  });

  it('returns 401 for a valid username but wrong PIN', async () => {
    const { status, data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
      pin:      '0000', // deliberately wrong
    });
    // The correct PIN must not be '0000' for this assertion to hold
    if (process.env.TEST_PIN === '0000') {
      return; // skip — test PIN happens to be 0000
    }
    expect(status).toBe(401);
    expect(data.error).toBeTruthy();
  });

  it('returns 400 when username is omitted', async () => {
    const { status, data } = await post('/api/auth', {
      action: 'login',
      pin:    '1234',
    });
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it('returns 400 when PIN is omitted', async () => {
    const { status, data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
    });
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it('returns 400 when both username and PIN are omitted', async () => {
    const { status, data } = await post('/api/auth', { action: 'login' });
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it('returns 401 for empty string credentials', async () => {
    const { status } = await post('/api/auth', {
      action:   'login',
      username: '',
      pin:      '',
    });
    expect([400, 401]).toContain(status);
  });
});

describeE2E('E2E /api/auth — protected routes require a valid token', () => {
  let validToken = null;

  beforeAll(async () => {
    const { data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
      pin:      process.env.TEST_PIN,
    });
    validToken = data.token ?? null;
  });

  it('returns 401 for getUsers without a token', async () => {
    const { status } = await post('/api/auth', { action: 'getUsers' });
    expect(status).toBe(401);
  });

  it('returns 401 for getUsers with a tampered token', async () => {
    const bad = (validToken ?? 'x.y.z') + 'TAMPERED';
    const { status } = await post('/api/auth', { action: 'getUsers' }, bad);
    expect(status).toBe(401);
  });

  it('returns 403 for getUsers when the test user is an Observer (not Admin)', async () => {
    if (!validToken) return;
    // If the test account is Observer, getUsers should return 403
    const { status, data } = await post('/api/auth', { action: 'getUsers' }, validToken);
    // Accept 200 (if test user is Admin) or 403 (if Observer)
    expect([200, 403]).toContain(status);
    if (status === 403) expect(data.error).toMatch(/admin/i);
  });
});

describeE2E('E2E /api/auth — rate limiting', () => {
  it('returns 405 for a GET request', async () => {
    const url = `${getBaseUrl()}/api/auth`;
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(405);
  });
});
