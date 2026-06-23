/**
 * Send verification emails via Cloudflare Email Service.
 */

import type { SendEmail } from '@cloudflare/workers-types';

interface SendEmailBody {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Build and send a verification email.
 */
export async function sendVerificationEmail(
  sendEmail: SendEmail,
  to: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  const text = [
    'Welcome to BitsNotes!',
    '',
    'Verify your email address by clicking the link below:',
    verifyUrl,
    '',
    'This link expires in 24 hours.',
    '',
    'If you did not create an account, you can safely ignore this email.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
  <h2 style="color: #0f766e; margin-bottom: 8px;">Welcome to BitsNotes!</h2>
  <p>Verify your email address to activate your account:</p>
  <p style="margin: 24px 0;">
    <a href="${verifyUrl}"
       style="display:inline-block; background:#0f766e; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">
      Verify Email
    </a>
  </p>
  <p style="font-size:14px; color:#666;">Or copy this link:<br><a href="${verifyUrl}" style="color:#0f766e;">${verifyUrl}</a></p>
  <hr style="border:none; border-top:1px solid #e5e5e5; margin:24px 0;">
  <p style="font-size:13px; color:#999;">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
</body>
</html>`;

  const emailBody: SendEmailBody = {
    from: 'BitsNotes <noreply@bitsnotes.com>',
    to,
    subject: 'Verify your BitsNotes email',
    text,
    html,
  };

  // Build raw MIME message
  const raw = buildMimeMessage(emailBody);

  const message = new (globalThis as any).EmailMessage(
    'BitsNotes <noreply@bitsnotes.com>',
    to,
    raw,
  );

  await sendEmail.send(message);
}

function buildMimeMessage(body: SendEmailBody): string {
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const lines = [
    `From: ${body.from}`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    '',
    body.text,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    '',
    body.html,
    '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}
