// Required Netlify env vars: GOOGLE_PLACES_API_KEY, YELP_API_KEY
// Also required (already used elsewhere): AIRTABLE_TOKEN, AIRTABLE_BASE_ID, JWT_SECRET, ALLOWED_ORIGIN
import { verifyToken, corsHeaders, json, parseBody, checkRateLimit, getClientIP } from './_utils.js';

const GOOGLE_TEXT_SEARCH = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const GOOGLE_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';
const YELP_SEARCH = 'https://api.yelp.com/v3/businesses/search';
const YELP_DETAILS = 'https://api.yelp.com/v3/businesses';

function mapType(categories = []) {
  const blob = categories.map(c => String(c).toLowerCase()).join(' ');
  if (/(restaurant|food|cafe|coffee|bar|bakery|meal)/.test(blob)) return 'Restaurant';
  if (/(event|venue|theater|stadium|concert|festival)/.test(blob)) return 'Event';
  if (/(store|shop|retail|mall|market|boutique|clothing|grocery)/.test(blob)) return 'Retail';
  return 'Other';
}

function googlePhotoUrl(photoRef, key) {
  if (!photoRef) return '';
  return `${GOOGLE_TEXT_SEARCH.replace('textsearch/json','photo')}?maxwidth=600&photo_reference=${encodeURIComponent(photoRef)}&key=${encodeURIComponent(key)}`;
}

function normalizeGoogle(place, key) {
  const types = place.types || [];
  return {
    source: 'google',
    placeId: place.place_id || '',
    name: place.name || '',
    address: place.formatted_address || place.vicinity || '',
    type: mapType(types),
    phone: place.formatted_phone_number || place.international_phone_number || '',
    website: place.website || '',
    hours: (place.opening_hours?.weekday_text || []).join('\n'),
    description: place.editorial_summary?.overview || '',
    rating: typeof place.rating === 'number' ? place.rating : 0,
    photoUrl: place.photos?.[0]?.photo_reference ? googlePhotoUrl(place.photos[0].photo_reference, key) : '',
    rawCategories: types,
  };
}

function normalizeYelp(biz) {
  const cats = (biz.categories || []).map(c => c.title);
  const addrParts = biz.location?.display_address || [biz.location?.address1, biz.location?.city, biz.location?.state, biz.location?.zip_code].filter(Boolean);
  const hours = (biz.hours?.[0]?.open || []).map(h => `${h.day != null ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][h.day] : ''} ${h.start}-${h.end}`).join('\n');
  return {
    source: 'yelp',
    placeId: biz.id || '',
    name: biz.name || '',
    address: Array.isArray(addrParts) ? addrParts.join(', ') : '',
    type: mapType(cats),
    phone: biz.display_phone || biz.phone || '',
    website: biz.url || '',
    hours,
    description: '',
    rating: typeof biz.rating === 'number' ? biz.rating : 0,
    photoUrl: biz.image_url || '',
    rawCategories: cats,
  };
}

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  // Allow unauthenticated calls from the registration form, but rate-limit aggressively.
  // Authenticated calls (Business / Admin) get a more generous limit via the standard window.
  const payload = await verifyToken(event, body);
  const ip = getClientIP(event);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) return json(429, { error: `Too many requests. Try again in ${rl.resetIn} minutes.` }, cors);
  if (payload && payload.role !== 'Business' && payload.role !== 'Admin') {
    return json(403, { error: 'Forbidden' }, cors);
  }

  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  const yelpKey = process.env.YELP_API_KEY;

  try {
    if (action === 'searchBusinesses') {
      const { query, location, source } = body;
      if (!query) return json(400, { error: 'Query required' }, cors);
      const src = source === 'yelp' ? 'yelp' : 'google';

      if (src === 'google') {
        if (!googleKey) return json(500, { error: 'Google Places API key not configured' }, cors);
        const q = location ? `${query} ${location}` : query;
        const url = `${GOOGLE_TEXT_SEARCH}?query=${encodeURIComponent(q)}&key=${encodeURIComponent(googleKey)}`;
        const r = await fetch(url);
        if (!r.ok) return json(502, { error: 'Google Places error' }, cors);
        const data = await r.json();
        const results = (data.results || []).slice(0, 8).map(p => normalizeGoogle(p, googleKey));
        return json(200, { success: true, results }, cors);
      }

      if (!yelpKey) return json(500, { error: 'Yelp API key not configured' }, cors);
      const url = `${YELP_SEARCH}?term=${encodeURIComponent(query)}&location=${encodeURIComponent(location || '')}&limit=8`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${yelpKey}` }});
      if (!r.ok) return json(502, { error: 'Yelp error' }, cors);
      const data = await r.json();
      const results = (data.businesses || []).map(normalizeYelp);
      return json(200, { success: true, results }, cors);
    }

    if (action === 'getBusinessDetails') {
      const { placeId, source } = body;
      if (!placeId) return json(400, { error: 'placeId required' }, cors);
      const src = source === 'yelp' ? 'yelp' : 'google';

      if (src === 'google') {
        if (!googleKey) return json(500, { error: 'Google Places API key not configured' }, cors);
        const fields = 'place_id,name,formatted_address,formatted_phone_number,international_phone_number,website,opening_hours,rating,photos,types,editorial_summary';
        const url = `${GOOGLE_DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=${encodeURIComponent(fields)}&key=${encodeURIComponent(googleKey)}`;
        const r = await fetch(url);
        if (!r.ok) return json(502, { error: 'Google Places error' }, cors);
        const data = await r.json();
        if (!data.result) return json(404, { error: 'Not found' }, cors);
        return json(200, { success: true, result: normalizeGoogle(data.result, googleKey) }, cors);
      }

      if (!yelpKey) return json(500, { error: 'Yelp API key not configured' }, cors);
      const url = `${YELP_DETAILS}/${encodeURIComponent(placeId)}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${yelpKey}` }});
      if (!r.ok) return json(502, { error: 'Yelp error' }, cors);
      const data = await r.json();
      return json(200, { success: true, result: normalizeYelp(data) }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
