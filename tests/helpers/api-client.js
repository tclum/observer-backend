/**
 * Thin HTTP client for E2E tests.
 *
 * Wraps fetch() to POST JSON to an API endpoint.
 * The base URL is read from process.env.TEST_API_URL.
 */

export function getBaseUrl() {
  return (process.env.TEST_API_URL || '').replace(/\/$/, '');
}

/**
 * POST a JSON body to an API endpoint and return the parsed response.
 * @param {string} path     - e.g. '/api/auth'
 * @param {object} body     - request payload
 * @param {string} [token]  - optional Bearer token
 * @returns {Promise<{ status: number, data: object }>}
 */
export async function post(path, body, token) {
  const url     = `${getBaseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(url, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { _raw: await res.text() };
  }

  return { status: res.status, data };
}
