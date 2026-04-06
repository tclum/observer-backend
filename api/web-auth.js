const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = {
  'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json',
};

async function atGet(table, formula) {
  const url = `${AT_BASE}/${encodeURIComponent(table)}${formula ? '?filterByFormula=' + encodeURIComponent(formula) : ''}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
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
    // ── WEB LOGIN ──
    if (action === 'webLogin') {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const data = await atGet('Users', `{Email}="${email.toLowerCase()}"`);
      if (!data.records.length) return res.status(401).json({ error: 'Invalid email or password' });
      const u = data.records[0].fields;
      if (u.Password !== password) return res.status(401).json({ error: 'Invalid email or password' });
      if (u.Status === 'Pending') return res.status(403).json({ error: 'Your account is pending approval.' });
      if (u.Status === 'Suspended') return res.status(403).json({ error: 'Your account has been suspended.' });
      if (u.Status !== 'Active') return res.status(403).json({ error: 'Account not active.' });
      return res.status(200).json({
        success: true,
        user: {
          id: data.records[0].id,
          username: u.Username,
          email: u.Email,
          name: u.Name,
          role: u.Role,
        }
      });
    }

    // ── SET PASSWORD (admin sets for user, or first-time setup) ──
    if (action === 'setPassword') {
      const { adminEmail, adminPassword, targetId, newPassword } = req.body;
      const auth = await atGet('Users', `AND({Email}="${adminEmail.toLowerCase()}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.Password !== adminPassword) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      await atUpdate('Users', targetId, { Password: newPassword });
      return res.status(200).json({ success: true });
    }

    // ── GET ALL USERS FOR WEB (admin) ──
    if (action === 'getWebUsers') {
      const { email, password } = req.body;
      const auth = await atGet('Users', `AND({Email}="${email.toLowerCase()}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.Password !== password) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      const data = await atGet('Users', 'NOT({Username}="")');
      const users = data.records.map(r => ({
        id: r.id,
        username: r.fields.Username,
        name: r.fields.Name,
        email: r.fields.Email || '',
        role: r.fields.Role,
        status: r.fields.Status,
      }));
      return res.status(200).json({ success: true, users });
    }

    // ── UPDATE USER (admin) ──
    if (action === 'webUpdateUser') {
      const { email, password, targetId, fields } = req.body;
      const auth = await atGet('Users', `AND({Email}="${email.toLowerCase()}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.Password !== password) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      await atUpdate('Users', targetId, fields);
      return res.status(200).json({ success: true });
    }

    // ── CREATE USER (admin) ──
    if (action === 'webCreateUser') {
      const { email, password, newUser } = req.body;
      const auth = await atGet('Users', `AND({Email}="${email.toLowerCase()}",{Role}="Admin")`);
      if (!auth.records.length || auth.records[0].fields.Password !== password) {
        return res.status(403).json({ error: 'Admin credentials required' });
      }
      const existing = await atGet('Users', `OR({Username}="${newUser.username}",{Email}="${newUser.email.toLowerCase()}")`);
      if (existing.records.length) return res.status(409).json({ error: 'Username or email already exists' });
      const r = await fetch(`${AT_BASE}/Users`, {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ records: [{ fields: {
          Username: newUser.username, PIN: newUser.pin, Name: newUser.name,
          Email: newUser.email.toLowerCase(), Password: newUser.password,
          Role: newUser.role || 'Observer', Status: 'Active'
        }}]}),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Failed to create user'); }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
