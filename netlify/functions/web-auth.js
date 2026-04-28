import { atGet, atGetAll, atCreate, atUpdate, signJWT, verifyToken, hashPassword, verifyPassword, checkRateLimit, getClientIP, corsHeaders, json, parseBody } from './_utils.js';
import { sendEmail, tplBusinessRegistration, tplObserverRegistration, tplApproved, tplRejected, tplPasswordReset } from './_email.js';

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

    if (action === 'webSignup') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { name, username, email, password } = body;
      if (!name || !username || !email || !password) return json(400, { error: 'All fields required' }, cors);
      if (password.length < 8) return json(400, { error: 'Password must be at least 8 characters' }, cors);

      const emailLc = String(email).toLowerCase();
      const cleanUsername = String(username).trim();

      const existing = await atGet('Users', `OR({Username}="${cleanUsername}",{Email}="${emailLc}")`);
      if (existing.records.length) return json(409, { error: 'That username or email is already taken' }, cors);

      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const hashedPin = await hashPassword(pin);
      const hashedPassword = await hashPassword(password);

      await atCreate('Users', {
        Username: cleanUsername, PIN: hashedPin, Name: name,
        Email: emailLc, Password: hashedPassword,
        Role: 'Observer', Status: 'Pending',
      });

      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const tpl = tplObserverRegistration({ name, username: cleanUsername });
        sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
      }

      return json(200, { success: true }, cors);
    }

    if (action === 'registerBusiness') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { businessName, contactPerson, email, password, businessType, requestedLocations, phone, description } = body;
      if (!businessName || !contactPerson || !email || !password || !businessType) {
        return json(400, { error: 'Business name, contact person, email, password, and business type are required.' }, cors);
      }
      if (password.length < 8) return json(400, { error: 'Password must be at least 8 characters.' }, cors);

      const emailLc = String(email).toLowerCase();
      const existingEmail = await atGet('Users', `{Email}="${emailLc}"`);
      if (existingEmail.records.length) return json(409, { error: 'An account with that email already exists.' }, cors);

      const baseUsername = String(businessName).toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!baseUsername) return json(400, { error: 'Business name must contain alphanumeric characters.' }, cors);

      let username = baseUsername;
      for (let i = 2; i < 100; i++) {
        const taken = await atGet('Users', `{Username}="${username}"`);
        if (!taken.records.length) break;
        username = `${baseUsername}-${i}`;
      }

      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const hashedPin = await hashPassword(pin);
      const hashedPassword = await hashPassword(password);

      const notes = JSON.stringify({
        contactPerson,
        businessType,
        requestedLocations: Array.isArray(requestedLocations) ? requestedLocations : [],
        phone: phone || '',
        description: description || '',
      });

      await atCreate('Users', {
        Username: username, PIN: hashedPin, Name: businessName,
        Email: emailLc, Password: hashedPassword,
        Role: 'Business', Status: 'Pending', Notes: notes,
      });

      const reqLocs = Array.isArray(requestedLocations) ? requestedLocations.filter(Boolean) : [];
      for (const locName of reqLocs) {
        try {
          await atCreate('Locations', {
            Name: locName,
            Address: '',
            Type: '',
            Observers: '',
            Businesses: username,
            BusinessUsername: username,
            BusinessName: businessName,
            Active: false,
          });
        } catch (e) { /* skip duplicates / errors */ }
      }

      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const tpl = tplBusinessRegistration({ businessName, contactPerson, email: emailLc, businessType, requestedLocations, phone, description });
        sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
      }

      return json(200, { success: true, message: 'Request submitted. An admin will review your account.' }, cors);
    }

    if (action === 'requestPasswordReset') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { email } = body;
      const genericReply = json(200, { success: true, message: 'If that email exists, a reset code has been sent.' }, cors);
      if (!email) return genericReply;

      const emailLc = String(email).toLowerCase();
      const found = await atGet('Users', `{Email}="${emailLc}"`);
      if (!found.records.length) return genericReply;

      const rec = found.records[0];
      let notesObj = {};
      try { notesObj = rec.fields.Notes ? JSON.parse(rec.fields.Notes) : {}; } catch { notesObj = {}; }

      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const codeBytes = new Uint8Array(6);
      crypto.getRandomValues(codeBytes);
      const code = Array.from(codeBytes, b => alphabet[b % alphabet.length]).join('');

      notesObj.resetCode = code;
      notesObj.resetExpiry = Date.now() + 3600000;
      await atUpdate('Users', rec.id, { Notes: JSON.stringify(notesObj) });

      const tpl = tplPasswordReset({ code });
      sendEmail(emailLc, tpl.subject, tpl.html).catch(() => {});

      return genericReply;
    }

    if (action === 'confirmPasswordReset') {
      const ip = getClientIP(event);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) return json(429, { error: `Too many attempts. Try again in ${rl.resetIn} minutes.` }, cors);

      const { email, code, newPassword } = body;
      if (!email || !code || !newPassword) return json(400, { error: 'Missing fields' }, cors);
      if (newPassword.length < 8) return json(400, { error: 'Password must be at least 8 characters' }, cors);

      const emailLc = String(email).toLowerCase();
      const found = await atGet('Users', `{Email}="${emailLc}"`);
      if (!found.records.length) return json(400, { error: 'Invalid or expired code' }, cors);

      const rec = found.records[0];
      let notesObj = {};
      try { notesObj = rec.fields.Notes ? JSON.parse(rec.fields.Notes) : {}; } catch { notesObj = {}; }

      if (!notesObj.resetCode || !notesObj.resetExpiry || notesObj.resetCode !== String(code).toUpperCase()
          || Date.now() > notesObj.resetExpiry) {
        return json(400, { error: 'Invalid or expired code' }, cors);
      }

      const hashed = await hashPassword(newPassword);
      delete notesObj.resetCode;
      delete notesObj.resetExpiry;
      await atUpdate('Users', rec.id, { Password: hashed, Notes: JSON.stringify(notesObj) });

      return json(200, { success: true }, cors);
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
        notes: r.fields.Notes || '',
      }))}, cors);
    }

    if (action === 'webUpdateUser') {
      if (!(await requireAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { targetId, fields } = body;
      if (fields.Password && !fields.Password.startsWith('pbkdf2:')) fields.Password = await hashPassword(fields.Password);
      if (fields.PIN && !fields.PIN.startsWith('pbkdf2:')) fields.PIN = await hashPassword(fields.PIN);
      await atUpdate('Users', targetId, fields);

      if (fields.Status === 'Active' || fields.Status === 'Rejected') {
        try {
          const fresh = await atGet('Users', `RECORD_ID()="${targetId}"`);
          const u = fresh.records[0]?.fields;
          if (u?.Email) {
            const tpl = fields.Status === 'Active' ? tplApproved({ username: u.Username }) : tplRejected();
            sendEmail(u.Email, tpl.subject, tpl.html).catch(() => {});
          }
          if (fields.Status === 'Active' && u?.Role === 'Business' && u?.Username) {
            const locs = await atGetAll('Locations', `AND({BusinessUsername}="${u.Username}",NOT({Active}=TRUE()))`);
            for (const loc of locs) {
              try { await atUpdate('Locations', loc.id, { Active: true }); } catch (e) {}
            }
          }
        } catch (e) { /* email is fire-and-forget */ }
      }

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
