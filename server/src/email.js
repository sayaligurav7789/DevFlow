
import nodemailer from 'nodemailer';

const smtp = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.SMTP_FROM,
};

export function isEmailConfigured() {
  return Boolean(
    smtp.host &&
    smtp.port &&
    smtp.user &&
    smtp.password &&
    smtp.from
  );
}

export async function sendInvitationEmail({
  to,
  workspaceName,
  inviterName,
  role,
  invitationUrl,
}) {
  if (!isEmailConfigured()) {
    throw new Error('SMTP email settings are incomplete.');
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.password,
    },
  });

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

  return transporter.sendMail({
    from: smtp.from,
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
  if (!isEmailConfigured()) throw new Error('SMTP email settings are incomplete.');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
  });
  const safeHeading = escapeHtml(heading);
  const safeMessage = escapeHtml(message);
  const safeLabel = escapeHtml(actionLabel);
  const safeUrl = escapeHtml(actionUrl);
  const text = `${heading}\n\n${message}\n\n${actionLabel}: ${actionUrl}\n\n${expiryText}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>${safeHeading}</h2><p>${safeMessage}</p><p style="margin:28px 0"><a href="${safeUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">${safeLabel}</a></p><p>${escapeHtml(expiryText)}</p><p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p></div>`;
  return transporter.sendMail({ from: smtp.from, to, subject, text, html });
}
