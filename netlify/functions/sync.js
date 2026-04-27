import { verifyToken, corsHeaders, json, parseBody } from './_utils.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);

  const payload = await verifyToken(event, body);
  if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    return json(500, { error: 'Airtable environment variables not configured.' }, cors);
  }

  const { records } = body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return json(400, { error: 'No records provided.' }, cors);
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };
  const chunks = [];
  for (let i = 0; i < records.length; i += 10) chunks.push(records.slice(i, i + 10));

  try {
    for (const chunk of chunks) {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ records: chunk }) });
      if (!r.ok) { const e = await r.json(); return json(r.status, { error: e.error?.message || 'Airtable error', details: e }, cors); }
    }
    return json(200, { success: true, rowsSynced: records.length }, cors);
  } catch (err) {
    return json(500, { error: 'Server error: ' + err.message }, cors);
  }
};
