/**
 * helpers/mockAirtable.js
 *
 * Factory that produces a fetch mock pre-wired to Airtable's response shape.
 * Each helper returns a vi.fn() you can swap in for globalThis.fetch.
 *
 * Usage in a test:
 *   import { makeFetchMock } from '../helpers/mockAirtable.js';
 *   vi.stubGlobal('fetch', makeFetchMock({ records: [...] }));
 */

import { vi } from 'vitest';

/**
 * Build a minimal Airtable-style response body.
 * @param {object[]} records  Array of Airtable record objects.
 */
export function airtableList(records = []) {
  return { records };
}

/**
 * A single Airtable record, matching the shape the API returns.
 */
export function airtableRecord(id, fields) {
  return { id, fields };
}

/**
 * Return a vi.fn() that resolves with a successful JSON response.
 * @param {object|object[]} body  The JSON body (or an array of bodies for sequential calls).
 * @param {number}          status HTTP status (default 200).
 */
export function makeFetchMock(body, status = 200) {
  const makeResponse = (b, s) => ({
    ok: s >= 200 && s < 300,
    status: s,
    json: vi.fn().mockResolvedValue(b),
  });

  if (Array.isArray(body)) {
    // Multiple sequential responses
    const mock = vi.fn();
    body.forEach((b, i) => {
      const s = Array.isArray(status) ? status[i] ?? 200 : status;
      mock.mockResolvedValueOnce(makeResponse(b, s));
    });
    return mock;
  }

  return vi.fn().mockResolvedValue(makeResponse(body, status));
}

/**
 * A fetch mock that throws a network error.
 */
export function makeNetworkErrorMock(message = 'Network failure') {
  return vi.fn().mockRejectedValue(new Error(message));
}

/**
 * Convenience: build a mock Express req/res pair for unit-testing handlers directly.
 */
export function makeReqRes(body = {}, method = 'POST') {
  const req = { method, body, headers: {} };
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(data)  { this._body = data; return this; },
    end()       { return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

// ── Pre-built Airtable fixtures ──────────────────────────────────────────────

export const ACTIVE_USER = airtableRecord('rec_user_1', {
  Username: 'spotter01',
  PIN: '1234',
  Name: 'Jane Doe',
  Role: 'Observer',
  Status: 'Active',
});

export const PENDING_USER = airtableRecord('rec_user_2', {
  Username: 'newspotter',
  PIN: '5678',
  Name: 'John Pending',
  Role: 'Observer',
  Status: 'Pending',
});

export const SUSPENDED_USER = airtableRecord('rec_user_3', {
  Username: 'badactor',
  PIN: '0000',
  Name: 'Bad Actor',
  Role: 'Observer',
  Status: 'Suspended',
});

export const ADMIN_USER = airtableRecord('rec_admin_1', {
  Username: 'adminuser',
  PIN: 'admin99',
  Name: 'Admin One',
  Role: 'Admin',
  Status: 'Active',
});

export const FIELD_CONFIG_RECORD = airtableRecord('rec_cfg_1', {
  Ages: 'Under 18\n18–24\n25–34\n35–44',
  Genders: 'Male\nFemale\nNon-binary',
  Ethnicities: 'Asian\nBlack\nWhite',
  Disabilities: 'None observed\nWheelchair',
  Emotions: 'Happy\nNeutral',
});
