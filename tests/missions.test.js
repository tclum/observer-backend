/**
 * tests/unit/missions.test.js
 *
 * Unit tests for api/missions.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/missions.js';
import {
  makeFetchMock,
  makeNetworkErrorMock,
  makeReqRes,
  airtableList,
  airtableRecord,
  ACTIVE_USER,
  ADMIN_USER,
} from '../helpers/mockAirtable.js';

beforeEach(() => {
  process.env.AIRTABLE_TOKEN   = 'test-token';
  process.env.AIRTABLE_BASE_ID = 'appTestBase123';
});

afterEach(() => { vi.restoreAllMocks(); });

function call(body, method = 'POST') {
  const { req, res } = makeReqRes(body, method);
  return handler(req, res).then(() => res);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STANDARD_MISSION = airtableRecord('rec_m_std', {
  Title: 'Count foot traffic at Whole Foods',
  Location: '123 Main St',
  Type: 'standard',
  RewardCents: 500,
  DurationMinutes: 60,
  Status: 'open',
  Instructions: 'Sit near the entrance.',
});

const ADVANCED_MISSION = airtableRecord('rec_m_adv', {
  Title: 'Seating occupancy tracking at target restaurant',
  Location: '456 Elm Ave',
  Type: 'advanced',
  RewardCents: 1200,
  DurationMinutes: 90,
  Status: 'open',
  Instructions: 'Track table turnover every 10 minutes.',
});

const CLAIMED_MISSION = airtableRecord('rec_m_claimed', {
  ...STANDARD_MISSION.fields,
  Status: 'claimed',
  ClaimedBy: 'spotter01',
});

const SPOTTER_LEVEL1 = airtableRecord('rec_user_1', {
  ...ACTIVE_USER.fields,
  CompletedMissions: 0, // Level 1
});

const SPOTTER_LEVEL3 = airtableRecord('rec_user_3', {
  Username: 'scout99',
  PIN: '7890',
  Name: 'Scout Ninenine',
  Role: 'Observer',
  Status: 'Active',
  CompletedMissions: 15, // Level 3 — can claim advanced
});

// ── listMissions ──────────────────────────────────────────────────────────────

describe('action: listMissions', () => {
  it('returns open missions for a level-1 spotter (standard only)', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([STANDARD_MISSION, ADVANCED_MISSION])));
    const res = await call({ action: 'listMissions', spotterLevel: 1, status: 'open' });
    expect(res._status).toBe(200);
    // Level 1 cannot see advanced missions
    expect(res._body.missions).toHaveLength(1);
    expect(res._body.missions[0].Type).toBe('standard');
  });

  it('returns both mission types for a level-3 spotter', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([STANDARD_MISSION, ADVANCED_MISSION])));
    const res = await call({ action: 'listMissions', spotterLevel: 3, status: 'open' });
    expect(res._status).toBe(200);
    expect(res._body.missions).toHaveLength(2);
  });

  it('returns an empty list when no missions are open', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({ action: 'listMissions', spotterLevel: 1 });
    expect(res._status).toBe(200);
    expect(res._body.missions).toHaveLength(0);
  });
});

// ── getMission ────────────────────────────────────────────────────────────────

describe('action: getMission', () => {
  it('returns mission details for a valid missionId', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ id: 'rec_m_std', fields: STANDARD_MISSION.fields }));
    const res = await call({ action: 'getMission', missionId: 'rec_m_std' });
    expect(res._status).toBe(200);
    expect(res._body.mission.Title).toBe('Count foot traffic at Whole Foods');
  });

  it('returns 400 when missionId is missing', async () => {
    const res = await call({ action: 'getMission' });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/missionId/i);
  });
});

// ── createMission ─────────────────────────────────────────────────────────────

describe('action: createMission', () => {
  const validMission = {
    title: 'Count foot traffic at Starbucks',
    location: '789 Oak Ave',
    type: 'standard',
    rewardCents: 750,
    durationMinutes: 60,
  };

  it('creates a mission with pending_approval status', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { records: [airtableRecord('rec_new_m', { Status: 'pending_approval' })] },
    ]));
    const res = await call({
      action: 'createMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      mission: validMission,
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.missionId).toBe('rec_new_m');
  });

  it('returns 400 for an invalid mission payload', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([ADMIN_USER])));
    const res = await call({
      action: 'createMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      mission: { ...validMission, rewardCents: 50 }, // below minimum
    });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/minimum 100/i);
  });

  it('returns 403 for non-admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({
      action: 'createMission',
      adminUsername: 'spotter01',
      adminPin: '1234',
      mission: validMission,
    });
    expect(res._status).toBe(403);
  });
});

// ── approveMission / rejectMission ────────────────────────────────────────────

describe('action: approveMission', () => {
  it('sets status to open for a valid admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_m_std', fields: { Status: 'open' } },
    ]));
    const res = await call({ action: 'approveMission', adminUsername: 'adminuser', adminPin: 'admin99', missionId: 'rec_m_std' });
    expect(res._status).toBe(200);
  });

  it('returns 400 when missionId is missing', async () => {
    const res = await call({ action: 'approveMission', adminUsername: 'adminuser', adminPin: 'admin99' });
    expect(res._status).toBe(400);
  });
});

describe('action: rejectMission', () => {
  it('sets status to rejected with a reason', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_m_std', fields: { Status: 'rejected' } },
    ]));
    const res = await call({
      action: 'rejectMission',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId: 'rec_m_std',
      reason: 'Location is too vague',
    });
    expect(res._status).toBe(200);
  });
});

// ── claimMission ──────────────────────────────────────────────────────────────

describe('action: claimMission', () => {
  it('level-1 spotter can claim a standard mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),                         // getUser
      { id: 'rec_m_std', fields: STANDARD_MISSION.fields },  // atGetOne
      { id: 'rec_m_std', fields: { Status: 'claimed' } },    // atUpdate
    ]));
    const res = await call({ action: 'claimMission', username: 'spotter01', pin: '1234', missionId: 'rec_m_std' });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('level-1 spotter cannot claim an advanced mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),
      { id: 'rec_m_adv', fields: ADVANCED_MISSION.fields },
    ]));
    const res = await call({ action: 'claimMission', username: 'spotter01', pin: '1234', missionId: 'rec_m_adv' });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/level/i);
  });

  it('level-3 spotter can claim an advanced mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL3]),
      { id: 'rec_m_adv', fields: ADVANCED_MISSION.fields },
      { id: 'rec_m_adv', fields: { Status: 'claimed' } },
    ]));
    const res = await call({ action: 'claimMission', username: 'scout99', pin: '7890', missionId: 'rec_m_adv' });
    expect(res._status).toBe(200);
  });

  it('returns 409 when mission is already claimed', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),
      { id: 'rec_m_claimed', fields: CLAIMED_MISSION.fields },
    ]));
    const res = await call({ action: 'claimMission', username: 'spotter01', pin: '1234', missionId: 'rec_m_claimed' });
    expect(res._status).toBe(409);
    expect(res._body.error).toMatch(/no longer available/i);
  });

  it('returns 401 for wrong PIN', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([SPOTTER_LEVEL1])));
    const res = await call({ action: 'claimMission', username: 'spotter01', pin: 'wrong', missionId: 'rec_m_std' });
    expect(res._status).toBe(401);
  });
});

// ── submitMission ─────────────────────────────────────────────────────────────

describe('action: submitMission', () => {
  const observations = [
    { timestamp: '2026-04-01T10:00:00Z', customerCount: 15 },
    { timestamp: '2026-04-01T10:15:00Z', customerCount: 9 },
    { timestamp: '2026-04-01T10:30:00Z', customerCount: 22 },
  ];

  it('submits observations for a claimed mission', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),          // getUser
      { id: 'rec_m_claimed', fields: CLAIMED_MISSION.fields }, // atGetOne
      { id: 'rec_m_claimed', fields: { Status: 'submitted' } }, // atUpdate
    ]));
    const res = await call({
      action: 'submitMission',
      username: 'spotter01',
      pin: '1234',
      missionId: 'rec_m_claimed',
      observations,
    });
    expect(res._status).toBe(200);
    expect(res._body.observationCount).toBe(3);
  });

  it('returns 403 when spotter did not claim the mission', async () => {
    const otherClaimedMission = airtableRecord('rec_m_other', {
      ...CLAIMED_MISSION.fields,
      ClaimedBy: 'someoneelse',
    });
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),
      { id: 'rec_m_other', fields: otherClaimedMission.fields },
    ]));
    const res = await call({
      action: 'submitMission',
      username: 'spotter01',
      pin: '1234',
      missionId: 'rec_m_other',
      observations,
    });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/did not claim/i);
  });

  it('returns 400 for observations with missing timestamps', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([SPOTTER_LEVEL1])));
    const res = await call({
      action: 'submitMission',
      username: 'spotter01',
      pin: '1234',
      missionId: 'rec_m_claimed',
      observations: [{ customerCount: 5 }], // no timestamp
    });
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/timestamp/i);
  });

  it('returns 409 when mission is not in claimed status', async () => {
    const submittedMission = airtableRecord('rec_m_submitted', {
      ...CLAIMED_MISSION.fields,
      Status: 'submitted',
    });
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([SPOTTER_LEVEL1]),
      { id: 'rec_m_submitted', fields: submittedMission.fields },
    ]));
    const res = await call({
      action: 'submitMission',
      username: 'spotter01',
      pin: '1234',
      missionId: 'rec_m_submitted',
      observations,
    });
    expect(res._status).toBe(409);
  });
});

// ── approveMissionData ────────────────────────────────────────────────────────

describe('action: approveMissionData', () => {
  const submittedMission = airtableRecord('rec_m_sub', {
    Title: 'Foot traffic count',
    Status: 'submitted',
    ClaimedBy: 'spotter01',
    ObservationData: '[]',
  });

  it('approves mission data and increments spotter completed count', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),               // verifyAdmin
      { id: 'rec_m_sub', fields: submittedMission.fields }, // atGetOne mission
      { id: 'rec_m_sub', fields: { Status: 'approved' } },  // atUpdate mission
      airtableList([SPOTTER_LEVEL1]),           // getUser (spotter)
      { id: SPOTTER_LEVEL1.id, fields: { CompletedMissions: 1 } }, // atUpdate user
    ]));
    const res = await call({
      action: 'approveMissionData',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId: 'rec_m_sub',
    });
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('returns 409 when mission is not in submitted status', async () => {
    vi.stubGlobal('fetch', makeFetchMock([
      airtableList([ADMIN_USER]),
      { id: 'rec_m_std', fields: STANDARD_MISSION.fields }, // status = 'open', not 'submitted'
    ]));
    const res = await call({
      action: 'approveMissionData',
      adminUsername: 'adminuser',
      adminPin: 'admin99',
      missionId: 'rec_m_std',
    });
    expect(res._status).toBe(409);
    expect(res._body.error).toMatch(/not been submitted/i);
  });

  it('returns 403 for non-admin', async () => {
    vi.stubGlobal('fetch', makeFetchMock(airtableList([])));
    const res = await call({
      action: 'approveMissionData',
      adminUsername: 'hacker',
      adminPin: '0000',
      missionId: 'rec_m_sub',
    });
    expect(res._status).toBe(403);
  });
});
