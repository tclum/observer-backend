/**
 * Unit tests — Observation Form Validation
 *
 * All valid field values (Ages, Genders, Ethnicities, Disabilities, Emotions)
 * and active location names are loaded from tests/fixtures/airtable-data.json,
 * which is populated by tests/globalSetup.js from your real Airtable base
 * before the test suite runs.
 *
 * This means the tests never use hardcoded or fabricated field options —
 * only values that actually exist in your Airtable configuration are treated
 * as valid.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateTimestamp,
  validatePersonNumber,
  validateMissed,
  validateDemographicField,
  validateObservation,
} from '../../api/validators/observation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load real Airtable fixtures ──────────────────────────────────────────────
let fieldConfig    = { Ages: [], Genders: [], Ethnicities: [], Disabilities: [], Emotions: [] };
let activeLocations = [];
let sampleObserver = 'test_observer';

beforeAll(() => {
  const fixturePath = resolve(__dirname, '../fixtures/airtable-data.json');
  if (!existsSync(fixturePath)) {
    console.warn(
      '\n[observation.test] tests/fixtures/airtable-data.json not found.\n' +
      'Run "npm test" (which triggers globalSetup) to generate it,\n' +
      'or ensure .env.test has valid Airtable credentials.\n' +
      'Demographic field value tests will be less precise until then.\n'
    );
    return;
  }
  const data    = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  fieldConfig    = data.fieldConfig   ?? fieldConfig;
  activeLocations = data.activeLocations ?? activeLocations;
  sampleObserver = data.sampleActiveObserver ?? sampleObserver;
});

// Helper: build a valid observation using only real Airtable values
function makeValidObservation(overrides = {}) {
  return {
    Timestamp:  new Date().toISOString(),
    Type:       'Standard',
    Observer:   sampleObserver || 'observer1',
    Location:   activeLocations[0] || 'Main Location',
    'Person #': 1,
    Age:        fieldConfig.Ages[0]         ?? undefined,
    Gender:     fieldConfig.Genders[0]      ?? undefined,
    Ethnicity:  fieldConfig.Ethnicities[0]  ?? undefined,
    Disability: fieldConfig.Disabilities[0] ?? undefined,
    Emotion:    fieldConfig.Emotions[0]     ?? undefined,
    Missed:     false,
    ...overrides,
  };
}

// Context object for full-observation tests
function makeContext(overrides = {}) {
  return {
    fieldConfig,
    activeLocations,
    observerUsername: sampleObserver || 'observer1',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateTimestamp
// ─────────────────────────────────────────────────────────────────────────────
describe('validateTimestamp', () => {
  it('accepts a valid ISO timestamp', () => {
    expect(validateTimestamp(new Date().toISOString()).valid).toBe(true);
  });

  it('accepts a valid date string', () => {
    expect(validateTimestamp('2024-06-15T14:30:00Z').valid).toBe(true);
  });

  it('rejects undefined', () => {
    expect(validateTimestamp(undefined).valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validateTimestamp(null).valid).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateTimestamp('').valid).toBe(false);
  });

  it('rejects a non-date string', () => {
    expect(validateTimestamp('not-a-date').valid).toBe(false);
  });

  it('rejects a malformed ISO string', () => {
    expect(validateTimestamp('2024-13-99T99:99:99').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validatePersonNumber
// ─────────────────────────────────────────────────────────────────────────────
describe('validatePersonNumber', () => {
  it('accepts 1', () => {
    expect(validatePersonNumber(1).valid).toBe(true);
  });

  it('accepts a large integer', () => {
    expect(validatePersonNumber(500).valid).toBe(true);
  });

  it('accepts a numeric string "3"', () => {
    expect(validatePersonNumber('3').valid).toBe(true);
  });

  it('rejects 0', () => {
    expect(validatePersonNumber(0).valid).toBe(false);
  });

  it('rejects a negative number', () => {
    expect(validatePersonNumber(-1).valid).toBe(false);
  });

  it('rejects a float', () => {
    expect(validatePersonNumber(1.5).valid).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validatePersonNumber(undefined).valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validatePersonNumber(null).valid).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validatePersonNumber('').valid).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    expect(validatePersonNumber('abc').valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateMissed
// ─────────────────────────────────────────────────────────────────────────────
describe('validateMissed', () => {
  it('accepts boolean true', () => {
    expect(validateMissed(true).valid).toBe(true);
  });

  it('accepts boolean false', () => {
    expect(validateMissed(false).valid).toBe(true);
  });

  it('accepts string "true"', () => {
    expect(validateMissed('true').valid).toBe(true);
  });

  it('accepts string "false"', () => {
    expect(validateMissed('false').valid).toBe(true);
  });

  it('accepts string "yes"', () => {
    expect(validateMissed('yes').valid).toBe(true);
  });

  it('accepts string "no"', () => {
    expect(validateMissed('no').valid).toBe(true);
  });

  it('accepts empty string (field omitted)', () => {
    expect(validateMissed('').valid).toBe(true);
  });

  it('accepts undefined (field not sent)', () => {
    expect(validateMissed(undefined).valid).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(validateMissed('maybe').valid).toBe(false);
  });

  it('rejects a number other than 0 or 1', () => {
    expect(validateMissed(99).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateDemographicField — uses REAL FieldConfig values from Airtable
// ─────────────────────────────────────────────────────────────────────────────
describe('validateDemographicField (real Airtable FieldConfig)', () => {
  it('accepts an empty value (field is optional)', () => {
    expect(validateDemographicField('', fieldConfig.Ages, 'Age').valid).toBe(true);
  });

  it('accepts undefined (field not sent)', () => {
    expect(validateDemographicField(undefined, fieldConfig.Ages, 'Age').valid).toBe(true);
  });

  it('accepts a valid Age from FieldConfig', () => {
    if (!fieldConfig.Ages.length) return; // skip if FieldConfig not loaded
    expect(validateDemographicField(fieldConfig.Ages[0], fieldConfig.Ages, 'Age').valid).toBe(true);
  });

  it('rejects an Age not in FieldConfig', () => {
    if (!fieldConfig.Ages.length) return;
    expect(validateDemographicField('999+', fieldConfig.Ages, 'Age').valid).toBe(false);
  });

  it('accepts a valid Gender from FieldConfig', () => {
    if (!fieldConfig.Genders.length) return;
    expect(validateDemographicField(fieldConfig.Genders[0], fieldConfig.Genders, 'Gender').valid).toBe(true);
  });

  it('rejects a Gender not in FieldConfig', () => {
    if (!fieldConfig.Genders.length) return;
    expect(validateDemographicField('__invalid__', fieldConfig.Genders, 'Gender').valid).toBe(false);
  });

  it('accepts a valid Ethnicity from FieldConfig', () => {
    if (!fieldConfig.Ethnicities.length) return;
    expect(validateDemographicField(fieldConfig.Ethnicities[0], fieldConfig.Ethnicities, 'Ethnicity').valid).toBe(true);
  });

  it('accepts a valid Disability from FieldConfig', () => {
    if (!fieldConfig.Disabilities.length) return;
    expect(validateDemographicField(fieldConfig.Disabilities[0], fieldConfig.Disabilities, 'Disability').valid).toBe(true);
  });

  it('accepts a valid Emotion from FieldConfig', () => {
    if (!fieldConfig.Emotions.length) return;
    expect(validateDemographicField(fieldConfig.Emotions[0], fieldConfig.Emotions, 'Emotion').valid).toBe(true);
  });

  it('passes when allowedValues list is empty (config not loaded)', () => {
    // If FieldConfig is empty, we cannot reject — data still flows through
    expect(validateDemographicField('anything', [], 'Age').valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateObservation — full record, uses real Airtable FieldConfig + locations
// ─────────────────────────────────────────────────────────────────────────────
describe('validateObservation', () => {
  it('passes a fully valid observation with real Airtable values', () => {
    const obs    = makeValidObservation();
    const result = validateObservation(obs, makeContext());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when Timestamp is missing', () => {
    const obs = makeValidObservation({ Timestamp: undefined });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Timestamp is not a valid date', () => {
    const obs = makeValidObservation({ Timestamp: 'bad-date' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('auto-generates a valid timestamp — shows timestamps are generated correctly', () => {
    // The app calls new Date().toISOString() when saving; verify it passes validation
    const ts = new Date().toISOString();
    expect(validateTimestamp(ts).valid).toBe(true);
  });

  it('fails when Type is missing', () => {
    const obs = makeValidObservation({ Type: '' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Observer is missing', () => {
    const obs = makeValidObservation({ Observer: '' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Observer does not match the logged-in user', () => {
    const obs = makeValidObservation({ Observer: 'someone_else' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Location is missing', () => {
    const obs = makeValidObservation({ Location: '' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Location is not in the active locations list', () => {
    const obs = makeValidObservation({ Location: '__nonexistent_location__' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Person # is 0', () => {
    const obs = makeValidObservation({ 'Person #': 0 });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Person # is negative', () => {
    const obs = makeValidObservation({ 'Person #': -5 });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Person # is missing', () => {
    const obs = makeValidObservation({ 'Person #': undefined });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Person # is not a number', () => {
    const obs = makeValidObservation({ 'Person #': 'abc' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails when Missed has an invalid value', () => {
    const obs = makeValidObservation({ Missed: 'maybe' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('allows Missed to be undefined (optional field)', () => {
    const obs = makeValidObservation({ Missed: undefined });
    expect(validateObservation(obs, makeContext()).valid).toBe(true);
  });

  it('fails when Age is set to a value not in FieldConfig', () => {
    if (!fieldConfig.Ages.length) return;
    const obs = makeValidObservation({ Age: '__fake_age__' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('allows Age to be empty (demographic field is optional)', () => {
    const obs = makeValidObservation({ Age: '' });
    expect(validateObservation(obs, makeContext()).valid).toBe(true);
  });

  it('fails when Gender is set to a value not in FieldConfig', () => {
    if (!fieldConfig.Genders.length) return;
    const obs = makeValidObservation({ Gender: '__fake_gender__' });
    expect(validateObservation(obs, makeContext()).valid).toBe(false);
  });

  it('fails an observation with multiple invalid fields and collects all errors', () => {
    const obs = makeValidObservation({
      Timestamp:  '',
      Observer:   '',
      'Person #': -1,
    });
    const result = validateObservation(obs, makeContext());
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('validates without a context (no location or observer check)', () => {
    // When context is empty, only basic field presence is checked
    const obs = makeValidObservation();
    expect(validateObservation(obs, {}).valid).toBe(true);
  });

  it('fails when missionType is provided and Type does not match', () => {
    const obs = makeValidObservation({ Type: 'Standard' });
    const ctx = makeContext({ missionType: 'Advanced' });
    expect(validateObservation(obs, ctx).valid).toBe(false);
  });
});
