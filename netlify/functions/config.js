import { atGet, atCreate, atUpdate, verifyToken, corsHeaders, json, parseBody } from './_utils.js';

const DEFAULT_CONFIG = {
  ages: ['Under 18', '18–24', '25–34', '35–44', '45–59', '60+'],
  genders: ['Male', 'Female', 'Non-binary', 'Unclear'],
  ethnicities: ['Asian', 'Black', 'Hispanic / Latino', 'Middle Eastern', 'Pacific Islander', 'White', 'Mixed / other', 'Unclear'],
  disabilities: ['None observed', 'Wheelchair', 'Walking aid', 'Visual aid', 'Hearing aid', 'Prosthetic'],
  emotions: ['Happy', 'Neutral', 'Confused', 'Frustrated', 'Distressed'],
};

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  try {
    if (action === 'getConfig') {
      const payload = await verifyToken(event, body);
      if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

      let data;
      try { data = await atGet('FieldConfig', ''); } catch { return json(200, { success: true, config: DEFAULT_CONFIG }, cors); }
      if (!data.records.length) return json(200, { success: true, config: DEFAULT_CONFIG }, cors);

      const f = data.records[0].fields;
      return json(200, { success: true, config: {
        ages: f.Ages ? f.Ages.split('\n').filter(Boolean) : DEFAULT_CONFIG.ages,
        genders: f.Genders ? f.Genders.split('\n').filter(Boolean) : DEFAULT_CONFIG.genders,
        ethnicities: f.Ethnicities ? f.Ethnicities.split('\n').filter(Boolean) : DEFAULT_CONFIG.ethnicities,
        disabilities: f.Disabilities ? f.Disabilities.split('\n').filter(Boolean) : DEFAULT_CONFIG.disabilities,
        emotions: f.Emotions ? f.Emotions.split('\n').filter(Boolean) : DEFAULT_CONFIG.emotions,
      }}, cors);
    }

    if (action === 'updateConfig') {
      const payload = await verifyToken(event, body);
      if (!payload) return json(401, { error: 'Session expired.' }, cors);
      if (payload.role !== 'Admin') return json(403, { error: 'Admin access required' }, cors);

      const { config } = body;
      const fields = {
        Ages: (config.ages || []).join('\n'),
        Genders: (config.genders || []).join('\n'),
        Ethnicities: (config.ethnicities || []).join('\n'),
        Disabilities: (config.disabilities || []).join('\n'),
        Emotions: (config.emotions || []).join('\n'),
      };

      let data;
      try { data = await atGet('FieldConfig', ''); } catch { data = { records: [] }; }
      if (data.records.length) await atUpdate('FieldConfig', data.records[0].id, fields);
      else await atCreate('FieldConfig', fields);

      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
