const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
};

const DEFAULT_CONFIG = {
  ages: ['Under 18', '18–24', '25–34', '35–44', '45–59', '60+'],
  genders: ['Male', 'Female', 'Non-binary', 'Unclear'],
  ethnicities: ['Asian', 'Black', 'Hispanic / Latino', 'Middle Eastern', 'Pacific Islander', 'White', 'Mixed / other', 'Unclear'],
  disabilities: ['None observed', 'Wheelchair', 'Walking aid', 'Visual aid', 'Hearing aid', 'Prosthetic'],
  emotions: ['Happy', 'Neutral', 'Confused', 'Frustrated', 'Distressed'],
};

async function atGet(table, formula) {
  const url = `${AT_BASE}/${encodeURIComponent(table)}${formula ? '?filterByFormula=' + encodeURIComponent(formula) : ''}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

async function atCreate(table, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ records: [{ fields }] }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

async function atUpdate(table, id, fields) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'PATCH', headers: HEADERS,
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

async function verifyAdmin(username, pin) {
  const url = `${AT_BASE}/Users?filterByFormula=${encodeURIComponent(`AND({Username}="${username}",{Role}="Admin")`)}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return false;
  const data = await r.json();
  return data.records.length > 0 && data.records[0].fields.PIN === pin;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── GET CONFIG (any authenticated user) ──
    if (action === 'getConfig') {
      let data;
      try {
        data = await atGet('FieldConfig', '');
      } catch {
        return res.status(200).json({ success: true, config: DEFAULT_CONFIG });
      }
      if (!data.records.length) {
        return res.status(200).json({ success: true, config: DEFAULT_CONFIG });
      }
      const f = data.records[0].fields;
      const config = {
        ages: f.Ages ? f.Ages.split('\n').filter(Boolean) : DEFAULT_CONFIG.ages,
        genders: f.Genders ? f.Genders.split('\n').filter(Boolean) : DEFAULT_CONFIG.genders,
        ethnicities: f.Ethnicities ? f.Ethnicities.split('\n').filter(Boolean) : DEFAULT_CONFIG.ethnicities,
        disabilities: f.Disabilities ? f.Disabilities.split('\n').filter(Boolean) : DEFAULT_CONFIG.disabilities,
        emotions: f.Emotions ? f.Emotions.split('\n').filter(Boolean) : DEFAULT_CONFIG.emotions,
      };
      return res.status(200).json({ success: true, config });
    }

    // ── UPDATE CONFIG (admin only) ──
    if (action === 'updateConfig') {
      const { adminUsername, adminPin, config } = req.body;
      const isAdmin = await verifyAdmin(adminUsername, adminPin);
      if (!isAdmin) return res.status(403).json({ error: 'Admin credentials required' });

      const fields = {
        Ages: (config.ages || []).join('\n'),
        Genders: (config.genders || []).join('\n'),
        Ethnicities: (config.ethnicities || []).join('\n'),
        Disabilities: (config.disabilities || []).join('\n'),
        Emotions: (config.emotions || []).join('\n'),
      };

      // Check if config record exists
      let data;
      try { data = await atGet('FieldConfig', ''); } catch { data = { records: [] }; }

      if (data.records.length) {
        await atUpdate('FieldConfig', data.records[0].id, fields);
      } else {
        await atCreate('FieldConfig', fields);
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
