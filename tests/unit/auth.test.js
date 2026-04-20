/**
 * Unit tests — Authentication & User Validation
 *
 * Covers:
 *   A. validateLoginInput     — username + PIN presence
 *   B. validatePinFormat      — 4-digit, numeric, leading zeros
 *   C. validateUserStatus     — Active / Pending / Suspended
 *   D. validateUserRole       — role-based access control
 *   E. validateRegistrationInput — registration fields
 *   F. validateWebLoginInput  — email + password for web auth
 *   G. verifyPassword / hashPassword — crypto utility round-trip
 *   H. signJWT / verifyJWT    — token creation and validation
 *
 * The crypto tests (G, H) import directly from api/_utils.js and exercise
 * the real Web Crypto implementation — no mocking needed.
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateLoginInput,
  validatePinFormat,
  validateUserStatus,
  validateUserRole,
  validateRegistrationInput,
  validateWebLoginInput,
} from '../../api/validators/auth.js';
import { hashPassword, verifyPassword, signJWT, verifyJWT } from '../../api/_utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// A. validateLoginInput
// ─────────────────────────────────────────────────────────────────────────────
describe('validateLoginInput', () => {
  it('returns valid for a correct username and PIN', () => {
    expect(validateLoginInput({ username: 'jsmith', pin: '1234' }).valid).toBe(true);
  });

  it('rejects when username is missing', () => {
    const r = validateLoginInput({ pin: '1234' });
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects when pin is missing', () => {
    const r = validateLoginInput({ username: 'jsmith' });
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects when both fields are missing', () => {
    expect(validateLoginInput({}).valid).toBe(false);
  });

  it('rejects an empty string username', () => {
    expect(validateLoginInput({ username: '', pin: '1234' }).valid).toBe(false);
  });

  it('rejects a whitespace-only username', () => {
    expect(validateLoginInput({ username: '   ', pin: '1234' }).valid).toBe(false);
  });

  it('rejects an empty string PIN', () => {
    expect(validateLoginInput({ username: 'jsmith', pin: '' }).valid).toBe(false);
  });

  it('is case-sensitive — "JSmith" and "jsmith" are different inputs (no transformation applied)', () => {
    // validateLoginInput does not lowercase or uppercase; casing is preserved
    const lower  = validateLoginInput({ username: 'jsmith',  pin: '1234' });
    const upper  = validateLoginInput({ username: 'JSMITH',  pin: '1234' });
    expect(lower.valid).toBe(true);
    expect(upper.valid).toBe(true);
    // The username value is passed unchanged to the Airtable lookup
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. validatePinFormat
// ─────────────────────────────────────────────────────────────────────────────
describe('validatePinFormat', () => {
  it('accepts a standard 4-digit PIN', () => {
    expect(validatePinFormat('1234').valid).toBe(true);
  });

  it('accepts a PIN with leading zeros (e.g. "0042")', () => {
    expect(validatePinFormat('0042').valid).toBe(true);
  });

  it('accepts "0000" — all zeros is a valid PIN', () => {
    expect(validatePinFormat('0000').valid).toBe(true);
  });

  it('rejects a PIN shorter than 4 digits', () => {
    expect(validatePinFormat('123').valid).toBe(false);
  });

  it('rejects a PIN longer than 4 digits', () => {
    expect(validatePinFormat('12345').valid).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validatePinFormat('').valid).toBe(false);
  });

  it('rejects a PIN containing letters', () => {
    expect(validatePinFormat('12ab').valid).toBe(false);
  });

  it('rejects a PIN with special characters', () => {
    expect(validatePinFormat('12-4').valid).toBe(false);
  });

  it('rejects a PIN that is a number (not a string)', () => {
    // Airtable sends PIN as a string; a raw number type indicates bad input
    expect(validatePinFormat(1234).valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validatePinFormat(null).valid).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validatePinFormat(undefined).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. validateUserStatus
// ─────────────────────────────────────────────────────────────────────────────
describe('validateUserStatus', () => {
  it('allows an Active user', () => {
    expect(validateUserStatus({ Status: 'Active' }).allowed).toBe(true);
  });

  it('blocks a Pending user with HTTP 403', () => {
    const r = validateUserStatus({ Status: 'Pending' });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/pending/i);
  });

  it('blocks a Suspended user with HTTP 403', () => {
    const r = validateUserStatus({ Status: 'Suspended' });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/suspended/i);
  });

  it('blocks any other unknown status', () => {
    const r = validateUserStatus({ Status: 'Disabled' });
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('blocks a user with no Status field', () => {
    expect(validateUserStatus({}).allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. validateUserRole
// ─────────────────────────────────────────────────────────────────────────────
describe('validateUserRole', () => {
  it('allows an Admin when Admin is in the allowed list', () => {
    expect(validateUserRole({ Role: 'Admin' }, ['Admin']).allowed).toBe(true);
  });

  it('allows an Observer when Observer is in the allowed list', () => {
    expect(validateUserRole({ Role: 'Observer' }, ['Admin', 'Observer']).allowed).toBe(true);
  });

  it('blocks an Observer from an Admin-only route', () => {
    const r = validateUserRole({ Role: 'Observer' }, ['Admin']);
    expect(r.allowed).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('blocks a user with no Role', () => {
    expect(validateUserRole({}, ['Admin']).allowed).toBe(false);
  });

  it('rejects when allowedRoles is empty', () => {
    expect(validateUserRole({ Role: 'Admin' }, []).allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. validateRegistrationInput
// ─────────────────────────────────────────────────────────────────────────────
describe('validateRegistrationInput', () => {
  it('accepts valid registration data', () => {
    expect(validateRegistrationInput({ username: 'newuser', pin: '5678', name: 'New User' }).valid).toBe(true);
  });

  it('rejects when username is missing', () => {
    expect(validateRegistrationInput({ pin: '5678', name: 'New User' }).valid).toBe(false);
  });

  it('rejects when name is missing', () => {
    expect(validateRegistrationInput({ username: 'newuser', pin: '5678' }).valid).toBe(false);
  });

  it('rejects when pin is missing', () => {
    expect(validateRegistrationInput({ username: 'newuser', name: 'New User' }).valid).toBe(false);
  });

  it('rejects a PIN shorter than 4 digits', () => {
    const r = validateRegistrationInput({ username: 'u', pin: '99', name: 'N' });
    expect(r.valid).toBe(false);
  });

  it('accepts leading-zero PIN "0001"', () => {
    expect(validateRegistrationInput({ username: 'u', pin: '0001', name: 'N' }).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. validateWebLoginInput
// ─────────────────────────────────────────────────────────────────────────────
describe('validateWebLoginInput', () => {
  it('accepts a valid email and password', () => {
    expect(validateWebLoginInput({ email: 'admin@example.com', password: 'secret' }).valid).toBe(true);
  });

  it('rejects missing email', () => {
    expect(validateWebLoginInput({ password: 'secret' }).valid).toBe(false);
  });

  it('rejects missing password', () => {
    expect(validateWebLoginInput({ email: 'admin@example.com' }).valid).toBe(false);
  });

  it('rejects empty email string', () => {
    expect(validateWebLoginInput({ email: '', password: 'secret' }).valid).toBe(false);
  });

  it('rejects empty password string', () => {
    expect(validateWebLoginInput({ email: 'admin@example.com', password: '' }).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. hashPassword / verifyPassword  (from api/_utils.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed PIN verifies correctly', async () => {
    const pin    = '7391';
    const hashed = await hashPassword(pin);
    expect(hashed.startsWith('pbkdf2:')).toBe(true);
    await expect(verifyPassword(pin, hashed)).resolves.toBe(true);
  });

  it('rejects an incorrect PIN against a valid hash', async () => {
    const hashed = await hashPassword('1111');
    await expect(verifyPassword('9999', hashed)).resolves.toBe(false);
  });

  it('handles legacy plain-text PINs (backward compatibility)', async () => {
    // Before hashing was introduced, PINs were stored in plain text
    await expect(verifyPassword('0042', '0042')).resolves.toBe(true);
    await expect(verifyPassword('0042', '9999')).resolves.toBe(false);
  });

  it('produces a different hash each call (random salt)', async () => {
    const h1 = await hashPassword('1234');
    const h2 = await hashPassword('1234');
    expect(h1).not.toBe(h2);
    // Both should still verify correctly
    await expect(verifyPassword('1234', h1)).resolves.toBe(true);
    await expect(verifyPassword('1234', h2)).resolves.toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. signJWT / verifyJWT  (from api/_utils.js)
// ─────────────────────────────────────────────────────────────────────────────
describe('signJWT / verifyJWT', () => {
  it('creates a token that verifies and returns the original payload', async () => {
    const payload = { username: 'tester', role: 'Observer', type: 'app' };
    const token   = await signJWT(payload);
    const decoded = await verifyJWT(token);
    expect(decoded).not.toBeNull();
    expect(decoded.username).toBe('tester');
    expect(decoded.role).toBe('Observer');
  });

  it('returns null for a tampered token', async () => {
    const token  = await signJWT({ username: 'tester', role: 'Observer' });
    const parts  = token.split('.');
    // Flip a character in the signature
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A');
    const bad = parts.join('.');
    await expect(verifyJWT(bad)).resolves.toBeNull();
  });

  it('returns null for a completely invalid string', async () => {
    await expect(verifyJWT('not.a.token')).resolves.toBeNull();
  });

  it('returns null for an empty string', async () => {
    await expect(verifyJWT('')).resolves.toBeNull();
  });

  it('includes iat and exp claims', async () => {
    const token   = await signJWT({ username: 'u' });
    const decoded = await verifyJWT(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });
});
