const RESEND_API = 'https://api.resend.com/emails';
const FROM = process.env.EMAIL_FROM || 'Observer <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://observer-backend.netlify.app';

export async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return { ok: false, skipped: true };
  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('Resend error', r.status, detail);
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export function appUrl() { return APP_URL; }

function row(label, value) {
  return `<tr><td style="padding:6px 12px 6px 0;color:#5C5750;font-size:13px;vertical-align:top">${label}</td><td style="padding:6px 0;color:#18160F;font-size:13px">${value}</td></tr>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function tplObserverRegistration({ name, username }) {
  const ts = new Date().toLocaleString();
  return {
    subject: `New observer registration request — ${name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#18160F">
      <h2 style="margin:0 0 12px">New observer registration</h2>
      <table>${row('Name', escapeHtml(name))}${row('Observer ID', escapeHtml(username))}${row('Submitted', escapeHtml(ts))}</table>
      <p style="margin-top:16px"><a href="${APP_URL}" style="color:#1B3A2D">Review in dashboard →</a></p>
    </div>`,
  };
}

export function tplBusinessRegistration({ businessName, contactPerson, email, businessType, requestedLocations, phone, description }) {
  const locs = Array.isArray(requestedLocations) ? requestedLocations.join(', ') : '';
  return {
    subject: `New business registration request — ${businessName}`,
    html: `<div style="font-family:Arial,sans-serif;color:#18160F">
      <h2 style="margin:0 0 12px">New business registration</h2>
      <table>
        ${row('Business name', escapeHtml(businessName))}
        ${row('Contact person', escapeHtml(contactPerson))}
        ${row('Email', escapeHtml(email))}
        ${row('Business type', escapeHtml(businessType))}
        ${row('Requested locations', escapeHtml(locs) || '—')}
        ${row('Phone', escapeHtml(phone) || '—')}
        ${row('Description', escapeHtml(description) || '—')}
      </table>
      <p style="margin-top:16px"><a href="${APP_URL}" style="color:#1B3A2D">Review in dashboard →</a></p>
    </div>`,
  };
}

export function tplApproved({ username }) {
  return {
    subject: 'Your Observer account has been approved',
    html: `<div style="font-family:Arial,sans-serif;color:#18160F">
      <p>Your account <strong>${escapeHtml(username)}</strong> has been approved.</p>
      <p>Sign in at <a href="${APP_URL}" style="color:#1B3A2D">${APP_URL}</a></p>
    </div>`,
  };
}

export function tplRejected() {
  const adminEmail = process.env.ADMIN_EMAIL || '';
  const contact = adminEmail ? `Contact <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a> for more information.` : 'Contact an administrator for more information.';
  return {
    subject: 'Update on your Observer account request',
    html: `<div style="font-family:Arial,sans-serif;color:#18160F">
      <p>Your account request has been reviewed and was not approved at this time.</p>
      <p>${contact}</p>
    </div>`,
  };
}

export function tplPasswordReset({ code }) {
  return {
    subject: 'Your Observer password reset code',
    html: `<div style="font-family:Arial,sans-serif;color:#18160F">
      <p>Your reset code is:</p>
      <p style="font-family:monospace;font-size:22px;letter-spacing:3px;background:#F7F5F2;padding:14px 18px;border-radius:8px;display:inline-block">${escapeHtml(code)}</p>
      <p>Valid for 1 hour.</p>
      <p>If you didn't request this, you can safely ignore the email.</p>
    </div>`,
  };
}
