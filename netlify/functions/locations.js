import { atGetAll, atCreate, atUpdate, atDelete, verifyToken, corsHeaders, json, parseBody } from './_utils.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    const payload = await verifyToken(event, body);
    if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

    const isAdmin = payload.role === 'Admin';

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
        return json(200, { success: true, locations: locations.filter(l => l.observers.includes(payload.username) && l.active) }, cors);
      }
      return json(200, { success: true, locations }, cors);
    }

    if (action === 'getAssignedLocations') {
      const formula = isAdmin ? '' : `AND(FIND("${payload.username}",{Observers}),{Active}=TRUE())`;
      const records = await atGetAll('Locations', formula);
      return json(200, { success: true, locations: records.map(r => ({ id: r.id, name: r.fields.Name || '', type: r.fields.Type || '' })) }, cors);
    }

    if (!isAdmin) return json(403, { error: 'Admin access required' }, cors);

    if (action === 'createLocation') {
      const { location } = body;
      if (!location?.name) return json(400, { error: 'Location name required' }, cors);
      await atCreate('Locations', {
        Name: location.name, Address: location.address || '',
        Type: location.type || '', Observers: (location.observers || []).join(', '), Active: true,
      });
      return json(200, { success: true }, cors);
    }

    if (action === 'updateLocation') {
      const { locationId, location } = body;
      await atUpdate('Locations', locationId, {
        Name: location.name, Address: location.address || '',
        Type: location.type || '', Observers: (location.observers || []).join(', '),
        Active: location.active !== false,
      });
      return json(200, { success: true }, cors);
    }

    if (action === 'deleteLocation') {
      await atDelete('Locations', body.locationId);
      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
