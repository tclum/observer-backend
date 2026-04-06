/**
 * tests/e2e/auth.e2e.test.js
 *
 * End-to-end tests for the /api/auth endpoint.
 * A real Express server is spun up; Airtable is still mocked at the fetch layer
 * so no real credentials are needed, but the full HTTP request→handler→response
 * path is exercised, including headers, status codes, and JSON bodies.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../helpers/testServer.js';
import {
  makeFetchMock,
  airtableList,
  airtableRecord,
  ACTIVE_USER,
  PENDING_USER,
  ADMIN_USER,
} from '../helpers/mockAirtable.js';

let app;

beforeAll(() => {
  process.env.AIRTABLE_TOKEN   = 'test-token';
  process.env.AIRTABLE_BASE_ID = 'appTestBase123';
  app = createServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── CORS headers ──────────────────────────────────────────────────────────────

describe('CORS', () => {
  it('returns CORS headers on OPTIONS preflight', async () => {
    const res = await request(app).options('/api/auth');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/i);
    expect(res.status).toBe(200);
  });

  it('includes Access-Control-Allow-Origin on POST responses', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'login', username: 'spotter01', pin: '1234' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// ── Full login pipeline ───────────────────────────────────────────────────────

describe('POST /api/auth — login pipeline', () => {
  it('full happy path: returns 200 with user object', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await request(app)
      .post('/api/auth')
      .set('Content-Type', 'application/json')
      .send({ action: 'login', username: 'spotter01', pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('spotter01');
    expect(res.body.user.role).toBe('Observer');
    expect(res.body.user).not.toHaveProperty('PIN');
  });

  it('returns 401 for unknown user', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'login', username: 'nobody', pin: '0000' });
    expect(res.status).toBe(401);
  });

  it('blocks a pending user with a descriptive message', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([PENDING_USER])));
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'login', username: 'newspotter', pin: '5678' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/pending/i);
  });
});

// ── Full registration pipeline ────────────────────────────────────────────────

describe('POST /api/auth — registration pipeline', () => {
  it('registers a new spotter and queues them as Pending', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([]),    // username not taken
      { records: [airtableRecord('rec_xyz', { Username: 'freshspotter', Status: 'Pending' })] },
    ]));
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'register', username: 'freshspotter', pin: '2468', name: 'Fresh Spotter' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects duplicate username with 409', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ACTIVE_USER])));
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'register', username: 'spotter01', pin: '1111', name: 'Dupe' });
    expect(res.status).toBe(409);
  });

  it('rejects a 3-digit PIN with 400', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ action: 'register', username: 'brandnew', pin: '123', name: 'Brand New' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pin/i);
  });
});

// ── Admin user management pipeline ───────────────────────────────────────────

describe('POST /api/auth — admin pipeline', () => {
  it('admin can approve a pending user via updateUser', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),                              // auth check
      { id: 'rec_user_2', fields: { Status: 'Active' } },   // patch result
    ]));
    const res = await request(app)
      .post('/api/auth')
      .send({
        action: 'updateUser',
        adminUsername: 'adminuser',
        adminPin: 'admin99',
        targetId: 'rec_user_2',
        fields: { Status: 'Active' },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin cannot call updateUser', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await request(app)
      .post('/api/auth')
      .send({
        action: 'updateUser',
        adminUsername: 'spotter01',
        adminPin: '1234',
        targetId: 'rec_user_2',
        fields: { Status: 'Active' },
      });
    expect(res.status).toBe(403);
  });

  it('admin createUser creates an Active account immediately', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      airtableList([]),
      { records: [airtableRecord('rec_newstaff', { Username: 'newstaff', Status: 'Active' })] },
    ]));
    const res = await request(app)
      .post('/api/auth')
      .send({
        action: 'createUser',
        adminUsername: 'adminuser',
        adminPin: 'admin99',
        username: 'newstaff',
        pin: '3333',
        name: 'New Staff',
        role: 'Observer',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
