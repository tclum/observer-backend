const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
};

async function atGet(table, formula) {
  const url = `${AT_BASE}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── LOGIN ──
    if (action === 'login') {
      const { username, pin } = req.body;
      if (!username || !pin) return res.status(400).json({ error: 'Missing credentials' });
      const data = await atGet('Users', `{Username}="${username}"`);
      if (!data.records.length) return res.status(401).json({ error: 'Invalid ID or PIN' });
      const u = data.records[0].fields;
      if (u.PIN !== pin) return res.status(401).json({ error: 'Invalid ID or PIN' });
      if (u.Status === 'Pending') return res.status(403).json({ error: 'Your account is pending approval by an admin.' });
      if (u.Status === 'Suspended') return res.status(403).json({ error: 'Your account has been suspended. Contact an admin.' });
      if (u.Status !== 'Active') return res.status(403).json({ error: 'Account not active.' });
      return res.status(200).json({ success: true, user: { username: u.Username, role: u.Role, name: u.Name } });
    }

    // ── REGISTER ──
    if (action === 'register') {
      const { username, pin, name } = req.body;
      if (!username || !pin || !name) return res.status(400).json({ error: 'All fields required' });
      if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return res.status(409).json({ error: 'That Observer ID is already taken' });
      await atCreate('Users', { Username: username, PIN: pin, Name: name, Role: 'Observer', Status: 'Pending' });
      return res.status(200).json({ success: true });
    }

    // ── GET ALL USERS (admin only) ──
    if (action === 'getUsers') {
      const { adminUsername, adminPin } = req.body;
      const auth = await atGet('Users', `AND({Username}="${adminUsername}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.PIN !== adminPin) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      const data = await atGet('Users', 'NOT({Username}="")');
      const users = data.records.map(r => ({
        id: r.id,
        username: r.fields.Username,
        name: r.fields.Name,
        role: r.fields.Role,
        status: r.fields.Status,
      }));
      return res.status(200).json({ success: true, users });
    }

    // ── UPDATE USER (admin: approve/reject/suspend/reset PIN/create) ──
    if (action === 'updateUser') {
      const { adminUsername, adminPin, targetId, fields } = req.body;
      const auth = await atGet('Users', `AND({Username}="${adminUsername}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.PIN !== adminPin) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      await atUpdate('Users', targetId, fields);
      return res.status(200).json({ success: true });
    }

    // ── CREATE USER (admin only) ──
    if (action === 'createUser') {
      const { adminUsername, adminPin, username, pin, name, role } = req.body;
      const auth = await atGet('Users', `AND({Username}="${adminUsername}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.PIN !== adminPin) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return res.status(409).json({ error: 'Username already exists' });
      await atCreate('Users', { Username: username, PIN: pin, Name: name, Role: role || 'Observer', Status: 'Active' });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
