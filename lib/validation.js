/**
 * lib/validation.js
 *
 * Pure validation functions with zero side-effects.
 * Each function returns { valid: true } or { valid: false, error: string }.
 * Being pure makes them trivially unit-testable without any mocking.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const MISSION_TYPES   = ['standard', 'advanced'];
export const MISSION_STATUSES = ['pending_approval', 'open', 'claimed', 'submitted', 'approved', 'rejected'];
export const USER_ROLES      = ['Observer', 'Admin'];
export const USER_STATUSES   = ['Pending', 'Active', 'Suspended'];

export const SPOTTER_LEVELS = {
  1: { label: 'Rookie',    minCompleted: 0,  maxMissionType: 'standard' },
  2: { label: 'Field Op',  minCompleted: 5,  maxMissionType: 'standard' },
  3: { label: 'Scout',     minCompleted: 15, maxMissionType: 'advanced' },
  4: { label: 'Analyst',   minCompleted: 30, maxMissionType: 'advanced' },
  5: { label: 'Elite',     minCompleted: 60, maxMissionType: 'advanced' },
};

// ── User validation ───────────────────────────────────────────────────────────

/**
 * Validate registration fields.
 */
export function validateRegistration({ username, pin, name } = {}) {
  if (!username || !pin || !name) {
    return { valid: false, error: 'All fields required' };
  }
  if (typeof username !== 'string' || username.trim().length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { valid: false, error: 'Username may only contain letters, numbers, underscores, and hyphens' };
  }
  if (String(pin).length < 4) {
    return { valid: false, error: 'PIN must be at least 4 digits' };
  }
  if (!/^\d+$/.test(String(pin))) {
    return { valid: false, error: 'PIN must contain digits only' };
  }
  if (typeof name !== 'string' || name.trim().length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }
  return { valid: true };
}

/**
 * Validate login credentials shape (not correctness — that's Airtable's job).
 */
export function validateLoginInput({ username, pin } = {}) {
  if (!username || !pin) return { valid: false, error: 'Missing credentials' };
  return { valid: true };
}

// ── Mission validation ────────────────────────────────────────────────────────

/**
 * Validate a mission creation payload.
 */
export function validateMissionCreate({ title, location, type, rewardCents, durationMinutes } = {}) {
  if (!title || typeof title !== 'string' || title.trim().length < 5) {
    return { valid: false, error: 'Mission title must be at least 5 characters' };
  }
  if (!location || typeof location !== 'string' || location.trim().length < 3) {
    return { valid: false, error: 'Mission location is required' };
  }
  if (!MISSION_TYPES.includes(type)) {
    return { valid: false, error: `Mission type must be one of: ${MISSION_TYPES.join(', ')}` };
  }
  if (!Number.isInteger(rewardCents) || rewardCents < 100) {
    return { valid: false, error: 'Reward must be a whole number of cents, minimum 100 (= $1.00)' };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return { valid: false, error: 'Duration must be between 15 and 480 minutes' };
  }
  return { valid: true };
}

/**
 * Validate a mission submission payload.
 */
export function validateMissionSubmission({ missionId, spotterId, observations } = {}) {
  if (!missionId || typeof missionId !== 'string') {
    return { valid: false, error: 'missionId is required' };
  }
  if (!spotterId || typeof spotterId !== 'string') {
    return { valid: false, error: 'spotterId is required' };
  }
  if (!Array.isArray(observations) || observations.length === 0) {
    return { valid: false, error: 'observations must be a non-empty array' };
  }
  for (const [i, obs] of observations.entries()) {
    if (typeof obs.timestamp !== 'string' || !obs.timestamp) {
      return { valid: false, error: `observations[${i}]: timestamp is required` };
    }
    if (!Number.isInteger(obs.customerCount) || obs.customerCount < 0) {
      return { valid: false, error: `observations[${i}]: customerCount must be a non-negative integer` };
    }
  }
  return { valid: true };
}

// ── Spotter level helpers ─────────────────────────────────────────────────────

/**
 * Compute spotter level from completed mission count.
 * @param {number} completedCount
 * @returns {{ level: number, label: string, nextLevelAt: number|null }}
 */
export function computeSpotterLevel(completedCount) {
  const levels = Object.entries(SPOTTER_LEVELS)
    .map(([lvl, cfg]) => ({ level: Number(lvl), ...cfg }))
    .sort((a, b) => b.minCompleted - a.minCompleted);

  const current = levels.find(l => completedCount >= l.minCompleted) ?? SPOTTER_LEVELS[1];
  const nextEntry = Object.entries(SPOTTER_LEVELS)
    .map(([lvl, cfg]) => ({ level: Number(lvl), ...cfg }))
    .find(l => l.level === current.level + 1) ?? null;

  return {
    level: current.level,
    label: current.label,
    maxMissionType: current.maxMissionType,
    nextLevelAt: nextEntry ? nextEntry.minCompleted : null,
  };
}

/**
 * Check whether a spotter at a given level can claim a specific mission type.
 * @param {number} spotterLevel
 * @param {'standard'|'advanced'} missionType
 * @returns {boolean}
 */
export function canClaimMission(spotterLevel, missionType) {
  const cfg = SPOTTER_LEVELS[spotterLevel];
  if (!cfg) return false;
  if (missionType === 'standard') return true;
  if (missionType === 'advanced') return cfg.maxMissionType === 'advanced';
  return false;
}

// ── Sync record validation ────────────────────────────────────────────────────

/**
 * Validate the records array sent to /api/sync.
 */
export function validateSyncRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { valid: false, error: 'No records provided.' };
  }
  for (const [i, record] of records.entries()) {
    if (!record || typeof record !== 'object' || !record.fields) {
      return { valid: false, error: `Record at index ${i} must have a fields object` };
    }
  }
  return { valid: true };
}
