import { atGet, atCreate, atUpdate, signJWT, verifyToken, hashPassword, verifyPassword, checkRateLimit, getClientIP, setCorsHeaders } from './_utils.js';

const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── LOGIN (rate limited) ──
    if (action === 'login') {
      const ip = getClientIP(req);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return res.status(429).json({ error: `Too many attempts. Try again in ${rl.resetIn} minutes.` });

      const { username, pin } = req.body;
      if (!username || !pin) return res.status(400).json({ error: 'Missing credentials' });

      const data = await atGet('Users', `{Username}="${username}"`);
      if (!data.records.length) return res.status(401).json({ error: 'Invalid ID or PIN' });
      const rec = data.records[0];
      const u = rec.fields;

      const pinMatch = await verifyPassword(pin, u.PIN || '');
      if (!pinMatch) return res.status(401).json({ error: 'Invalid ID or PIN' });

      // Upgrade plain-text PIN to hashed silently
      if (u.PIN && !u.PIN.startsWith('pbkdf2:')) {
        hashPassword(pin).then(h => atUpdate('Users', rec.id, { PIN: h })).catch(() => {});
      }

      if (u.Status === 'Pending') return res.status(403).json({ error: 'Your account is pending approval by an admin.' });
      if (u.Status === 'Suspended') return res.status(403).json({ error: 'Your account has been suspended. Contact an admin.' });
      if (u.Status !== 'Active') return res.status(403).json({ error: 'Account not active.' });

      const token = await signJWT({ username: u.Username, role: u.Role, name: u.Name, type: 'app' });

      let locations = [];
      try {
        const locFormula = u.Role === 'Admin' ? '' : `FIND("${u.Username}",{Observers})`;
        const locUrl = `${AT_BASE}/${encodeURIComponent('Locations')}${locFormula ? '?filterByFormula=' + encodeURIComponent(locFormula) : ''}`;
        const locRes = await fetch(locUrl, { headers: HEADERS });
        if (locRes.ok) {
          const locData = await locRes.json();
          locations = locData.records
            .filter(r => r.fields.Active !== false)
            .map(r => ({ id: r.id, name: r.fields.Name || '', type: r.fields.Type || '' }));
        }
      } catch(e) {}

      return res.status(200).json({ success: true, token, user: { username: u.Username, role: u.Role, name: u.Name }, locations });
    }

    // ── REGISTER (rate limited) ──
    if (action === 'register') {
      const ip = getClientIP(req);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return res.status(429).json({ error: `Too many attempts. Try again in ${rl.resetIn} minutes.` });

      const { username, pin, name } = req.body;
      if (!username || !pin || !name) return res.status(400).json({ error: 'All fields required' });
      if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });

      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return res.status(409).json({ error: 'That Observer ID is already taken' });

      const hashedPin = await hashPassword(pin);
      await atCreate('Users', { Username: username, PIN: hashedPin, Name: name, Role: 'Observer', Status: 'Pending' });
      return res.status(200).json({ success: true });
    }

    // ── TOKEN-AUTHENTICATED ACTIONS ──
    const payload = await verifyToken(req);
    if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

    const requireAdmin = async () => {
      if (payload.role !== 'Admin') return false;
      const d = await atGet('Users', `AND({Username}="${payload.username}",{Role}="Admin",{Status}="Active")`);
      return d.records.length > 0;
    };

    if (action === 'getUsers') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const data = await atGet('Users', 'NOT({Username}="")');
      return res.status(200).json({ success: true, users: data.records.map(r => ({
        id: r.id, username: r.fields.Username, name: r.fields.Name, role: r.fields.Role, status: r.fields.Status,
      }))});
    }

    if (action === 'updateUser') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const { targetId, fields } = req.body;
      if (fields.PIN && !fields.PIN.startsWith('pbkdf2:')) fields.PIN = await hashPassword(fields.PIN);
      await atUpdate('Users', targetId, fields);
      return res.status(200).json({ success: true });
    }

    if (action === 'createUser') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const { username, pin, name, role } = req.body;
      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return res.status(409).json({ error: 'Username already exists' });
      const hashedPin = await hashPassword(pin);
      await atCreate('Users', { Username: username, PIN: hashedPin, Name: name, Role: role || 'Observer', Status: 'Active' });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
