/**
 * tests/e2e/missions.e2e.test.js
 *
 * End-to-end tests for /api/missions.
 * Includes a full pipeline test covering the complete mission lifecycle:
 *   business creates mission → admin approves → spotter claims →
 *   spotter submits data → admin approves data → spotter levels up
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../helpers/testServer.js';
import {
  makeFetchMock,
  airtableList,
  airtableRecord,
  ADMIN_USER,
} from '../helpers/mockAirtable.js';

let app;

beforeAll(() => {
  process.env.AIRTABLE_TOKEN      = 'test-token';
  process.env.AIRTABLE_BASE_ID    = 'appTestBase123';
  process.env.AIRTABLE_TABLE_NAME = 'Observations';
  app = createServer();
});

afterEach(() => { vi.restoreAllMocks(); });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OPEN_MISSION = airtableRecord('rec_m1', {
  Title: 'Count traffic at downtown Starbucks',
  Location: '100 Market St',
  Type: 'standard',
  RewardCents: 600,
  DurationMinutes: 60,
  Status: 'open',
});

const SPOTTER = airtableRecord('rec_sp1', {
  Username: 'scout42',
  PIN: '4242',
  Name: 'Scout Fortytwo',
  Role: 'Observer',
  Status: 'Active',
  CompletedMissions: 0,
});

// ── Basic endpoint tests ──────────────────────────────────────────────────────

describe('POST /api/missions — basic', () => {
  it('returns 405 for GET', async () => {
    const res = await request(app).get('/api/missions');
    expect(res.status).toBe(405);
  });

  it('returns 200 for OPTIONS', async () => {
    const res = await request(app).options('/api/missions');
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown action', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList()));
    const res = await request(app).post('/api/missions').send({ action: 'doSomethingUnknown' });
    expect(res.status).toBe(400);
  });
});

// ── Mission creation and approval ─────────────────────────────────────────────

describe('Mission creation and admin approval', () => {
  it('admin creates a mission; it starts in pending_approval', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { records: [airtableRecord('rec_new', { Status: 'pending_approval' })] },
    ]));
    const res = await request(app).post('/api/missions').send({
      action: 'createMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      mission: {
        title: 'Count foot traffic at the new bakery',
        location: '55 Baker Street',
        type: 'standard',
        rewardCents: 500,
        durationMinutes: 60,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.missionId).toBeDefined();
  });

  it('admin can approve a pending mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_new', fields: { Status: 'open' } },
    ]));
    const res = await request(app).post('/api/missions').send({
      action: 'approveMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId: 'rec_new',
    });
    expect(res.status).toBe(200);
  });

  it('admin can reject a pending mission with a reason', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_new', fields: { Status: 'rejected' } },
    ]));
    const res = await request(app).post('/api/missions').send({
      action: 'rejectMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId: 'rec_new',
      reason: 'Location is outside our coverage area',
    });
    expect(res.status).toBe(200);
  });

  it('non-admin cannot create a mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await request(app).post('/api/missions').send({
      action: 'createMission',
      adminUsername: 'scout42',
      adminPin: '4242',
      mission: {
        title: 'Count traffic at my favorite shop',
        location: 'Some place',
        type: 'standard',
        rewardCents: 500,
        durationMinutes: 60,
      },
    });
    expect(res.status).toBe(403);
  });
});

// ── Spotter flow ──────────────────────────────────────────────────────────────

describe('Spotter claiming and submitting', () => {
  it('spotter sees open missions filtered by their level', async () => {
    const advancedMission = airtableRecord('rec_m_adv', {
      ...OPEN_MISSION.fields,
      Type: 'advanced',
    });
    vi.stubGlobal('fetch', makeFetchMock(airtableList([OPEN_MISSION, advancedMission])));
    const res = await request(app).post('/api/missions').send({
      action: 'listMissions',
      spotterLevel: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.missions.every(m => m.Type === 'standard')).toBe(true);
  });

  it('spotter claims an open mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER]),
      { id: 'rec_m1', fields: OPEN_MISSION.fields },
      { id: 'rec_m1', fields: { Status: 'claimed', ClaimedBy: 'scout42' } },
    ]));
    const res = await request(app).post('/api/missions').send({
      action: 'claimMission',
      username: 'scout42',
      pin: '4242',
      missionId: 'rec_m1',
    });
    expect(res.status).toBe(200);
  });
});

// ── Full Mission Lifecycle Pipeline ──────────────────────────────────────────

describe('Full mission lifecycle pipeline', () => {
  it('completes the entire flow: create → approve → claim → submit → approve data', async () => {
    // 1. Admin creates a mission
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { records: [airtableRecord('rec_lifecycle', { Status: 'pending_approval' })] },
    ]));
    const createRes = await request(app).post('/api/missions').send({
      action: 'createMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      mission: {
        title: 'Observe lunch rush at downtown food court',
        location: 'City Center Mall, Food Court',
        type: 'standard',
        rewardCents: 800,
        durationMinutes: 60,
      },
    });
    expect(createRes.status).toBe(200);
    const missionId = createRes.body.missionId;

    // 2. Admin approves the mission
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: missionId, fields: { Status: 'open' } },
    ]));
    const approveRes = await request(app).post('/api/missions').send({
      action: 'approveMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId,
    });
    expect(approveRes.status).toBe(200);

    // 3. Spotter claims the mission
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER]),
      { id: missionId, fields: { ...OPEN_MISSION.fields, Status: 'open' } },
      { id: missionId, fields: { Status: 'claimed', ClaimedBy: 'scout42' } },
    ]));
    const claimRes = await request(app).post('/api/missions').send({
      action: 'claimMission',
      username: 'scout42',
      pin: '4242',
      missionId,
    });
    expect(claimRes.status).toBe(200);

    // 4. Spotter submits observations
    vi.restoreAllMocks();
    const observations = [
      { timestamp: '2026-04-01T12:00:00Z', customerCount: 34 },
      { timestamp: '2026-04-01T12:15:00Z', customerCount: 41 },
      { timestamp: '2026-04-01T12:30:00Z', customerCount: 29 },
      { timestamp: '2026-04-01T12:45:00Z', customerCount: 55 },
    ];
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER]),
      { id: missionId, fields: { Status: 'claimed', ClaimedBy: 'scout42' } },
      { id: missionId, fields: { Status: 'submitted' } },
    ]));
    const submitRes = await request(app).post('/api/missions').send({
      action: 'submitMission',
      username: 'scout42',
      pin: '4242',
      missionId,
      observations,
    });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.observationCount).toBe(4);

    // 5. Admin approves the data — spotter's completed count increments
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: missionId, fields: { Status: 'submitted', ClaimedBy: 'scout42' } },
      { id: missionId, fields: { Status: 'approved' } },
      airtableList([SPOTTER]),  // getUser for spotter
      { id: SPOTTER.id, fields: { CompletedMissions: 1 } }, // increment
    ]));
    const dataApproveRes = await request(app).post('/api/missions').send({
      action: 'approveMissionData',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId,
    });
    expect(dataApproveRes.status).toBe(200);
    expect(dataApproveRes.body.success).toBe(true);
  });
});

// ── Level progression ─────────────────────────────────────────────────────────

describe('Level gate enforcement across the pipeline', () => {
  it('a level-2 spotter is blocked from advanced missions, then qualifies at level 3', async () => {
    const advancedMission = airtableRecord('rec_adv_gate', {
      Title: 'Staff-to-customer ratio tracking',
      Location: '200 Elm St',
      Type: 'advanced',
      RewardCents: 1500,
      DurationMinutes: 90,
      Status: 'open',
    });

    const level2Spotter = airtableRecord('rec_lvl2', {
      Username: 'field_op',
      PIN: '2222',
      Name: 'Field Op',
      Role: 'Observer',
      Status: 'Active',
      CompletedMissions: 7, // Level 2
    });

    // Attempt 1: Level 2 — should be blocked
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([level2Spotter]),
      { id: 'rec_adv_gate', fields: advancedMission.fields },
    ]));
    const blockedRes = await request(app).post('/api/missions').send({
      action: 'claimMission',
      username: 'field_op',
      pin: '2222',
      missionId: 'rec_adv_gate',
    });
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error).toMatch(/level/i);

    // Attempt 2: After leveling up to 3 — should succeed
    vi.restoreAllMocks();
    const level3Spotter = { ...level2Spotter, fields: { ...level2Spotter.fields, CompletedMissions: 15 } };
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([level3Spotter]),
      { id: 'rec_adv_gate', fields: advancedMission.fields },
      { id: 'rec_adv_gate', fields: { Status: 'claimed' } },
    ]));
    const allowedRes = await request(app).post('/api/missions').send({
      action: 'claimMission',
      username: 'field_op',
      pin: '2222',
      missionId: 'rec_adv_gate',
    });
    expect(allowedRes.status).toBe(200);
  });
});
