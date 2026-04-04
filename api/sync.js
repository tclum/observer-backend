export default async function handler(req, res) {
  // Allow requests from any origin (your local HTML file or hosted app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = process.env;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    return res.status(500).json({ error: 'Airtable environment variables not configured on server.' });
  }

  const { records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided.' });
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;
  const headers = {
    'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Airtable max 10 records per request — chunk them
  const chunks = [];
  for (let i = 0; i < records.length; i += 10) {
    chunks.push(records.slice(i, i + 10));
  }

  try {
    for (const chunk of chunks) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: chunk }),
      });

      if (!response.ok) {
        const err = await response.json();
        return res.status(response.status).json({
          error: err.error?.message || 'Airtable returned an error.',
          details: err,
        });
      }
    }

    return res.status(200).json({ success: true, rowsSynced: records.length });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
