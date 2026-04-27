import { atGet, atCreate, atUpdate, signJWT, verifyToken, hashPassword, verifyPassword, checkRateLimit, getClientIP, corsHeaders, json, parseBody } from './_utils.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    if (action === 'webLogin') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { email, password } = body;
      if (!email || !password) return json(400, { error: 'Email and password required' }, cors);

      const data = await atGet('Users', `{Email}="${email.toLowerCase()}"`);
      if (!data.records.length) return json(401, { error: 'Invalid email or password' }, cors);

      const rec = data.records[0];
      const u = rec.fields;

      const match = await verifyPassword(password, u.Password || '');
      if (!match) return json(401, { error: 'Invalid email or password' }, cors);

      if (u.Password && !u.Password.startsWith('pbkdf2:')) {
        hashPassword(password).then(h => atUpdate('Users', rec.id, { Password: h })).catch(() => {});
      }

      if (u.Status === 'Pending') return json(403, { error: 'Your account is pending approval.' }, cors);
      if (u.Status === 'Suspended') return json(403, { error: 'Your account has been suspended.' }, cors);
      if (u.Status !== 'Active') return json(403, { error: 'Account not active.' }, cors);

      const token = await signJWT({ id: rec.id, username: u.Username, email: u.Email, role: u.Role, name: u.Name, type: 'web' });

      return json(200, {
        success: true,
        token,
        user: { id: rec.id, username: u.Username, email: u.Email, name: u.Name, role: u.Role },
      }, cors);
    }

    const payload = await verifyToken(event, body);
    if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

    const requireAdmin = async () => {
      if (payload.role !== 'Admin') return false;
      const d = await atGet('Users', `AND({Email}="${payload.email}",{Role}="Admin",{Status}="Active")`);
      return d.records.length > 0;
    };

    if (action === 'getWebUsers') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const data = await atGet('Users', 'NOT({Username}="")');
      return json(200, { success: true, users: data.records.map(r => ({
        id: r.id, username: r.fields.Username, name: r.fields.Name,
        email: r.fields.Email || '', role: r.fields.Role, status: r.fields.Status,
      }))}, cors);
    }

    if (action === 'webUpdateUser') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { targetId, fields } = body;
      if (fields.Password && !fields.Password.startsWith('pbkdf2:')) fields.Password = await hashPassword(fields.Password);
      if (fields.PIN && !fields.PIN.startsWith('pbkdf2:')) fields.PIN = await hashPassword(fields.PIN);
      await atUpdate('Users', targetId, fields);
      return json(200, { success: true }, cors);
    }

    if (action === 'webCreateUser') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { newUser } = body;
      const existing = await atGet('Users', `OR({Username}="${newUser.username}",{Email}="${newUser.email.toLowerCase()}")`);
      if (existing.records.length) return json(409, { error: 'Username or email already exists' }, cors);
      const hashedPin = await hashPassword(newUser.pin);
      const hashedPassword = await hashPassword(newUser.password);
      await atCreate('Users', {
        Username: newUser.username, PIN: hashedPin, Name: newUser.name,
        Email: newUser.email.toLowerCase(), Password: hashedPassword,
        Role: newUser.role || 'Observer', Status: 'Active',
      });
      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
