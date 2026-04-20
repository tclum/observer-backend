/**
 * E2E tests — Observation sync endpoint (/api/sync)
 *
 * These tests make real HTTP calls and write test records to the real
 * Airtable Observations table. Each test uses a clearly prefixed
 * Entry ID ("E2E_TEST_*") so records are easy to identify and clean up.
 *
 * Requirements:
 *   .env.test must include:
 *     TEST_API_URL        — e.g. https://your-preview.vercel.app
 *     TEST_USERNAME       — Active Observer test account username
 *     TEST_PIN            — PIN for that account
 *     AIRTABLE_TABLE_NAME — the Observations table name
 *
 * If TEST_API_URL is not set, all tests are skipped automatically.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { post, getBaseUrl } from '../helpers/api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const describeE2E = getBaseUrl() || process.env.TEST_API_URL
  ? describe
  : describe.skip;

// ── Load fixtures for real field values ─────────────────────────────────────
let activeLocations = [];
let fieldConfig     = { Ages: [], Genders: [], Ethnicities: [], Disabilities: [], Emotions: [] };

beforeAll(() => {
  const fixturePath = resolve(__dirname, '../fixtures/airtable-data.json');
  if (!existsSync(fixturePath)) return;
  const data       = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  activeLocations  = data.activeLocations ?? [];
  fieldConfig      = data.fieldConfig     ?? fieldConfig;
});

// Helper: build a minimal valid observation record for the Airtable API
function makeTestRecord(overrides = {}) {
  return {
    fields: {
      'Entry ID':  `E2E_TEST_${Date.now()}`,
      Timestamp:   new Date().toISOString(),
      Type:        'Standard',
      Observer:    process.env.TEST_USERNAME || 'test_observer',
      Location:    activeLocations[0] || 'Test Location',
      Session:     'e2e-session',
      'Person #':  1,
      Age:         fieldConfig.Ages[0]         || '',
      Gender:      fieldConfig.Genders[0]      || '',
      Ethnicity:   fieldConfig.Ethnicities[0]  || '',
      Disability:  fieldConfig.Disabilities[0] || '',
      Emotion:     fieldConfig.Emotions[0]     || '',
      Missed:      false,
      ...overrides.fields,
    },
  };
}

describeE2E('E2E /api/sync — authentication', () => {
  it('returns 401 when no token is provided', async () => {
    const { status, data } = await post('/api/sync', {
      records: [makeTestRecord()],
    });
    expect(status).toBe(401);
    expect(data.error).toBeTruthy();
  });

  it('returns 401 for an invalid token', async () => {
    const { status } = await post('/api/sync', {
      records: [makeTestRecord()],
    }, 'invalid.token.here');
    expect(status).toBe(401);
  });
});

describeE2E('E2E /api/sync — input validation', () => {
  let token = null;

  beforeAll(async () => {
    const { data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
      pin:      process.env.TEST_PIN,
    });
    token = data.token ?? null;
  });

  it('returns 400 when records array is missing', async () => {
    if (!token) return;
    const { status, data } = await post('/api/sync', {}, token);
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it('returns 400 when records is an empty array', async () => {
    if (!token) return;
    const { status, data } = await post('/api/sync', { records: [] }, token);
    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  it('returns 400 when records is not an array', async () => {
    if (!token) return;
    const { status } = await post('/api/sync', { records: 'not-an-array' }, token);
    expect(status).toBe(400);
  });
});

describeE2E('E2E /api/sync — successful sync', () => {
  let token = null;

  beforeAll(async () => {
    const { data } = await post('/api/auth', {
      action:   'login',
      username: process.env.TEST_USERNAME,
      pin:      process.env.TEST_PIN,
    });
    token = data.token ?? null;
  });

  it('syncs a single valid observation and returns rowsSynced: 1', async () => {
    if (!token) return;
    const { status, data } = await post('/api/sync', {
      records: [makeTestRecord()],
    }, token);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.rowsSynced).toBe(1);
  });

  it('syncs 11 records (exercises the 10-record chunking logic)', async () => {
    if (!token) return;
    const records = Array.from({ length: 11 }, (_, i) =>
      makeTestRecord({ fields: { 'Entry ID': `E2E_TEST_CHUNK_${Date.now()}_${i}`, 'Person #': i + 1 } })
    );
    const { status, data } = await post('/api/sync', { records }, token);
    expect(status).toBe(200);
    expect(data.rowsSynced).toBe(11);
  });
});

describeE2E('E2E /api/sync — HTTP method guard', () => {
  it('returns 405 for a GET request', async () => {
    const url = `${getBaseUrl()}/api/sync`;
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(405);
  });
});
