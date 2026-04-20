import { atGet, atCreate, atUpdate, signJWT, verifyToken, hashPassword, verifyPassword, checkRateLimit, getClientIP, setCorsHeaders } from './_utils.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── WEB LOGIN (rate limited) ──
    if (action === 'webLogin') {
      const ip = getClientIP(req);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return res.status(429).json({ error: `Too many attempts. Try again in ${rl.resetIn} minutes.` });

      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const data = await atGet('Users', `{Email}="${email.toLowerCase()}"`);
      if (!data.records.length) return res.status(401).json({ error: 'Invalid email or password' });

      const rec = data.records[0];
      const u = rec.fields;

      const match = await verifyPassword(password, u.Password || '');
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      // Upgrade plain-text password to hashed silently
      if (u.Password && !u.Password.startsWith('pbkdf2:')) {
        hashPassword(password).then(h => atUpdate('Users', rec.id, { Password: h })).catch(() => {});
      }

      if (u.Status === 'Pending') return res.status(403).json({ error: 'Your account is pending approval.' });
      if (u.Status === 'Suspended') return res.status(403).json({ error: 'Your account has been suspended.' });
      if (u.Status !== 'Active') return res.status(403).json({ error: 'Account not active.' });

      const token = await signJWT({ id: rec.id, username: u.Username, email: u.Email, role: u.Role, name: u.Name, type: 'web' });

      return res.status(200).json({
        success: true,
        token,
        user: { id: rec.id, username: u.Username, email: u.Email, name: u.Name, role: u.Role },
      });
    }

    // ── SIGN UP (unauthenticated) ──
    if (action === 'webSignup') {
      const ip = getClientIP(req);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return res.status(429).json({ error: `Too many attempts. Try again in ${rl.resetIn} minutes.` });

      const { name, username, email, password } = req.body;
      if (!name || !username || !email || !password) return res.status(400).json({ error: 'All fields required' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const existing = await atGet('Users', `OR({Username}="${username}",{Email}="${email.toLowerCase()}")`);
      if (existing.records.length) return res.status(409).json({ error: 'Username or email already in use' });

      const hashedPassword = await hashPassword(password);
      await atCreate('Users', {
        Username: username,
        Name: name,
        Email: email.toLowerCase(),
        Password: hashedPassword,
        Role: 'Observer',
        Status: 'Pending',
      });
      return res.status(200).json({ success: true });
    }

    // ── TOKEN-AUTHENTICATED ACTIONS ──
    const payload = await verifyToken(req);
    if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

    const requireAdmin = async () => {
      if (payload.role !== 'Admin') return false;
      const d = await atGet('Users', `AND({Email}="${payload.email}",{Role}="Admin",{Status}="Active")`);
      return d.records.length > 0;
    };

    // ── GET USERS (admin) ──
    if (action === 'getWebUsers') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const data = await atGet('Users', 'NOT({Username}="")');
      return res.status(200).json({ success: true, users: data.records.map(r => ({
        id: r.id, username: r.fields.Username, name: r.fields.Name,
        email: r.fields.Email || '', role: r.fields.Role, status: r.fields.Status,
      }))});
    }

    // ── UPDATE USER (admin) ──
    if (action === 'webUpdateUser') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const { targetId, fields } = req.body;
      if (fields.Password && !fields.Password.startsWith('pbkdf2:')) fields.Password = await hashPassword(fields.Password);
      if (fields.PIN && !fields.PIN.startsWith('pbkdf2:')) fields.PIN = await hashPassword(fields.PIN);
      await atUpdate('Users', targetId, fields);
      return res.status(200).json({ success: true });
    }

    // ── CREATE USER (admin) ──
    if (action === 'webCreateUser') {
      if (!(await requireAdmin())) return res.status(403).json({ error: 'Admin access required' });
      const { newUser } = req.body;
      const existing = await atGet('Users', `OR({Username}="${newUser.username}",{Email}="${newUser.email.toLowerCase()}")`);
      if (existing.records.length) return res.status(409).json({ error: 'Username or email already exists' });
      const hashedPin = await hashPassword(newUser.pin);
      const hashedPassword = await hashPassword(newUser.password);
      await atCreate('Users', {
        Username: newUser.username, PIN: hashedPin, Name: newUser.name,
        Email: newUser.email.toLowerCase(), Password: hashedPassword,
        Role: newUser.role || 'Observer', Status: 'Active',
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
