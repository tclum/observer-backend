import { atGet, atCreate, atUpdate, signJWT, verifyToken, hashPassword, verifyPassword, checkRateLimit, getClientIP, corsHeaders, json, parseBody } from './_utils.js';
import { sendEmail, tplObserverRegistration } from './_email.js';

const AT_BASE = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
const HEADERS = { 'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    if (action === 'login') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { username, pin } = body;
      if (!username || !pin) return json(400, { error: 'Missing credentials' }, cors);

      const data = await atGet('Users', `{Username}="${username}"`);
      if (!data.records.length) return json(401, { error: 'Invalid ID or PIN' }, cors);
      const rec = data.records[0];
      const u = rec.fields;

      const pinMatch = await verifyPassword(pin, u.PIN || '');
      if (!pinMatch) return json(401, { error: 'Invalid ID or PIN' }, cors);

      if (u.PIN && !u.PIN.startsWith('pbkdf2:')) {
        hashPassword(pin).then(h => atUpdate('Users', rec.id, { PIN: h })).catch(() => {});
      }

      if (u.Role === 'Business') return json(403, { error: 'Please use the web dashboard at https://observer-backend.netlify.app to sign in.' }, cors);

      if (u.Status === 'Pending') return json(403, { error: 'Your account is pending approval by an admin.' }, cors);
      if (u.Status === 'Suspended') return json(403, { error: 'Your account has been suspended. Contact an admin.' }, cors);
      if (u.Status !== 'Active') return json(403, { error: 'Account not active.' }, cors);

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

      return json(200, { success: true, token, user: { username: u.Username, role: u.Role, name: u.Name }, locations }, cors);
    }

    if (action === 'register') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { username, pin, name } = body;
      if (!username || !pin || !name) return json(400, { error: 'All fields required' }, cors);
      if (pin.length < 4) return json(400, { error: 'PIN must be at least 4 digits' }, cors);

      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return json(409, { error: 'That Observer ID is already taken' }, cors);

      const hashedPin = await hashPassword(pin);
      await atCreate('Users', { Username: username, PIN: hashedPin, Name: name, Role: 'Observer', Status: 'Pending' });
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const tpl = tplObserverRegistration({ name, username });
        sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
      }
      return json(200, { success: true }, cors);
    }

    const payload = await verifyToken(event, body);
    if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

    const requireAdmin = async () => {
      if (payload.role !== 'Admin') return false;
      const d = await atGet('Users', `AND({Username}="${payload.username}",{Role}="Admin",{Status}="Active")`);
      return d.records.length > 0;
    };

    if (action === 'getUsers') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const data = await atGet('Users', 'NOT({Username}="")');
      return json(200, { success: true, users: data.records.map(r => ({
        id: r.id, username: r.fields.Username, name: r.fields.Name, role: r.fields.Role, status: r.fields.Status,
      }))}, cors);
    }

    if (action === 'updateUser') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { targetId, fields } = body;
      if (fields.PIN && !fields.PIN.startsWith('pbkdf2:')) fields.PIN = await hashPassword(fields.PIN);
      await atUpdate('Users', targetId, fields);
      return json(200, { success: true }, cors);
    }

    if (action === 'createUser') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { username, pin, name, role } = body;
      const existing = await atGet('Users', `{Username}="${username}"`);
      if (existing.records.length) return json(409, { error: 'Username already exists' }, cors);
      const hashedPin = await hashPassword(pin);
      await atCreate('Users', { Username: username, PIN: hashedPin, Name: name, Role: role || 'Observer', Status: 'Active' });
      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
