/**
 * tests/unit/auth.test.js
 *
 * Unit tests for api/auth.js.
 * Every Airtable call is intercepted by mocking globalThis.fetch — no
 * network or real Airtable account is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/auth.js';
import {
  makeFetchMock,
  makeNetworkErrorMock,
  makeReqRes,
  airtableList,
  airtableRecord,
  ACTIVE_USER,
  PENDING_USER,
  SUSPENDED_USER,
  ADMIN_USER,
} from '../helpers/mockAirtable.js';

// Set required env vars once
beforeEach(() => {
  process.env.AIRTABLE_TOKEN   = 'test-token';
  process.env.AIRTABLE_BASE_ID = 'appTestBase123';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function call(body, method = 'POST') {
  const { req, res } = makeReqRes(body, method);
  return handler(req, res).then(() => res);
}

// ── OPTIONS / Method guard ───────────────────────────────────────────────────

describe('HTTP method handling', () => {
  it('returns 200 for OPTIONS preflight', async () => {
    const { req, res } = makeReqRes({}, 'OPTIONS');
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('returns 405 for GET requests', async () => {
    const res = await call({}, 'GET');
    expect(res._status).toBe(405);
    expect(res._body.error).toMatch(/method not allowed/i);
  });

  it('returns 400 for unknown action', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList()));
    const res = await call({ action: 'doSomethingWeird' });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unknown action/i);
  });
});

// ── LOGIN ────────────────────────────────────────────────────────────────────

describe('action: login', () => {
  it('returns user data on valid credentials', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await call({ action: 'login', username: 'spotter01', pin: '1234' });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.user).toMatchObject({
      username: 'spotter01',
      role: 'Observer',
      name: 'Jane Doe',
    });
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await call({ action: 'login', username: 'spotter01' });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/missing credentials/i);
  });

  it('returns 401 when user is not found', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({ action: 'login', username: 'ghost', pin: '0000' });
    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/invalid id or pin/i);
  });

  it('returns 401 when PIN is wrong', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await call({ action: 'login', username: 'spotter01', pin: 'wrong' });
    expect(res._status).toBe(401);
  });

  it('returns 403 for Pending accounts', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([PENDING_USER])));
    const res = await call({ action: 'login', username: 'newspotter', pin: '5678' });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/pending/i);
  });

  it('returns 403 for Suspended accounts', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([SUSPENDED_USER])));
    const res = await call({ action: 'login', username: 'badactor', pin: '0000' });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/suspended/i);
  });

  it('returns 500 on Airtable network failure', async () => {
    vi.stubGlobal('fetch', makeNetworkErrorMock());
    const res = await call({ action: 'login', username: 'spotter01', pin: '1234' });
    expect(res._status).toBe(500);
  });
});

// ── REGISTER ─────────────────────────────────────────────────────────────────

describe('action: register', () => {
  it('creates a new Pending user on valid input', async () => {
    // First call: check existing (empty), second call: create
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([]),
      { records: [airtableRecord('rec_new', { Username: 'newuser' })] },
    ]));
    const res = await call({ action: 'register', username: 'newuser', pin: '4321', name: 'New User' });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 400 when any field is missing', async () => {
    const res = await call({ action: 'register', username: 'newuser', pin: '4321' }); // no name
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/all fields required/i);
  });

  it('returns 400 when PIN is shorter than 4 digits', async () => {
    const res = await call({ action: 'register', username: 'newuser', pin: '12', name: 'Test' });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/pin must be at least 4/i);
  });

  it('returns 409 when username is already taken', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await call({ action: 'register', username: 'spotter01', pin: '9999', name: 'Dupe' });
    expect(res._status).toBe(409);
    expect(res._body.error).toMatch(/already taken/i);
  });
});

// ── GET USERS (admin) ─────────────────────────────────────────────────────────

describe('action: getUsers', () => {
  it('returns user list for valid admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),   // admin verify
      airtableList([ACTIVE_USER, PENDING_USER]), // all users
    ]));
    const res = await call({ action: 'getUsers', adminUsername: 'adminuser', adminPin: 'admin99' });
    expect(res._status).toBe(200);
    expect(Array.isArray(res._body.users)).toBe(true);
    expect(res._body.users).toHaveLength(2);
    expect(res._body.users[0]).toHaveProperty('username');
    expect(res._body.users[0]).not.toHaveProperty('PIN'); // PIN must NOT be exposed
  });

  it('returns 403 for non-admin credentials', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([]))); // admin lookup returns empty
    const res = await call({ action: 'getUsers', adminUsername: 'spotter01', adminPin: '1234' });
    expect(res._status).toBe(403);
  });

  it('returns 403 when admin PIN is wrong', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ADMIN_USER])));
    const res = await call({ action: 'getUsers', adminUsername: 'adminuser', adminPin: 'wrongpin' });
    expect(res._status).toBe(403);
  });
});

// ── UPDATE USER (admin) ───────────────────────────────────────────────────────

describe('action: updateUser', () => {
  it('updates a user record for valid admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),    // admin verify
      { id: 'rec_user_2', fields: { Status: 'Active' } }, // patch response
    ]));
    const res = await call({
      action: 'updateUser',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      targetId: 'rec_user_2',
      fields: { Status: 'Active' },
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({
      action: 'updateUser',
      adminUsername: 'spotter01',
      adminPin: '1234',
      targetId: 'rec_user_2',
      fields: { Status: 'Active' },
    });
    expect(res._status).toBe(403);
  });
});

// ── CREATE USER (admin) ───────────────────────────────────────────────────────

describe('action: createUser', () => {
  it('creates a new active user for valid admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),   // admin verify
      airtableList([]),              // username check: not taken
      { records: [airtableRecord('rec_new_admin', { Username: 'newadmin' })] }, // create
    ]));
    const res = await call({
      action: 'createUser',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      username: 'newadmin',
      pin: '7777',
      name: 'New Admin',
      role: 'Admin',
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 409 if username already exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),   // admin verify
      airtableList([ACTIVE_USER]),  // username check: already taken
    ]));
    const res = await call({
      action: 'createUser',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      username: 'spotter01',
      pin: '1234',
      name: 'Dupe',
    });
    expect(res._status).toBe(409);
  });

  it('returns 403 for non-admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({
      action: 'createUser',
      adminUsername: 'hacker',
      adminPin: '0000',
      username: 'victim',
      pin: '1111',
      name: 'Victim',
    });
    expect(res._status).toBe(403);
  });
});
