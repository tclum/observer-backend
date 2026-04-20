/**
 * Pure observation validation functions.
 *
 * The FieldConfig values (Ages, Genders, etc.) come from the Airtable
 * FieldConfig table at runtime, not from hardcoded constants here.
 * Unit tests load those values via the globalSetup fixture.
 */

/**
 * Validates that a timestamp is present and parses as a valid date.
 * @param {unknown} timestamp
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTimestamp(timestamp) {
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return { valid: false, error: 'Timestamp is required' };
  }
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Timestamp is not a valid date' };
  }
  return { valid: true };
}

/**
 * Validates the Person # field.
 *   - Must be present
 *   - Must be a positive integer (≥ 1)
 * @param {unknown} personNum
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePersonNumber(personNum) {
  if (personNum === undefined || personNum === null || personNum === '') {
    return { valid: false, error: 'Person # is required' };
  }
  const n = Number(personNum);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { valid: false, error: 'Person # must be a positive integer' };
  }
  return { valid: true };
}

/**
 * Validates the Missed field.
 * Accepts: true, false, 'true', 'false', 1, 0, 'yes', 'no', or empty string / undefined.
 * @param {unknown} missed
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMissed(missed) {
  const VALID = [true, false, 'true', 'false', 1, 0, 'yes', 'no', '', undefined, null];
  if (!VALID.includes(missed)) {
    return { valid: false, error: `Missed must be a boolean-like value, got: "${missed}"` };
  }
  return { valid: true };
}

/**
 * Validates a demographic field value against the allowed list from FieldConfig.
 * Empty or undefined values are allowed (the field is optional when Missed = true
 * or the mission type doesn't require it).
 * @param {unknown} value
 * @param {string[]} allowedValues  - e.g. fieldConfig.Ages
 * @param {string} fieldName        - human-readable label for error messages
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDemographicField(value, allowedValues, fieldName) {
  if (value === undefined || value === null || value === '') return { valid: true };
  if (!Array.isArray(allowedValues) || allowedValues.length === 0) return { valid: true };
  if (!allowedValues.includes(String(value))) {
    return { valid: false, error: `"${value}" is not a valid ${fieldName}` };
  }
  return { valid: true };
}

/**
 * Validates a complete observation record.
 *
 * @param {object} observation      - The fields object to validate
 * @param {object} context
 * @param {object} context.fieldConfig       - { Ages, Genders, Ethnicities, Disabilities, Emotions }
 * @param {string[]} context.activeLocations - Array of active location names
 * @param {string} [context.observerUsername]- The logged-in user's username
 * @param {string} [context.missionType]     - Expected Type value (optional)
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateObservation(observation, context = {}) {
  const { fieldConfig, activeLocations, observerUsername, missionType } = context;
  const errors = [];

  // ── Required core fields ──

  const tsResult = validateTimestamp(observation?.Timestamp);
  if (!tsResult.valid) errors.push(tsResult.error);

  if (!observation?.Type || String(observation.Type).trim() === '') {
    errors.push('Type is required');
  } else if (missionType && observation.Type !== missionType) {
    errors.push(`Type must match the mission type "${missionType}"`);
  }

  if (!observation?.Observer || String(observation.Observer).trim() === '') {
    errors.push('Observer is required');
  } else if (observerUsername && observation.Observer !== observerUsername) {
    errors.push('Observer must match the logged-in user');
  }

  if (!observation?.Location || String(observation.Location).trim() === '') {
    errors.push('Location is required');
  } else if (Array.isArray(activeLocations) && activeLocations.length > 0) {
    if (!activeLocations.includes(observation.Location)) {
      errors.push(`"${observation.Location}" is not a valid active location`);
    }
  }

  const personResult = validatePersonNumber(observation?.['Person #']);
  if (!personResult.valid) errors.push(personResult.error);

  const missedResult = validateMissed(observation?.Missed);
  if (!missedResult.valid) errors.push(missedResult.error);

  // ── Optional demographic fields validated against FieldConfig ──
  if (fieldConfig) {
    const demographicChecks = [
      { value: observation?.Age,       allowed: fieldConfig.Ages,        label: 'Age' },
      { value: observation?.Gender,    allowed: fieldConfig.Genders,     label: 'Gender' },
      { value: observation?.Ethnicity, allowed: fieldConfig.Ethnicities, label: 'Ethnicity' },
      { value: observation?.Disability,allowed: fieldConfig.Disabilities,label: 'Disability' },
      { value: observation?.Emotion,   allowed: fieldConfig.Emotions,    label: 'Emotion' },
    ];
    for (const { value, allowed, label } of demographicChecks) {
      const r = validateDemographicField(value, allowed, label);
      if (!r.valid) errors.push(r.error);
    }
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}
