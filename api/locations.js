import { atGet, atGetAll, atCreate, atUpdate, atDelete, verifyToken } from './_utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    const payload = await verifyToken(req);
    if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

    const isAdmin = payload.role === 'Admin';

    // ── GET LOCATIONS ──
    if (action === 'getLocations') {
      const records = await atGetAll('Locations', '');
      const locations = records.map(r => ({
        id: r.id,
        name: r.fields.Name || '',
        address: r.fields.Address || '',
        type: r.fields.Type || '',
        observers: r.fields.Observers ? r.fields.Observers.split(',').map(s => s.trim()).filter(Boolean) : [],
        active: r.fields.Active !== false,
      }));
      if (!isAdmin) {
        return res.status(200).json({ success: true, locations: locations.filter(l => l.observers.includes(payload.username) && l.active) });
      }
      return res.status(200).json({ success: true, locations });
    }

    // ── GET ASSIGNED LOCATIONS (observer app dropdown) ──
    if (action === 'getAssignedLocations') {
      const formula = isAdmin ? '' : `AND(FIND("${payload.username}",{Observers}),{Active}=TRUE())`;
      const records = await atGetAll('Locations', formula);
      return res.status(200).json({ success: true, locations: records.map(r => ({ id: r.id, name: r.fields.Name || '', type: r.fields.Type || '' })) });
    }

    // Admin-only below
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    if (action === 'createLocation') {
      const { location } = req.body;
      if (!location?.name) return res.status(400).json({ error: 'Location name required' });
      await atCreate('Locations', {
        Name: location.name, Address: location.address || '',
        Type: location.type || '', Observers: (location.observers || []).join(', '), Active: true,
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'updateLocation') {
      const { locationId, location } = req.body;
      await atUpdate('Locations', locationId, {
        Name: location.name, Address: location.address || '',
        Type: location.type || '', Observers: (location.observers || []).join(', '),
        Active: location.active !== false,
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'deleteLocation') {
      await atDelete('Locations', req.body.locationId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
