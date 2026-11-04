import nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------------------------
// Email delivery
//
// Three transports are supported. Pick one with EMAIL_PROVIDER, or leave it unset and the first
// configured one wins in this order: smtp -> brevo -> resend.
//
//   EMAIL_PROVIDER=brevo   BREVO_API_KEY + EMAIL_FROM   (HTTPS, port 443)  <- recommended on Render
//   EMAIL_PROVIDER=resend  RESEND_API_KEY + EMAIL_FROM  (HTTPS, port 443)
//   EMAIL_PROVIDER=smtp    SMTP_HOST/PORT/USER/PASSWORD/FROM (works locally, and on hosts that
//                          allow outbound SMTP. Render's free tier blocks ports 25/465/587.)
//
// The HTTPS providers exist because many PaaS hosts block outbound SMTP, which shows up as a
// connection timeout even though the same Gmail credentials work on localhost.
// ---------------------------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 15_000;

function smtpSettings() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  };
}

function isSmtpConfigured() {
  const smtp = smtpSettings();
  return Boolean(smtp.host && smtp.port && smtp.user && smtp.password && smtp.from);
}

const isBrevoConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM);
const isResendConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

function selectedProvider() {
  const explicit = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit) {
    if (!['smtp', 'brevo', 'resend'].includes(explicit)) return null;
    const ready = { smtp: isSmtpConfigured, brevo: isBrevoConfigured, resend: isResendConfigured }[explicit]();
    return ready ? explicit : null;
  }
  if (isSmtpConfigured()) return 'smtp';
  if (isBrevoConfigured()) return 'brevo';
  if (isResendConfigured()) return 'resend';
  return null;
}

export function isEmailConfigured() {
  // Never send real email from automated tests. Invitation tests rely on the development
  // link so they can exercise token hashing/acceptance without external email side effects.
  if (process.env.NODE_ENV === 'test') return false;
  return selectedProvider() !== null;
}

// "DevFlow <no-reply@example.com>" -> { name: 'DevFlow', email: 'no-reply@example.com' }
function parseAddress(value) {
  const match = String(value).match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) return { name: (match[1] || '').trim() || undefined, email: match[2].trim() };
  return { name: undefined, email: String(value).trim() };
}

async function postJson(url, headers, body, label) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${label} request failed: ${error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} rejected the email (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function deliver({ to, subject, text, html }) {
  const provider = selectedProvider();
  if (!provider || process.env.NODE_ENV === 'test') {
    throw new Error('Email settings are incomplete. Configure EMAIL_PROVIDER with its credentials.');
  }

  if (provider === 'brevo') {
    const sender = parseAddress(process.env.EMAIL_FROM);
    return postJson(
      'https://api.brevo.com/v3/smtp/email',
      { 'api-key': process.env.BREVO_API_KEY },
      { sender, to: [{ email: to }], subject, htmlContent: html, textContent: text },
      'Brevo',
    );
  }

  if (provider === 'resend') {
    return postJson(
      'https://api.resend.com/emails',
      { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: process.env.EMAIL_FROM, to: [to], subject, html, text },
      'Resend',
    );
  }

  const smtp = smtpSettings();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    // Fail in seconds instead of hanging the HTTP request for ~2 minutes when the host
    // blocks outbound SMTP.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    return await transporter.sendMail({ from: smtp.from, to, subject, text, html });
  } catch (error) {
    if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED'].includes(error.code)) {
      error.message += ' (outbound SMTP looks blocked by the host; Render free services block ports 25/465/587. Use EMAIL_PROVIDER=brevo or resend.)';
    } else if (error.code === 'EAUTH') {
      error.message += ' (for Gmail use a 16-character App Password, not your account password)';
    }
    throw error;
  }
}

export async function sendInvitationEmail({
  to,
  workspaceName,
  inviterName,
  role,
  invitationUrl,
}) {
  if (!isEmailConfigured()) {
    throw new Error('Email settings are incomplete.');
  }

  const senderName = inviterName || 'A teammate';

  const text = [
    `Hi,`,
    '',
    `${senderName} invited you to join ${workspaceName} on DevFlow as a ${role}.`,
    '',
    'Accept your invitation using this link:',
    invitationUrl,
    '',
    'This invitation expires in 7 days.',
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 24px;">
      <h2>You're invited to DevFlow</h2>
      <p>
        ${escapeHtml(senderName)} invited you to join
        <strong>${escapeHtml(workspaceName)}</strong>
        as a <strong>${escapeHtml(role)}</strong>.
      </p>
      <p style="margin: 28px 0;">
        <a
          href="${escapeHtml(invitationUrl)}"
          style="background: #2563eb; color: white; padding: 12px 20px;
                 text-decoration: none; border-radius: 6px; display: inline-block;"
        >
          Accept Invitation
        </a>
      </p>
      <p>This invitation expires in 7 days.</p>
      <p style="color: #666; font-size: 13px;">
        If you were not expecting this invitation, you can ignore this email.
      </p>
    </div>
  `;

  return deliver({
    to,
    subject: `You're invited to join ${workspaceName} on DevFlow`,
    text,
    html,
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export async function sendAccountEmail({ to, subject, heading, message, actionLabel, actionUrl, expiryText }) {
  if (!isEmailConfigured()) throw new Error('Email settings are incomplete.');
  const safeHeading = escapeHtml(heading);
  const safeMessage = escapeHtml(message);
  const safeLabel = escapeHtml(actionLabel);
  const safeUrl = escapeHtml(actionUrl);
  const text = `${heading}\n\n${message}\n\n${actionLabel}: ${actionUrl}\n\n${expiryText}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>${safeHeading}</h2><p>${safeMessage}</p><p style="margin:28px 0"><a href="${safeUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">${safeLabel}</a></p><p>${escapeHtml(expiryText)}</p><p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p></div>`;
  return deliver({ to, subject, text, html });
}