import { atGetAll, verifyToken, corsHeaders, json, parseBody } from './_utils.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    const payload = await verifyToken(event, body);
    if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

    if (action === 'getObservations') {
      const formula = payload.role === 'Admin' ? '' : `{Observer}="${payload.username}"`;
      const records = await atGetAll('Observations', formula);
      const observations = records.map(r => ({
        entryId: r.fields['Entry ID'] || '',
        timestamp: r.fields['Timestamp'] || '',
        type: r.fields['Type'] || '',
        observer: r.fields['Observer'] || '',
        location: r.fields['Location'] || '',
        session: r.fields['Session'] || '',
        personNum: r.fields['Person #'] || '',
        age: r.fields['Age'] || '',
        gender: r.fields['Gender'] || '',
        ethnicity: r.fields['Ethnicity'] || '',
        disability: r.fields['Disability'] || '',
        emotion: r.fields['Emotion'] || '',
        missed: r.fields['Missed'] || 'NO',
      }));
      return json(200, { success: true, observations, total: observations.length }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
