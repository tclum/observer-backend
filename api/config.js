import { atGet, atCreate, atUpdate, verifyToken, setCorsHeaders } from './_utils.js';

const DEFAULT_CONFIG = {
  ages: ['Under 18', '18–24', '25–34', '35–44', '45–59', '60+'],
  genders: ['Male', 'Female', 'Non-binary', 'Unclear'],
  ethnicities: ['Asian', 'Black', 'Hispanic / Latino', 'Middle Eastern', 'Pacific Islander', 'White', 'Mixed / other', 'Unclear'],
  disabilities: ['None observed', 'Wheelchair', 'Walking aid', 'Visual aid', 'Hearing aid', 'Prosthetic'],
  emotions: ['Happy', 'Neutral', 'Confused', 'Frustrated', 'Distressed'],
};

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    // ── GET CONFIG (any authenticated user) ──
    if (action === 'getConfig') {
      const payload = await verifyToken(req);
      if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' });

      let data;
      try { data = await atGet('FieldConfig', ''); } catch { return res.status(200).json({ success: true, config: DEFAULT_CONFIG }); }
      if (!data.records.length) return res.status(200).json({ success: true, config: DEFAULT_CONFIG });

      const f = data.records[0].fields;
      return res.status(200).json({ success: true, config: {
        ages: f.Ages ? f.Ages.split('\n').filter(Boolean) : DEFAULT_CONFIG.ages,
        genders: f.Genders ? f.Genders.split('\n').filter(Boolean) : DEFAULT_CONFIG.genders,
        ethnicities: f.Ethnicities ? f.Ethnicities.split('\n').filter(Boolean) : DEFAULT_CONFIG.ethnicities,
        disabilities: f.Disabilities ? f.Disabilities.split('\n').filter(Boolean) : DEFAULT_CONFIG.disabilities,
        emotions: f.Emotions ? f.Emotions.split('\n').filter(Boolean) : DEFAULT_CONFIG.emotions,
      }});
    }

    // ── UPDATE CONFIG (admin only) ──
    if (action === 'updateConfig') {
      const payload = await verifyToken(req);
      if (!payload) return res.status(401).json({ error: 'Session expired.' });
      if (payload.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });

      const { config } = req.body;
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

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
