/**
 * Pure auth validation functions.
 *
 * These mirror the rules enforced inside api/auth.js and api/web-auth.js
 * but are free of Airtable calls, HTTP objects, and side effects — making
 * them directly importable and testable in unit tests.
 */

/**
 * Validates the body of a mobile login request.
 * @param {{ username?: unknown, pin?: unknown }} body
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateLoginInput(body) {
  const { username, pin } = body ?? {};
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return { valid: false, error: 'Missing credentials' };
  }
  if (!pin || typeof pin !== 'string' || pin.trim() === '') {
    return { valid: false, error: 'Missing credentials' };
  }
  return { valid: true };
}

/**
 * Validates PIN format rules.
 *   - Must be a string
 *   - Must be exactly 4 characters (Airtable schema: "4-digit number")
 *   - Must contain only digits (leading zeros allowed, e.g. "0042" is valid)
 * @param {unknown} pin
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePinFormat(pin) {
  if (typeof pin !== 'string') {
    return { valid: false, error: 'PIN must be a 4-digit string' };
  }
  if (pin.trim() === '') {
    return { valid: false, error: 'PIN is required' };
  }
  if (pin.length !== 4) {
    return { valid: false, error: 'PIN must be exactly 4 digits' };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { valid: false, error: 'PIN must contain only digits' };
  }
  return { valid: true };
}

/**
 * Validates the status field of a user record fetched from Airtable.
 * Matches the exact status checks in api/auth.js.
 * @param {{ Status?: string }} user  - Airtable fields object
 * @returns {{ allowed: boolean, status: number, error?: string }}
 */
export function validateUserStatus(user) {
  if (user.Status === 'Pending') {
    return { allowed: false, status: 403, error: 'Your account is pending approval by an admin.' };
  }
  if (user.Status === 'Suspended') {
    return { allowed: false, status: 403, error: 'Your account has been suspended. Contact an admin.' };
  }
  if (user.Status !== 'Active') {
    return { allowed: false, status: 403, error: 'Account not active.' };
  }
  return { allowed: true, status: 200 };
}

/**
 * Validates that a user's Role is in an allowed list.
 * @param {{ Role?: string }} user
 * @param {string[]} allowedRoles  e.g. ['Admin']
 * @returns {{ allowed: boolean, error?: string }}
 */
export function validateUserRole(user, allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    return { allowed: false, error: 'No allowed roles specified' };
  }
  if (!allowedRoles.includes(user.Role)) {
    return { allowed: false, error: 'Admin access required' };
  }
  return { allowed: true };
}

/**
 * Validates the body of a mobile registration request.
 * @param {{ username?: unknown, pin?: unknown, name?: unknown }} body
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateRegistrationInput(body) {
  const { username, pin, name } = body ?? {};
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return { valid: false, error: 'All fields required' };
  }
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return { valid: false, error: 'All fields required' };
  }
  if (!pin) {
    return { valid: false, error: 'All fields required' };
  }
  return validatePinFormat(String(pin));
}

/**
 * Validates the body of a web login request (email + password).
 * @param {{ email?: unknown, password?: unknown }} body
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateWebLoginInput(body) {
  const { email, password } = body ?? {};
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return { valid: false, error: 'Missing credentials' };
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return { valid: false, error: 'Missing credentials' };
  }
  return { valid: true };
}
