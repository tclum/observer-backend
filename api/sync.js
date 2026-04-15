import { verifyToken, setCorsHeaders } from './_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify JWT token
  const payload = await verifyToken(req);
  if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    return res.status(500).json({ error: 'Airtable environment variables not configured.' });
  }

  const { records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided.' });
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };
  const chunks = [];
  for (let i = 0; i < records.length; i += 10) chunks.push(records.slice(i, i + 10));

  try {
    for (const chunk of chunks) {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ records: chunk }) });
      if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.error?.message || 'Airtable error', details: e }); }
    }
    return res.status(200).json({ success: true, rowsSynced: records.length });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
