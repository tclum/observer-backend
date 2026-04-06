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

async function atDelete(table, id) {
  const r = await fetch(`${AT_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Airtable error'); }
  return r.json();
}

async function verifyAdmin(email, password) {
  const data = await atGet('Users', `AND({Email}="${email.toLowerCase()}",{Role}="Admin")`);
  return data.records.length > 0 && data.records[0].fields.Password === password;
}

async function verifyUser(email, password) {
  const data = await atGet('Users', `{Email}="${email.toLowerCase()}"`);
  if (!data.records.length) return null;
  const u = data.records[0];
  if (u.fields.Password !== password) return null;
  if (u.fields.Status !== 'Active') return null;
  return { id: u.id, username: u.fields.Username, role: u.fields.Role };
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

    // ── GET LOCATIONS ──
    if (action === 'getLocations') {
      const data = await atGet('Locations', '');
      const locations = data.records.map(r => ({
        id: r.id,
        name: r.fields.Name || '',
        address: r.fields.Address || '',
        type: r.fields.Type || '',
        observers: r.fields.Observers ? r.fields.Observers.split(',').map(s => s.trim()).filter(Boolean) : [],
        active: r.fields.Active !== false,
      }));
      // If observer, only return assigned locations
      if (user.role !== 'Admin') {
        return res.status(200).json({
          success: true,
          locations: locations.filter(l => l.observers.includes(user.username) && l.active)
        });
      }
      return res.status(200).json({ success: true, locations });
    }

    // ── GET ASSIGNED LOCATIONS (for observer app dropdown) ──
    if (action === 'getAssignedLocations') {
      const data = await atGet('Locations', `AND(FIND("${user.username}",{Observers}),{Active}=TRUE())`);
      const locations = data.records.map(r => ({
        id: r.id,
        name: r.fields.Name || '',
        type: r.fields.Type || '',
      }));
      return res.status(200).json({ success: true, locations });
    }

    // Admin-only actions below
    if (user.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });

    // ── CREATE LOCATION ──
    if (action === 'createLocation') {
      const { location } = req.body;
      if (!location?.name) return res.status(400).json({ error: 'Location name required' });
      await atCreate('Locations', {
        Name: location.name,
        Address: location.address || '',
        Type: location.type || '',
        Observers: (location.observers || []).join(', '),
        Active: true,
      });
      return res.status(200).json({ success: true });
    }

    // ── UPDATE LOCATION ──
    if (action === 'updateLocation') {
      const { locationId, location } = req.body;
      await atUpdate('Locations', locationId, {
        Name: location.name,
        Address: location.address || '',
        Type: location.type || '',
        Observers: (location.observers || []).join(', '),
        Active: location.active !== false,
      });
      return res.status(200).json({ success: true });
    }

    // ── DELETE LOCATION ──
    if (action === 'deleteLocation') {
      await atDelete('Locations', req.body.locationId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
