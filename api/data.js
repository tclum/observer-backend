const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
};

async function atGetAll(table, formula) {
  let records = [];
  let offset = null;
  do {
    let url = `${AT_BASE}/${encodeURIComponent(table)}?pageSize=100`;
    if (formula) url += `&filterByFormula=${encodeURIComponent(formula)}`;
    if (offset) url += `&offset=${offset}`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
    const data = await r.json();
    records = records.concat(data.records || []);
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function verifyUser(email, password) {
  const url = `${AT_BASE}/Users?filterByFormula=${encodeURIComponent(`{Email}="${email.toLowerCase()}"`)}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.records.length) return null;
  const u = data.records[0];
  if (u.fields.Password !== password) return null;
  if (u.fields.Status !== 'Active') return null;
  return { id: u.id, username: u.fields.Username, role: u.fields.Role, name: u.fields.Name };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password } = req.body;

  try {
    const user = await verifyUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // ── GET OBSERVATIONS ──
    if (action === 'getObservations') {
      // Observers only see their own data
      const formula = user.role === 'Admin'
        ? ''
        : `{Observer}="${user.username}"`;
      const records = await atGetAll('Observations', formula);
      const observations = records.map(r => ({
        entryId: r.fields['Entry ID'] || '',
        timestamp: r.fields['Timestamp'] || '',
        type: r.fields['Type'] || '',
        observer: r.fields['Observer'] || '',
        location: r.fields['Location'] || '',
        session: r.fields['Session'] || '',
        personNum: r.fields['Person #'] || '',
        age: r.fields['Age'] || '',
        gender: r.fields['Gender'] || '',
        ethnicity: r.fields['Ethnicity'] || '',
        disability: r.fields['Disability'] || '',
        emotion: r.fields['Emotion'] || '',
        missed: r.fields['Missed'] || 'NO',
      }));
      return res.status(200).json({ success: true, observations });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
