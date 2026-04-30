// Camera control proxy for Raspberry Pi detection servers.
//
// Environment variables:
//   - None new — relies on existing AIRTABLE_TOKEN, AIRTABLE_BASE_ID, JWT_SECRET.
//   - Pi server URLs are stored per-Location in Airtable (CameraUrl field).
//
// Airtable schema additions:
//   Locations table (Single line text unless noted):
//     - CameraUrl         (e.g. http://192.168.1.50:5000)
//     - CameraEnabled     ("true" / "false")
//     - AutoScanEnabled   ("true" / "false")
//     - AutoScanInterval  (seconds as string, e.g. "60")
//     - LastScanAt        (ISO timestamp string)
//     - LastScanCount     (number as string)
//   Observations table:
//     - Source            ("human" or "camera")
//     - CameraUrl         (which Pi produced this reading)
//
// Auto-scan tick:
//   Wire `GET /api/camera?action=autoScanTick` (no auth) to a Netlify scheduled
//   function or external cron job to drive periodic scans.

import { atGet, atGetAll, atCreate, atUpdate, verifyToken, corsHeaders, json, parseBody } from './_utils.js';

const PI_TIMEOUT_MS = 10000;

function isTrue(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function mapCameraLocation(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    name: f.Name || '',
    businessUsername: f.BusinessUsername || '',
    businessName: f.BusinessName || '',
    businesses: f.Businesses ? f.Businesses.split(',').map(s => s.trim()).filter(Boolean) : [],
    active: f.Active !== false,
    cameraUrl: f.CameraUrl || '',
    cameraEnabled: isTrue(f.CameraEnabled),
    autoScanEnabled: isTrue(f.AutoScanEnabled),
    autoScanInterval: parseInt(f.AutoScanInterval, 10) || 60,
    lastScanAt: f.LastScanAt || '',
    lastScanCount: f.LastScanCount || '',
  };
}

async function getLocationWithCamera(locationId, payload) {
  if (!locationId) return { error: { status: 400, message: 'locationId required' } };
  const res = await atGet('Locations', `RECORD_ID()="${locationId}"`);
  const rec = res.records?.[0];
  if (!rec) return { error: { status: 404, message: 'Location not found' } };
  const loc = mapCameraLocation(rec);
  if (payload.role === 'Business') {
    if (loc.businessUsername !== payload.username && !loc.businesses.includes(payload.username)) {
      return { error: { status: 403, message: 'You can only access your own locations' } };
    }
  } else if (payload.role !== 'Admin') {
    return { error: { status: 403, message: 'Forbidden' } };
  }
  return { loc };
}

async function proxyToPi(piUrl, path, method = 'GET', body = null) {
  if (!piUrl) throw new Error('Camera URL not set for this location');
  const url = piUrl.replace(/\/+$/, '') + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PI_TIMEOUT_MS);
  try {
    const opts = { method, signal: ctrl.signal, headers: {} };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`Pi server returned ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const txt = await r.text();
      throw new Error('Pi server returned non-JSON response');
    }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Pi connection timed out (10s)');
    if (e.message?.includes('ECONNREFUSED') || e.message?.includes('fetch failed')) {
      throw new Error('Could not reach Pi — check that the camera URL is correct and the device is online');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function proxyBinaryToPi(piUrl, path) {
  if (!piUrl) throw new Error('Camera URL not set for this location');
  const url = piUrl.replace(/\/+$/, '') + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PI_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Pi server returned ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { contentType: r.headers.get('content-type') || 'image/jpeg', buffer: buf };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Pi connection timed out (10s)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function performScan(loc) {
  const piResult = await proxyToPi(loc.cameraUrl, '/api/scan-latest', 'POST', {});
  const peopleCount = Number(piResult.people_count || 0);
  const piTimestamp = piResult.timestamp || new Date().toISOString();
  await atUpdate('Locations', loc.id, {
    LastScanAt: piTimestamp,
    LastScanCount: String(peopleCount),
  });
  const created = await atCreate('Observations', {
    'Entry ID': 'cam_' + Date.now(),
    'Timestamp': piTimestamp,
    'Type': 'camera',
    'Observer': 'camera',
    'Location': loc.name,
    'Session': 'Camera Scan',
    'Person #': String(peopleCount),
    'Source': 'camera',
    'CameraUrl': loc.cameraUrl,
    'Missed': 'NO',
  });
  return { piResult, peopleCount, recordId: created.records?.[0]?.id || null, timestamp: piTimestamp };
}

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  // Auto-scan tick is callable via GET without auth.
  const isGet = event.httpMethod === 'GET';
  const qs = event.queryStringParameters || {};
  if (isGet && qs.action === 'autoScanTick') {
    try {
      const records = await atGetAll('Locations', `AND({AutoScanEnabled}="true",{CameraEnabled}="true",{Active}=TRUE())`);
      const now = Date.now();
      const results = [];
      for (const rec of records) {
        const loc = mapCameraLocation(rec);
        if (!loc.cameraUrl) continue;
        const last = loc.lastScanAt ? new Date(loc.lastScanAt).getTime() : 0;
        const due = last + (loc.autoScanInterval * 1000);
        if (now < due) { results.push({ id: loc.id, name: loc.name, skipped: 'not due' }); continue; }
        try {
          const r = await performScan(loc);
          results.push({ id: loc.id, name: loc.name, peopleCount: r.peopleCount });
        } catch (e) {
          results.push({ id: loc.id, name: loc.name, error: e.message });
        }
      }
      return json(200, { scanned: results.filter(r => typeof r.peopleCount === 'number').length, results }, cors);
    } catch (err) {
      return json(500, { error: err.message }, cors);
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    const payload = await verifyToken(event, body);
    if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

    const isAdmin = payload.role === 'Admin';
    const isBusiness = payload.role === 'Business';
    if (!isAdmin && !isBusiness) return json(403, { error: 'Forbidden' }, cors);

    if (action === 'getCameraList') {
      const records = await atGetAll('Locations', '');
      let locs = records.map(mapCameraLocation);
      if (isBusiness) {
        locs = locs.filter(l => l.businessUsername === payload.username || l.businesses.includes(payload.username));
      }
      locs = locs.filter(l => l.cameraUrl || l.cameraEnabled);
      return json(200, { success: true, locations: locs }, cors);
    }

    if (action === 'getCameraStatus') {
      const { loc, error } = await getLocationWithCamera(body.locationId, payload);
      if (error) return json(error.status, { error: error.message }, cors);
      if (!loc.cameraUrl) return json(400, { error: 'Camera URL not set for this location' }, cors);
      let connected = false;
      let piHealth = null;
      let latestResult = null;
      try { piHealth = await proxyToPi(loc.cameraUrl, '/health'); connected = true; } catch (e) { piHealth = { error: e.message }; }
      if (connected) {
        try { latestResult = await proxyToPi(loc.cameraUrl, '/api/latest-result'); } catch (e) { latestResult = null; }
      }
      return json(200, {
        success: true,
        connected,
        locationId: loc.id,
        locationName: loc.name,
        cameraUrl: loc.cameraUrl,
        cameraEnabled: loc.cameraEnabled,
        autoScanEnabled: loc.autoScanEnabled,
        autoScanInterval: loc.autoScanInterval,
        lastScanAt: loc.lastScanAt,
        lastScanCount: loc.lastScanCount,
        piHealth,
        latestResult,
      }, cors);
    }

    if (action === 'triggerScan') {
      const { loc, error } = await getLocationWithCamera(body.locationId, payload);
      if (error) return json(error.status, { error: error.message }, cors);
      if (!loc.cameraUrl) return json(400, { error: 'Camera URL not set for this location' }, cors);
      const r = await performScan(loc);
      return json(200, { success: true, peopleCount: r.peopleCount, timestamp: r.timestamp, piResult: r.piResult, recordId: r.recordId }, cors);
    }

    if (action === 'updateCameraSettings') {
      const { loc, error } = await getLocationWithCamera(body.locationId, payload);
      if (error) return json(error.status, { error: error.message }, cors);
      const s = body.settings || {};
      const fields = {};
      if (typeof s.cameraUrl === 'string') {
        const u = s.cameraUrl.trim();
        if (u && !/^https?:\/\//i.test(u)) return json(400, { error: 'Camera URL must start with http:// or https://' }, cors);
        fields.CameraUrl = u;
      }
      if (typeof s.cameraEnabled === 'boolean') fields.CameraEnabled = s.cameraEnabled ? 'true' : 'false';
      if (typeof s.autoScanEnabled === 'boolean') fields.AutoScanEnabled = s.autoScanEnabled ? 'true' : 'false';
      if (s.autoScanInterval !== undefined) {
        const n = Math.max(30, parseInt(s.autoScanInterval, 10) || 60);
        fields.AutoScanInterval = String(n);
      }
      await atUpdate('Locations', loc.id, fields);
      return json(200, { success: true }, cors);
    }

    if (action === 'getLatestDebugImage') {
      const { loc, error } = await getLocationWithCamera(body.locationId, payload);
      if (error) return json(error.status, { error: error.message }, cors);
      if (!loc.cameraUrl) return json(400, { error: 'Camera URL not set for this location' }, cors);
      try {
        const { contentType, buffer } = await proxyBinaryToPi(loc.cameraUrl, '/api/latest-debug-image');
        return {
          statusCode: 200,
          headers: {
            ...cors,
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
          },
          body: buffer.toString('base64'),
          isBase64Encoded: true,
        };
      } catch (e) {
        return json(502, { error: e.message }, cors);
      }
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
