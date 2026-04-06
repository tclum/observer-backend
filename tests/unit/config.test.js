/**
 * tests/unit/config.test.js
 *
 * Unit tests for api/config.js.
 * Tests both getConfig (public) and updateConfig (admin-only).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/config.js';
import {
  makeFetchMock,
  makeNetworkErrorMock,
  makeReqRes,
  airtableList,
  ADMIN_USER,
  FIELD_CONFIG_RECORD,
} from '../helpers/mockAirtable.js';

beforeEach(() => {
  process.env.AIRTABLE_TOKEN   = 'test-token';
  process.env.AIRTABLE_BASE_ID = 'appTestBase123';
});

afterEach(() => {
  vi.restoreAllMocks();
});

function call(body, method = 'POST') {
  const { req, res } = makeReqRes(body, method);
  return handler(req, res).then(() => res);
}

// ── OPTIONS / method guard ────────────────────────────────────────────────────

describe('HTTP method handling', () => {
  it('returns 200 for OPTIONS preflight', async () => {
    const { req, res } = makeReqRes({}, 'OPTIONS');
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('returns 405 for GET', async () => {
    const res = await call({}, 'GET');
    expect(res._status).toBe(405);
  });

  it('returns 400 for unknown action', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList()));
    const res = await call({ action: 'unknown' });
    expect(res._status).toBe(400);
  });
});

// ── GET CONFIG ────────────────────────────────────────────────────────────────

describe('action: getConfig', () => {
  it('returns config from Airtable when a record exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([FIELD_CONFIG_RECORD])));
    const res = await call({ action: 'getConfig' });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.config.ages).toEqual(['Under 18', '18–24', '25–34', '35–44']);
    expect(res._body.config.genders).toEqual(['Male', 'Female', 'Non-binary']);
  });

  it('returns DEFAULT_CONFIG when Airtable has no records', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({ action: 'getConfig' });
    expect(res._status).toBe(200);
    // Default config contains 6 age brackets
    expect(res._body.config.ages).toHaveLength(6);
    expect(res._body.config.genders).toContain('Non-binary');
  });

  it('returns DEFAULT_CONFIG when Airtable throws (graceful fallback)', async () => {
    vi.stubGlobal('fetch', makeNetworkErrorMock());
    const res = await call({ action: 'getConfig' });
    expect(res._status).toBe(200);
    expect(res._body.config).toBeDefined();
    expect(Array.isArray(res._body.config.ages)).toBe(true);
  });

  it('fills missing fields with defaults when Airtable record is partial', async () => {
    // Only Ages is set in this record — everything else should fall back to defaults
    const partialRecord = {
      id: 'rec_partial',
      fields: { Ages: 'Under 18\n18–24' },
    };
    vi.stubGlobal('fetch', makeFetchMock(airtableList([partialRecord])));
    const res = await call({ action: 'getConfig' });
    expect(res._body.config.ages).toEqual(['Under 18', '18–24']);
    expect(res._body.config.genders).toHaveLength(4); // full default
  });
});

// ── UPDATE CONFIG ─────────────────────────────────────────────────────────────

describe('action: updateConfig', () => {
  const newConfig = {
    ages: ['Under 18', '18–30', '31–50', '50+'],
    genders: ['Male', 'Female'],
    ethnicities: ['Asian', 'Black', 'White'],
    disabilities: ['None observed'],
    emotions: ['Happy', 'Sad'],
  };

  it('updates existing config record for valid admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),          // verifyAdmin
      airtableList([FIELD_CONFIG_RECORD]), // fetch existing record
      { id: 'rec_cfg_1', fields: {} },     // patch response
    ]));
    const res = await call({
      action: 'updateConfig',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      config: newConfig,
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('creates a new config record when none exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),  // verifyAdmin
      airtableList([]),             // no existing record
      { records: [{ id: 'rec_new_cfg', fields: {} }] }, // create response
    ]));
    const res = await call({
      action: 'updateConfig',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      config: newConfig,
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 403 when admin credentials are wrong', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([]))); // verifyAdmin returns nothing
    const res = await call({
      action: 'updateConfig',
      adminUsername: 'spotter01',
      adminPin: '1234',
      config: newConfig,
    });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/admin credentials required/i);
  });

  it('returns 403 when admin PIN does not match', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ADMIN_USER])));
    const res = await call({
      action: 'updateConfig',
      adminUsername: 'adminuser',
      adminPin: 'wrongpin',
      config: newConfig,
    });
    expect(res._status).toBe(403);
  });

  it('returns 500 on unexpected Airtable error during update', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),          // verifyAdmin
      airtableList([FIELD_CONFIG_RECORD]), // fetch existing
      // patch fails
    ]));
    // Override last call to fail
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(airtableList([ADMIN_USER])) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(airtableList([FIELD_CONFIG_RECORD])) })
      .mockResolvedValueOnce({ ok: false, status: 422, json: vi.fn().mockResolvedValue({ error: { message: 'Invalid fields' } }) });
    vi.stubGlobal('fetch', mockFetch);

    const res = await call({
      action: 'updateConfig',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      config: newConfig,
    });
    expect(res._status).toBe(500);
  });
});
