import { atGetAll, verifyToken } from './_utils.js';

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

    if (action === 'getObservations') {
      // Observers only see their own data
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
      return res.status(200).json({ success: true, observations, total: observations.length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
