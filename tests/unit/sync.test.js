/**
 * tests/unit/sync.test.js
 *
 * Unit tests for api/sync.js.
 * Covers the Airtable chunking logic (max 10 records per request), error
 * propagation, and env-var validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/sync.js';
import { makeFetchMock, makeNetworkErrorMock, makeReqRes } from '../helpers/mockAirtable.js';

beforeEach(() => {
  process.env.AIRTABLE_TOKEN      = 'test-token';
  process.env.AIRTABLE_BASE_ID    = 'appTestBase123';
  process.env.AIRTABLE_TABLE_NAME = 'Observations';
});

afterEach(() => {
  vi.restoreAllMocks();
});

function call(body, method = 'POST') {
  const { req, res } = makeReqRes(body, method);
  return handler(req, res).then(() => res);
}

function makeRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    fields: { ObserverId: `user_${i}`, Count: i + 1 },
  }));
}

// ── HTTP method guard ─────────────────────────────────────────────────────────

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
});

// ── Env-var validation ────────────────────────────────────────────────────────

describe('environment variable validation', () => {
  it('returns 500 when AIRTABLE_TOKEN is missing', async () => {
    delete process.env.AIRTABLE_TOKEN;
    const res = await call({ records: makeRecords(1) });
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/not configured/i);
  });

  it('returns 500 when AIRTABLE_BASE_ID is missing', async () => {
    delete process.env.AIRTABLE_BASE_ID;
    const res = await call({ records: makeRecords(1) });
    expect(res._status).toBe(500);
  });

  it('returns 500 when AIRTABLE_TABLE_NAME is missing', async () => {
    delete process.env.AIRTABLE_TABLE_NAME;
    const res = await call({ records: makeRecords(1) });
    expect(res._status).toBe(500);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('input validation', () => {
  it('returns 400 when records is missing', async () => {
    const res = await call({});
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/no records provided/i);
  });

  it('returns 400 when records is not an array', async () => {
    const res = await call({ records: 'not-an-array' });
    expect(res._status).toBe(400);
  });

  it('returns 400 when records array is empty', async () => {
    const res = await call({ records: [] });
    expect(res._status).toBe(400);
  });
});

// ── Successful sync ───────────────────────────────────────────────────────────

describe('successful sync', () => {
  it('syncs a single record and returns rowsSynced', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ records: [] }));
    const res = await call({ records: makeRecords(1) });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.rowsSynced).toBe(1);
  });

  it('syncs exactly 10 records in one fetch call', async () => {
    const mockFetch = makeFetchMock({ records: [] });
    vi.stubGlobal('fetch', mockFetch);
    const res = await call({ records: makeRecords(10) });
    expect(res._status).toBe(200);
    expect(res._body.rowsSynced).toBe(10);
    expect(mockFetch).toHaveBeenCalledTimes(1); // 10 records = 1 chunk
  });

  it('splits 25 records into 3 chunks (10 + 10 + 5)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ records: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const res = await call({ records: makeRecords(25) });
    expect(res._status).toBe(200);
    expect(res._body.rowsSynced).toBe(25);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 3 chunks
  });

  it('sends records to the correct Airtable URL', async () => {
    const mockFetch = makeFetchMock({ records: [] });
    vi.stubGlobal('fetch', mockFetch);
    await call({ records: makeRecords(1) });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('appTestBase123');
    expect(calledUrl).toContain('Observations');
  });

  it('includes Authorization header with Bearer token', async () => {
    const mockFetch = makeFetchMock({ records: [] });
    vi.stubGlobal('fetch', mockFetch);
    await call({ records: makeRecords(1) });
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBe('Bearer test-token');
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('returns Airtable error status when a chunk fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({ error: { message: 'Invalid field value' } }),
    }));
    const res = await call({ records: makeRecords(5) });
    expect(res._status).toBe(422);
    expect(res._body.error).toMatch(/invalid field value/i);
  });

  it('stops processing on first failed chunk and returns error', async () => {
    // First chunk succeeds, second fails
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ records: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: vi.fn().mockResolvedValue({ error: { message: 'Bad record' } }) });
    vi.stubGlobal('fetch', mockFetch);
    const res = await call({ records: makeRecords(15) }); // 2 chunks
    expect(res._status).toBe(400);
    // Should NOT have attempted a third call
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns 500 on network error', async () => {
    vi.stubGlobal('fetch', makeNetworkErrorMock('DNS lookup failed'));
    const res = await call({ records: makeRecords(3) });
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/server error/i);
  });
});
