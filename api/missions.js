/**
 * api/missions.js
 *
 * Missions pipeline for Spottly.
 *
 * Actions (all via POST):
 *   listMissions        — public; returns open missions filtered by spotter level
 *   getMission          — public; returns one mission by id
 *   createMission       — admin only; creates a new mission (status: pending_approval)
 *   approveMission      — admin only; sets status to open so spotters can claim it
 *   rejectMission       — admin only; sets status to rejected with a reason
 *   claimMission        — spotter; claim an open mission (sets status: claimed)
 *   submitMission       — spotter; submit completed observations (sets status: submitted)
 *   approveMissionData  — admin only; mark submitted mission as approved, increment spotter count
 */

import {
  validateMissionCreate,
  validateMissionSubmission,
  canClaimMission,
  computeSpotterLevel,
  MISSION_STATUSES,
} from '../lib/validation.js';

const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = () => ({
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
});

// ── Airtable helpers ──────────────────────────────────────────────────────────

async function atGet(table, formula) {
  const qs = formula ? `?filterByFormula=${encodeURIComponent(formula)}` : '';
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}${qs}`, { headers: HEADERS() });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

async function atGetOne(table, id) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, { headers: HEADERS() });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

async function atCreate(table, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

async function atUpdate(table, id, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'PATCH', headers: HEADERS(),
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

async function verifyAdmin(username, pin) {
  const data = await atGet('Users', `AND({Username}="${username}",{Role}="Admin")`);
  return data.records.length > 0 && data.records[0].fields.PIN === pin;
}

async function getUser(username) {
  const data = await atGet('Users', `{Username}="${username}"`);
  return data.records[0] ?? null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── LIST MISSIONS ──
    if (action === 'listMissions') {
      const { spotterLevel = 1, status = 'open' } = req.body;
      const formula = status
        ? `{Status}="${status}"`
        : 'NOT({Status}="")';
      const data = await atGet('Missions', formula);
      const missions = data.records
        .map(r => ({ id: r.id, ...r.fields }))
        .filter(m => canClaimMission(spotterLevel, m.Type));
      return res.status(200).json({ success: true, missions });
    }

    // ── GET MISSION ──
    if (action === 'getMission') {
      const { missionId } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId is required' });
      const record = await atGetOne('Missions', missionId);
      return res.status(200).json({ success: true, mission: { id: record.id, ...record.fields } });
    }

    // ── CREATE MISSION (admin) ──
    if (action === 'createMission') {
      const { adminUsername, adminPin, mission } = req.body;
      const isAdmin = await verifyAdmin(adminUsername, adminPin);
      if (!isAdmin) return res.status(403).json({ error: 'Admin credentials required' });

      const validation = validateMissionCreate(mission ?? {});
      if (!validation.valid) return res.status(400).json({ error: validation.error });

      const result = await atCreate('Missions', {
        Title:            mission.title,
        Location:         mission.location,
        Type:             mission.type,
        RewardCents:      mission.rewardCents,
        DurationMinutes:  mission.durationMinutes,
        Status:           'pending_approval',
        Instructions:     mission.instructions ?? '',
        CreatedAt:        new Date().toISOString(),
      });
      return res.status(200).json({ success: true, missionId: result.records[0].id });
    }

    // ── APPROVE MISSION (admin) ──
    if (action === 'approveMission') {
      const { adminUsername, adminPin, missionId } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId is required' });
      const isAdmin = await verifyAdmin(adminUsername, adminPin);
      if (!isAdmin) return res.status(403).json({ error: 'Admin credentials required' });
      await atUpdate('Missions', missionId, { Status: 'open' });
      return res.status(200).json({ success: true });
    }

    // ── REJECT MISSION (admin) ──
    if (action === 'rejectMission') {
      const { adminUsername, adminPin, missionId, reason } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId is required' });
      const isAdmin = await verifyAdmin(adminUsername, adminPin);
      if (!isAdmin) return res.status(403).json({ error: 'Admin credentials required' });
      await atUpdate('Missions', missionId, { Status: 'rejected', RejectionReason: reason ?? '' });
      return res.status(200).json({ success: true });
    }

    // ── CLAIM MISSION (spotter) ──
    if (action === 'claimMission') {
      const { username, pin, missionId } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId is required' });

      const userRecord = await getUser(username);
      if (!userRecord || userRecord.fields.PIN !== pin) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (userRecord.fields.Status !== 'Active') {
        return res.status(403).json({ error: 'Account not active' });
      }

      const completed = userRecord.fields.CompletedMissions ?? 0;
      const { level } = computeSpotterLevel(completed);

      const missionRecord = await atGetOne('Missions', missionId);
      const mission = missionRecord.fields;

      if (mission.Status !== 'open') {
        return res.status(409).json({ error: 'Mission is no longer available' });
      }
      if (!canClaimMission(level, mission.Type)) {
        return res.status(403).json({ error: `Your level (${level}) cannot claim ${mission.Type} missions` });
      }

      await atUpdate('Missions', missionId, {
        Status: 'claimed',
        ClaimedBy: username,
        ClaimedAt: new Date().toISOString(),
      });
      return res.status(200).json({ success: true });
    }

    // ── SUBMIT MISSION (spotter) ──
    if (action === 'submitMission') {
      const { username, pin, missionId, observations } = req.body;

      const userRecord = await getUser(username);
      if (!userRecord || userRecord.fields.PIN !== pin) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const validation = validateMissionSubmission({ missionId, spotterId: username, observations });
      if (!validation.valid) return res.status(400).json({ error: validation.error });

      const missionRecord = await atGetOne('Missions', missionId);
      if (missionRecord.fields.ClaimedBy !== username) {
        return res.status(403).json({ error: 'You did not claim this mission' });
      }
      if (missionRecord.fields.Status !== 'claimed') {
        return res.status(409).json({ error: 'Mission is not in claimed status' });
      }

      await atUpdate('Missions', missionId, {
        Status: 'submitted',
        SubmittedAt: new Date().toISOString(),
        ObservationData: JSON.stringify(observations),
      });
      return res.status(200).json({ success: true, observationCount: observations.length });
    }

    // ── APPROVE MISSION DATA (admin) ──
    if (action === 'approveMissionData') {
      const { adminUsername, adminPin, missionId } = req.body;
      if (!missionId) return res.status(400).json({ error: 'missionId is required' });
      const isAdmin = await verifyAdmin(adminUsername, adminPin);
      if (!isAdmin) return res.status(403).json({ error: 'Admin credentials required' });

      const missionRecord = await atGetOne('Missions', missionId);
      const mission = missionRecord.fields;

      if (mission.Status !== 'submitted') {
        return res.status(409).json({ error: 'Mission data has not been submitted yet' });
      }

      // Approve the mission
      await atUpdate('Missions', missionId, { Status: 'approved', ApprovedAt: new Date().toISOString() });

      // Increment spotter's completed count
      const spotterRecord = await getUser(mission.ClaimedBy);
      if (spotterRecord) {
        const current = spotterRecord.fields.CompletedMissions ?? 0;
        await atUpdate('Users', spotterRecord.id, { CompletedMissions: current + 1 });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
