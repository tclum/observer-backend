import { atGet, atGetAll, atCreate, atUpdate, verifyToken, corsHeaders, json, parseBody } from './_utils.js';
import { sendEmail, tplJobSubmitted, tplJobApproved, tplJobRejected } from './_email.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  const payload = await verifyToken(event, body);
  if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

  const isAdmin = async () => {
    if (payload.role !== 'Admin') return false;
    const d = await atGet('Users', `AND({Username}="${payload.username}",{Role}="Admin",{Status}="Active")`);
    return d.records.length > 0;
  };

  try {
    if (action === 'submitJobRequest') {
      if (payload.role !== 'Business') return json(403, { error: 'Only businesses can submit job requests' }, cors);
      const { locationName, type, targetCount, deadline, instructions, reward } = body;
      if (!locationName || !type) return json(400, { error: 'Location and job type are required' }, cors);

      const fields = {
        BusinessUsername: payload.username,
        BusinessName: payload.name || payload.username,
        LocationName: String(locationName).trim(),
        Type: String(type).trim(),
        TargetCount: Number(targetCount) || 0,
        Deadline: deadline || '',
        Instructions: instructions || '',
        Reward: reward || '',
        Status: 'Pending',
        CreatedAt: new Date().toISOString(),
      };
      const created = await atCreate('Jobs', fields);

      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const tpl = tplJobSubmitted(fields);
        sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
      }
      return json(200, { success: true, id: created.records?.[0]?.id }, cors);
    }

    if (action === 'getJobs') {
      const { status } = body;
      let formula = '';
      if (status) formula = `{Status}="${status}"`;
      if (payload.role === 'Business') {
        const biz = `{BusinessUsername}="${payload.username}"`;
        formula = formula ? `AND(${formula},${biz})` : biz;
      } else if (payload.role === 'Observer') {
        const open = `{Status}="Open"`;
        formula = status ? formula : open;
      }
      const records = await atGetAll('Jobs', formula);
      const jobs = records.map(r => ({
        id: r.id,
        businessUsername: r.fields.BusinessUsername || '',
        businessName: r.fields.BusinessName || '',
        locationName: r.fields.LocationName || '',
        type: r.fields.Type || '',
        targetCount: r.fields.TargetCount || 0,
        deadline: r.fields.Deadline || '',
        instructions: r.fields.Instructions || '',
        reward: r.fields.Reward || '',
        status: r.fields.Status || '',
        createdAt: r.fields.CreatedAt || '',
        approvedAt: r.fields.ApprovedAt || '',
        approvedBy: r.fields.ApprovedBy || '',
      }));
      return json(200, { success: true, jobs }, cors);
    }

    if (action === 'updateJob') {
      if (!(await isAdmin())) return json(403, { error: 'Admin access required' }, cors);
      const { jobId, status } = body;
      if (!jobId || !status) return json(400, { error: 'jobId and status required' }, cors);
      if (!['Open', 'Rejected', 'Closed'].includes(status)) return json(400, { error: 'Invalid status' }, cors);

      const fields = { Status: status };
      if (status === 'Open' || status === 'Rejected') {
        fields.ApprovedAt = new Date().toISOString();
        fields.ApprovedBy = payload.username;
      }
      await atUpdate('Jobs', jobId, fields);

      try {
        const fresh = await atGet('Jobs', `RECORD_ID()="${jobId}"`);
        const j = fresh.records[0]?.fields;
        if (j?.BusinessUsername) {
          const bizUser = await atGet('Users', `{Username}="${j.BusinessUsername}"`);
          const email = bizUser.records[0]?.fields?.Email;
          if (email) {
            const tpl = status === 'Open' ? tplJobApproved(j) : status === 'Rejected' ? tplJobRejected(j) : null;
            if (tpl) sendEmail(email, tpl.subject, tpl.html).catch(() => {});
          }
        }
      } catch (e) { /* fire and forget */ }

      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
