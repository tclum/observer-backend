/**
 * tests/e2e/config-sync.e2e.test.js
 *
 * End-to-end tests for /api/config and /api/sync endpoints.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../helpers/testServer.js';
import {
  makeFetchMock,
  airtableList,
  airtableRecord,
  ADMIN_USER,
  FIELD_CONFIG_RECORD,
} from '../helpers/mockAirtable.js';

let app;

beforeAll(() => {
  process.env.AIRTABLE_TOKEN      = 'test-token';
  process.env.AIRTABLE_BASE_ID    = 'appTestBase123';
  process.env.AIRTABLE_TABLE_NAME = 'Observations';
  app = createServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── /api/config ───────────────────────────────────────────────────────────────

describe('POST /api/config — getConfig', () => {
  it('returns 200 with the Airtable config when a record exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([FIELD_CONFIG_RECORD])));
    const res = await request(app)
      .post('/api/config')
      .send({ action: 'getConfig' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.ages).toBeInstanceOf(Array);
    expect(res.body.config.genders).toContain('Male');
  });

  it('falls back to default config on Airtable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Airtable down')));
    const res = await request(app)
      .post('/api/config')
      .send({ action: 'getConfig' });
    expect(res.status).toBe(200);
    expect(res.body.config.ages).toHaveLength(6); // default length
  });
});

describe('POST /api/config — updateConfig (admin only)', () => {
  const newConfig = {
    ages: ['Under 18', '18–30', '31+'],
    genders: ['Male', 'Female', 'Non-binary'],
    ethnicities: ['Asian', 'White'],
    disabilities: ['None observed'],
    emotions: ['Happy', 'Neutral'],
  };

  it('admin can update config', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      airtableList([FIELD_CONFIG_RECORD]),
      { id: 'rec_cfg_1', fields: {} },
    ]));
    const res = await request(app)
      .post('/api/config')
      .send({ action: 'updateConfig', adminUsername: 'adminuser', adminPin: 'admin99', config: newConfig });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin cannot update config', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await request(app)
      .post('/api/config')
      .send({ action: 'updateConfig', adminUsername: 'spotter01', adminPin: '1234', config: newConfig });
    expect(res.status).toBe(403);
  });

  it('creates a new config record when none exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      airtableList([]),
      { records: [airtableRecord('rec_new_cfg', {})] },
    ]));
    const res = await request(app)
      .post('/api/config')
      .send({ action: 'updateConfig', adminUsername: 'adminuser', adminPin: 'admin99', config: newConfig });
    expect(res.status).toBe(200);
  });
});

// ── /api/sync ─────────────────────────────────────────────────────────────────

describe('POST /api/sync — observation sync pipeline', () => {
  function makeObservations(count) {
    return Array.from({ length: count }, (_, i) => ({
      fields: {
        SpotterId: `spotter_${i % 3}`,
        LocationId: `loc_${i}`,
        Timestamp: new Date().toISOString(),
        CustomerCount: Math.floor(Math.random() * 50),
        AgeRange: '25–34',
        Gender: 'Female',
      },
    }));
  }

  it('syncs a single observation successfully', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ records: [] }));
    const res = await request(app)
      .post('/api/sync')
      .send({ records: makeObservations(1) });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rowsSynced).toBe(1);
  });

  it('syncs a batch of 30 observations across 3 Airtable requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: vi.fn().mockResolvedValue({ records: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const res = await request(app)
      .post('/api/sync')
      .send({ records: makeObservations(30) });
    expect(res.status).toBe(200);
    expect(res.body.rowsSynced).toBe(30);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns 400 when records array is missing', async () => {
    const res = await request(app)
      .post('/api/sync')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no records provided/i);
  });

  it('returns 400 when records is empty', async () => {
    const res = await request(app)
      .post('/api/sync')
      .send({ records: [] });
    expect(res.status).toBe(400);
  });

  it('propagates Airtable error status back to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ error: { message: 'Rate limit exceeded' } }),
    }));
    const res = await request(app)
      .post('/api/sync')
      .send({ records: makeObservations(5) });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
  });

  it('returns 500 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    const res = await request(app)
      .post('/api/sync')
      .send({ records: makeObservations(3) });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/server error/i);
  });

  it('sends correct Authorization header to Airtable', async () => {
    const mockFetch = makeFetchMock({ records: [] });
    vi.stubGlobal('fetch', mockFetch);
    await request(app)
      .post('/api/sync')
      .send({ records: makeObservations(1) });
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ── Cross-pipeline: register → approve → sync ─────────────────────────────────

describe('Cross-pipeline: Spotter lifecycle', () => {
  it('simulates register → admin approval → data sync flow', async () => {
    // Step 1: New spotter registers
    const registerFetch = makeFetchMock([
      airtableList([]),    // username not taken
      { records: [airtableRecord('rec_s1', { Username: 'scout99', Status: 'Pending' })] },
    ]);
    vi.stubGlobal('fetch', registerFetch);
    const registerRes = await request(app)
      .post('/api/auth')
      .send({ action: 'register', username: 'scout99', pin: '7890', name: 'Scout Ninenine' });
    expect(registerRes.status).toBe(200);

    // Step 2: Admin approves the spotter
    vi.restoreAllMocks();
    const approveFetch = makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_s1', fields: { Status: 'Active' } },
    ]);
    vi.stubGlobal('fetch', approveFetch);
    const approveRes = await request(app)
      .post('/api/auth')
      .send({
        action: 'updateUser',
        adminUsername: 'adminuser',
        adminPin: 'admin99',
        targetId: 'rec_s1',
        fields: { Status: 'Active' },
      });
    expect(approveRes.status).toBe(200);

    // Step 3: Spotter submits observations via /api/sync
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetchMock({ records: [] }));
    const syncRes = await request(app)
      .post('/api/sync')
      .send({
        records: [
          { fields: { SpotterId: 'scout99', CustomerCount: 12, AgeRange: '25–34' } },
          { fields: { SpotterId: 'scout99', CustomerCount: 8,  AgeRange: '18–24' } },
        ],
      });
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.rowsSynced).toBe(2);
  });
});
