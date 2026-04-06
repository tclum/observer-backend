/**
 * tests/unit/validation.test.js
 *
 * Tests for lib/validation.js.
 * These are pure-function tests — no mocking needed at all.
 */

import { describe, it, expect } from 'vitest';
import {
  validateRegistration,
  validateLoginInput,
  validateMissionCreate,
  validateMissionSubmission,
  validateSyncRecords,
  computeSpotterLevel,
  canClaimMission,
} from '../../lib/validation.js';

// ── validateRegistration ──────────────────────────────────────────────────────

describe('validateRegistration', () => {
  const valid = { username: 'scout99', pin: '1234', name: 'Scout Ninenine' };

  it('passes for valid input', () => {
    expect(validateRegistration(valid).valid).toBe(true);
  });

  it('fails when any field is missing', () => {
    expect(validateRegistration({ username: 'x', pin: '1234' }).valid).toBe(false);
    expect(validateRegistration({ pin: '1234', name: 'Bob' }).valid).toBe(false);
    expect(validateRegistration({}).valid).toBe(false);
  });

  it('fails when username is shorter than 3 chars', () => {
    const r = validateRegistration({ ...valid, username: 'ab' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at least 3/i);
  });

  it('fails when username contains special characters', () => {
    const r = validateRegistration({ ...valid, username: 'bad username!' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/letters, numbers/i);
  });

  it('allows underscores and hyphens in username', () => {
    expect(validateRegistration({ ...valid, username: 'scout_99' }).valid).toBe(true);
    expect(validateRegistration({ ...valid, username: 'scout-99' }).valid).toBe(true);
  });

  it('fails when PIN is shorter than 4 digits', () => {
    const r = validateRegistration({ ...valid, pin: '12' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/pin/i);
  });

  it('fails when PIN contains non-digits', () => {
    const r = validateRegistration({ ...valid, pin: 'abcd' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/digits only/i);
  });

  it('fails when name is shorter than 2 chars', () => {
    const r = validateRegistration({ ...valid, name: 'A' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at least 2/i);
  });
});

// ── validateLoginInput ────────────────────────────────────────────────────────

describe('validateLoginInput', () => {
  it('passes with username and pin', () => {
    expect(validateLoginInput({ username: 'u', pin: '1234' }).valid).toBe(true);
  });

  it('fails when either is missing', () => {
    expect(validateLoginInput({ username: 'u' }).valid).toBe(false);
    expect(validateLoginInput({ pin: '1234' }).valid).toBe(false);
    expect(validateLoginInput({}).valid).toBe(false);
  });
});

// ── validateMissionCreate ─────────────────────────────────────────────────────

describe('validateMissionCreate', () => {
  const validMission = {
    title: 'Count customers at Starbucks',
    location: '123 Main St',
    type: 'standard',
    rewardCents: 500,
    durationMinutes: 60,
  };

  it('passes for a valid standard mission', () => {
    expect(validateMissionCreate(validMission).valid).toBe(true);
  });

  it('passes for a valid advanced mission', () => {
    expect(validateMissionCreate({ ...validMission, type: 'advanced', rewardCents: 1200 }).valid).toBe(true);
  });

  it('fails when title is too short', () => {
    const r = validateMissionCreate({ ...validMission, title: 'Hi' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/title/i);
  });

  it('fails when type is invalid', () => {
    const r = validateMissionCreate({ ...validMission, type: 'elite' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/type must be one of/i);
  });

  it('fails when reward is below minimum ($1.00 = 100 cents)', () => {
    const r = validateMissionCreate({ ...validMission, rewardCents: 50 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/minimum 100/i);
  });

  it('fails when reward is a float', () => {
    const r = validateMissionCreate({ ...validMission, rewardCents: 5.50 });
    expect(r.valid).toBe(false);
  });

  it('fails when duration is below 15 minutes', () => {
    const r = validateMissionCreate({ ...validMission, durationMinutes: 10 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/duration/i);
  });

  it('fails when duration exceeds 8 hours (480 min)', () => {
    const r = validateMissionCreate({ ...validMission, durationMinutes: 500 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/duration/i);
  });

  it('fails when location is missing', () => {
    const r = validateMissionCreate({ ...validMission, location: '' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/location/i);
  });
});

// ── validateMissionSubmission ─────────────────────────────────────────────────

describe('validateMissionSubmission', () => {
  const validObs = [
    { timestamp: '2026-04-01T09:00:00Z', customerCount: 12 },
    { timestamp: '2026-04-01T09:15:00Z', customerCount: 8 },
  ];
  const validInput = { missionId: 'rec_m1', spotterId: 'scout99', observations: validObs };

  it('passes for valid input', () => {
    expect(validateMissionSubmission(validInput).valid).toBe(true);
  });

  it('fails when missionId is missing', () => {
    const r = validateMissionSubmission({ ...validInput, missionId: '' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/missionId/i);
  });

  it('fails when spotterId is missing', () => {
    const r = validateMissionSubmission({ ...validInput, spotterId: '' });
    expect(r.valid).toBe(false);
  });

  it('fails when observations is empty', () => {
    const r = validateMissionSubmission({ ...validInput, observations: [] });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/non-empty array/i);
  });

  it('fails when an observation is missing a timestamp', () => {
    const r = validateMissionSubmission({
      ...validInput,
      observations: [{ customerCount: 5 }],
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/timestamp/i);
  });

  it('fails when customerCount is negative', () => {
    const r = validateMissionSubmission({
      ...validInput,
      observations: [{ timestamp: '2026-04-01T09:00:00Z', customerCount: -1 }],
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/customerCount/i);
  });

  it('fails when customerCount is a float', () => {
    const r = validateMissionSubmission({
      ...validInput,
      observations: [{ timestamp: '2026-04-01T09:00:00Z', customerCount: 3.5 }],
    });
    expect(r.valid).toBe(false);
  });
});

// ── validateSyncRecords ───────────────────────────────────────────────────────

describe('validateSyncRecords', () => {
  it('passes for a valid records array', () => {
    const r = validateSyncRecords([{ fields: { Count: 5 } }]);
    expect(r.valid).toBe(true);
  });

  it('fails for an empty array', () => {
    expect(validateSyncRecords([]).valid).toBe(false);
  });

  it('fails for a non-array', () => {
    expect(validateSyncRecords('oops').valid).toBe(false);
    expect(validateSyncRecords(null).valid).toBe(false);
  });

  it('fails when a record has no fields property', () => {
    const r = validateSyncRecords([{ Count: 5 }]); // missing .fields
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/index 0/i);
  });
});

// ── computeSpotterLevel ───────────────────────────────────────────────────────

describe('computeSpotterLevel', () => {
  it('returns level 1 (Rookie) for a new spotter with 0 missions', () => {
    const result = computeSpotterLevel(0);
    expect(result.level).toBe(1);
    expect(result.label).toBe('Rookie');
    expect(result.nextLevelAt).toBe(5);
  });

  it('returns level 2 (Field Op) at exactly 5 completed', () => {
    const result = computeSpotterLevel(5);
    expect(result.level).toBe(2);
    expect(result.label).toBe('Field Op');
    expect(result.nextLevelAt).toBe(15);
  });

  it('returns level 3 (Scout) at 15 completed', () => {
    expect(computeSpotterLevel(15).level).toBe(3);
  });

  it('returns level 4 (Analyst) at 30 completed', () => {
    expect(computeSpotterLevel(30).level).toBe(4);
  });

  it('returns level 5 (Elite) at 60+ completed', () => {
    const result = computeSpotterLevel(60);
    expect(result.level).toBe(5);
    expect(result.label).toBe('Elite');
    expect(result.nextLevelAt).toBeNull(); // max level
  });

  it('stays at current level between thresholds', () => {
    expect(computeSpotterLevel(7).level).toBe(2);
    expect(computeSpotterLevel(14).level).toBe(2);
    expect(computeSpotterLevel(29).level).toBe(3);
  });
});

// ── canClaimMission ───────────────────────────────────────────────────────────

describe('canClaimMission', () => {
  it('level 1 and 2 spotters can claim standard missions', () => {
    expect(canClaimMission(1, 'standard')).toBe(true);
    expect(canClaimMission(2, 'standard')).toBe(true);
  });

  it('level 1 and 2 spotters cannot claim advanced missions', () => {
    expect(canClaimMission(1, 'advanced')).toBe(false);
    expect(canClaimMission(2, 'advanced')).toBe(false);
  });

  it('level 3+ spotters can claim advanced missions', () => {
    expect(canClaimMission(3, 'advanced')).toBe(true);
    expect(canClaimMission(4, 'advanced')).toBe(true);
    expect(canClaimMission(5, 'advanced')).toBe(true);
  });

  it('all levels can claim standard missions', () => {
    [1, 2, 3, 4, 5].forEach(lvl => {
      expect(canClaimMission(lvl, 'standard')).toBe(true);
    });
  });

  it('returns false for an unknown level', () => {
    expect(canClaimMission(99, 'standard')).toBe(false);
  });

  it('returns false for an unknown mission type', () => {
    expect(canClaimMission(5, 'ultra')).toBe(false);
  });
});
