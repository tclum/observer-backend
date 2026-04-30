import { atGet, atGetAll, atCreate, atUpdate, atDelete, verifyToken, corsHeaders, json, parseBody } from './_utils.js';
import { sendEmail, tplLocationActivated, tplLocationPending } from './_email.js';

const isTrueStr = v => typeof v === 'string' && v.toLowerCase() === 'true';

const mapLocation = r => ({
  id: r.id,
  name: r.fields.Name || '',
  address: r.fields.Address || '',
  type: r.fields.Type || '',
  observers: r.fields.Observers ? r.fields.Observers.split(',').map(s => s.trim()).filter(Boolean) : [],
  businesses: r.fields.Businesses ? r.fields.Businesses.split(',').map(s => s.trim()).filter(Boolean) : [],
  active: r.fields.Active !== false,
  businessUsername: r.fields.BusinessUsername || '',
  businessName: r.fields.BusinessName || '',
  cameraUrl: r.fields.CameraUrl || '',
  cameraEnabled: isTrueStr(r.fields.CameraEnabled),
  autoScanEnabled: isTrueStr(r.fields.AutoScanEnabled),
  autoScanInterval: parseInt(r.fields.AutoScanInterval, 10) || 60,
  lastScanAt: r.fields.LastScanAt || '',
  lastScanCount: r.fields.LastScanCount || '',
});

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
    const isBusiness = payload.role === 'Business';

    if (action === 'getLocations') {
      const records = await atGetAll('Locations', '');
      const locations = records.map(mapLocation);
      if (isAdmin) return json(200, { success: true, locations }, cors);
      if (isBusiness) {
        const mine = locations.filter(l => l.businessUsername === payload.username || l.businesses.includes(payload.username));
        return json(200, { success: true, locations: mine }, cors);
      }
      return json(200, { success: true, locations: locations.filter(l => l.observers.includes(payload.username) && l.active) }, cors);
    }

    if (action === 'getAssignedLocations') {
      let formula = '';
      if (isBusiness) formula = `AND(OR(FIND("${payload.username}",{Businesses}),{BusinessUsername}="${payload.username}"),{Active}=TRUE())`;
      else if (!isAdmin) formula = `AND(FIND("${payload.username}",{Observers}),{Active}=TRUE())`;
      const records = await atGetAll('Locations', formula);
      return json(200, { success: true, locations: records.map(r => ({ id: r.id, name: r.fields.Name || '', type: r.fields.Type || '' })) }, cors);
    }

    if (action === 'createLocation') {
      if (!isAdmin && !isBusiness) return json(403, { error: 'Forbidden' }, cors);
      const { location } = body;
      if (!location?.name) return json(400, { error: 'Location name required' }, cors);

      let businessUsername = '';
      let businessName = '';
      let businesses = location.businesses || [];
      let observers = location.observers || [];
      let active;
      if (isBusiness) {
        businessUsername = payload.username;
        businessName = payload.name || payload.username;
        businesses = [payload.username];
        observers = [];
        active = false;
      } else {
        businessUsername = location.businessUsername || '';
        businessName = location.businessName || '';
        active = location.active !== false;
      }

      await atCreate('Locations', {
        Name: location.name,
        Address: location.address || '',
        Type: location.type || '',
        Observers: observers.join(', '),
        Businesses: businesses.join(', '),
        Active: active,
        BusinessUsername: businessUsername,
        BusinessName: businessName,
      });

      if (isBusiness) {
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          const tpl = tplLocationPending({ businessName, locationName: location.name });
          sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
        }
      }

      return json(200, { success: true }, cors);
    }

    if (action === 'updateLocation') {
      const { locationId, location } = body;
      if (!locationId) return json(400, { error: 'locationId required' }, cors);

      if (isBusiness) {
        const existing = await atGet('Locations', `RECORD_ID()="${locationId}"`);
        const rec = existing.records[0];
        if (!rec) return json(404, { error: 'Location not found' }, cors);
        if (rec.fields.BusinessUsername !== payload.username) return json(403, { error: 'You can only edit your own locations' }, cors);

        await atUpdate('Locations', locationId, {
          Name: location.name,
          Address: location.address || '',
          Type: location.type || '',
        });
        return json(200, { success: true }, cors);
      }

      if (!isAdmin) return json(403, { error: 'Admin access required' }, cors);

      const fields = {
        Name: location.name,
        Address: location.address || '',
        Type: location.type || '',
        Observers: (location.observers || []).join(', '),
        Businesses: (location.businesses || []).join(', '),
        Active: location.active !== false,
      };
      if (location.businessUsername !== undefined) fields.BusinessUsername = location.businessUsername;
      if (location.businessName !== undefined) fields.BusinessName = location.businessName;

      const before = await atGet('Locations', `RECORD_ID()="${locationId}"`);
      const wasActive = before.records[0]?.fields?.Active !== false;
      await atUpdate('Locations', locationId, fields);

      if (!wasActive && fields.Active) {
        try {
          const bizUsername = fields.BusinessUsername || before.records[0]?.fields?.BusinessUsername;
          if (bizUsername) {
            const bizUser = await atGet('Users', `{Username}="${bizUsername}"`);
            const bizEmail = bizUser.records[0]?.fields?.Email;
            if (bizEmail) {
              const tpl = tplLocationActivated({ locationName: location.name });
              sendEmail(bizEmail, tpl.subject, tpl.html).catch(() => {});
            }
          }
        } catch (e) {}
      }

      return json(200, { success: true }, cors);
    }

    if (action === 'deleteLocation') {
      if (!isAdmin) return json(403, { error: 'Admin access required' }, cors);
      await atDelete('Locations', body.locationId);
      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
