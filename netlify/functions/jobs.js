import { atGet, atGetAll, atCreate, atUpdate, verifyToken, corsHeaders, json, parseBody } from './_utils.js';
import {
  sendEmail,
  tplJobApplication,
  tplApplicationApproved,
  tplApplicationRejected,
} from './_email.js';

export const handler = async (event) => {
  const cors = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const body = parseBody(event);
  const { action } = body;

  const payload = await verifyToken(event, body);
  if (!payload) return json(401, { error: 'Session expired. Please sign in again.' }, cors);

  const isAdmin = payload.role === 'Admin';
  const isBusiness = payload.role === 'Business';
  const isObserver = payload.role === 'Observer';

  const jobToObj = r => ({
    id: r.id,
    jobId: r.fields.JobID || '',
    title: r.fields.Title || '',
    description: r.fields.Description || '',
    locationId: r.fields.LocationID || '',
    locationName: r.fields.LocationName || '',
    businessUsername: r.fields.BusinessUsername || '',
    businessName: r.fields.BusinessName || '',
    status: r.fields.Status || 'Open',
    createdAt: r.fields.CreatedAt || '',
    requiredSessions: r.fields.RequiredSessions || '',
    notes: r.fields.Notes || '',
  });

  const appToObj = r => ({
    id: r.id,
    applicationId: r.fields.ApplicationID || '',
    jobId: r.fields.JobID || '',
    jobTitle: r.fields.JobTitle || '',
    locationName: r.fields.LocationName || '',
    businessUsername: r.fields.BusinessUsername || '',
    observerUsername: r.fields.ObserverUsername || '',
    observerName: r.fields.ObserverName || '',
    status: r.fields.Status || 'Pending',
    appliedAt: r.fields.AppliedAt || '',
    notes: r.fields.Notes || '',
  });

  try {
    // ── JOBS ──
    if (action === 'getJobs') {
      let formula = '';
      if (isBusiness) formula = `{BusinessUsername}="${payload.username}"`;
      else if (isObserver) formula = `{Status}="Open"`;
      const records = await atGetAll('Jobs', formula);
      return json(200, { success: true, jobs: records.map(jobToObj) }, cors);
    }

    if (action === 'createJob') {
      if (!isAdmin && !isBusiness) return json(403, { error: 'Only businesses or admins can create jobs' }, cors);
      const { title, description, locationId, requiredSessions, notes } = body;
      if (!title || !locationId) return json(400, { error: 'Title and location are required' }, cors);

      const locRes = await atGet('Locations', `RECORD_ID()="${locationId}"`);
      const loc = locRes.records[0];
      if (!loc) return json(400, { error: 'Location not found' }, cors);

      const locBusinessUsername = loc.fields.BusinessUsername || '';
      if (isBusiness && locBusinessUsername !== payload.username) {
        return json(403, { error: 'You can only post jobs for your own locations' }, cors);
      }
      if (loc.fields.Active === false) {
        return json(400, { error: 'Location is not active yet' }, cors);
      }

      const businessUsername = isBusiness ? payload.username : (locBusinessUsername || payload.username);
      let businessName = isBusiness ? (payload.name || payload.username) : (loc.fields.BusinessName || '');
      if (!businessName && businessUsername) {
        const u = await atGet('Users', `{Username}="${businessUsername}"`);
        businessName = u.records[0]?.fields?.Name || businessUsername;
      }

      const jobIdStr = 'job_' + Date.now();
      const created = await atCreate('Jobs', {
        JobID: jobIdStr,
        Title: title,
        Description: description || '',
        LocationID: locationId,
        LocationName: loc.fields.Name || '',
        BusinessUsername: businessUsername,
        BusinessName: businessName,
        Status: 'Open',
        CreatedAt: new Date().toISOString(),
        RequiredSessions: requiredSessions || '',
        Notes: notes || '',
      });
      return json(200, { success: true, id: created.records?.[0]?.id, jobId: jobIdStr }, cors);
    }

    if (action === 'updateJob') {
      if (!isAdmin && !isBusiness) return json(403, { error: 'Forbidden' }, cors);
      const { recordId, fields } = body;
      if (!recordId) return json(400, { error: 'recordId required' }, cors);
      const existing = await atGet('Jobs', `RECORD_ID()="${recordId}"`);
      const job = existing.records[0];
      if (!job) return json(404, { error: 'Job not found' }, cors);
      if (isBusiness && job.fields.BusinessUsername !== payload.username) {
        return json(403, { error: 'You can only update your own jobs' }, cors);
      }
      const allowed = {};
      ['Title', 'Description', 'Status', 'RequiredSessions', 'Notes'].forEach(k => {
        if (fields && fields[k] !== undefined) allowed[k] = fields[k];
      });
      await atUpdate('Jobs', recordId, allowed);
      return json(200, { success: true }, cors);
    }

    // ── APPLICATIONS ──
    if (action === 'getApplications') {
      let records = [];
      if (isAdmin) {
        records = await atGetAll('Applications', '');
      } else if (isBusiness) {
        records = await atGetAll('Applications', `{BusinessUsername}="${payload.username}"`);
      } else {
        records = await atGetAll('Applications', `{ObserverUsername}="${payload.username}"`);
      }
      return json(200, { success: true, applications: records.map(appToObj) }, cors);
    }

    if (action === 'applyToJob') {
      if (!isObserver) return json(403, { error: 'Only observers can apply to jobs' }, cors);
      const { recordId, notes } = body;
      if (!recordId) return json(400, { error: 'Job recordId required' }, cors);

      const jobRes = await atGet('Jobs', `RECORD_ID()="${recordId}"`);
      const job = jobRes.records[0];
      if (!job) return json(404, { error: 'Job not found' }, cors);
      if (job.fields.Status !== 'Open') return json(400, { error: 'This job is no longer accepting applications' }, cors);

      const jobIdStr = job.fields.JobID || recordId;
      const dup = await atGetAll('Applications', `AND({JobID}="${jobIdStr}",{ObserverUsername}="${payload.username}")`);
      if (dup.length) return json(409, { error: 'You already applied to this job' }, cors);

      const appIdStr = 'app_' + Date.now();
      await atCreate('Applications', {
        ApplicationID: appIdStr,
        JobID: jobIdStr,
        JobTitle: job.fields.Title || '',
        LocationName: job.fields.LocationName || '',
        BusinessUsername: job.fields.BusinessUsername || '',
        ObserverUsername: payload.username,
        ObserverName: payload.name || payload.username,
        Status: 'Pending',
        AppliedAt: new Date().toISOString(),
        Notes: notes || '',
      });

      // notify business + admin (fire-and-forget)
      try {
        const bizUsername = job.fields.BusinessUsername;
        if (bizUsername) {
          const bizUser = await atGet('Users', `{Username}="${bizUsername}"`);
          const bizEmail = bizUser.records[0]?.fields?.Email;
          const tpl = tplJobApplication({
            observerName: payload.name || payload.username,
            jobTitle: job.fields.Title || '',
            locationName: job.fields.LocationName || '',
          });
          if (bizEmail) sendEmail(bizEmail, tpl.subject, tpl.html).catch(() => {});
          const adminEmail = process.env.ADMIN_EMAIL;
          if (adminEmail) sendEmail(adminEmail, tpl.subject, tpl.html).catch(() => {});
        }
      } catch (e) {}

      return json(200, { success: true, applicationId: appIdStr }, cors);
    }

    if (action === 'updateApplication') {
      if (!isAdmin && !isBusiness) return json(403, { error: 'Forbidden' }, cors);
      const { recordId, status, locationId } = body;
      if (!recordId || !status) return json(400, { error: 'recordId and status required' }, cors);
      if (!['Approved', 'Rejected', 'Pending'].includes(status)) return json(400, { error: 'Invalid status' }, cors);

      const appRes = await atGet('Applications', `RECORD_ID()="${recordId}"`);
      const appRec = appRes.records[0];
      if (!appRec) return json(404, { error: 'Application not found' }, cors);
      if (isBusiness && appRec.fields.BusinessUsername !== payload.username) {
        return json(403, { error: 'You can only update applications for your own jobs' }, cors);
      }

      await atUpdate('Applications', recordId, { Status: status });

      // assign to location on approval
      let assignedLocationName = appRec.fields.LocationName || '';
      if (status === 'Approved') {
        let targetLocId = locationId;
        if (!targetLocId) {
          // fallback: find the job's location
          const jobIdStr = appRec.fields.JobID;
          if (jobIdStr) {
            const jobRes = await atGetAll('Jobs', `{JobID}="${jobIdStr}"`);
            const job = jobRes[0];
            if (job?.fields?.LocationID) targetLocId = job.fields.LocationID;
          }
        }
        if (targetLocId) {
          try {
            const locRes = await atGet('Locations', `RECORD_ID()="${targetLocId}"`);
            const loc = locRes.records[0];
            if (loc) {
              const obs = (loc.fields.Observers || '').split(',').map(s => s.trim()).filter(Boolean);
              const obsName = appRec.fields.ObserverUsername;
              if (obsName && !obs.includes(obsName)) obs.push(obsName);
              await atUpdate('Locations', targetLocId, { Observers: obs.join(', ') });
              assignedLocationName = loc.fields.Name || assignedLocationName;
            }
          } catch (e) {}
        }
      }

      // email observer
      try {
        const obsUsername = appRec.fields.ObserverUsername;
        if (obsUsername) {
          const obsUser = await atGet('Users', `{Username}="${obsUsername}"`);
          const obsEmail = obsUser.records[0]?.fields?.Email;
          if (obsEmail) {
            const tpl = status === 'Approved'
              ? tplApplicationApproved({ jobTitle: appRec.fields.JobTitle || '', locationName: assignedLocationName })
              : status === 'Rejected'
                ? tplApplicationRejected({ jobTitle: appRec.fields.JobTitle || '' })
                : null;
            if (tpl) sendEmail(obsEmail, tpl.subject, tpl.html).catch(() => {});
          }
        }
      } catch (e) {}

      return json(200, { success: true }, cors);
    }

    return json(400, { error: 'Unknown action' }, cors);
  } catch (err) {
    return json(500, { error: err.message }, cors);
  }
};
