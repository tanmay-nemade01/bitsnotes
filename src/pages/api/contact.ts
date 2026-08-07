import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { EmailMessage } from 'cloudflare:email';
import { getEnv, getClientIp, tooMany, serverError } from '../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const appEnv = await getEnv();

    if (!validateOrigin(request, appEnv.APP_BASE_URL || 'https://bitsnotes.com')) {
      return csrfForbidden();
    }

    if (appEnv.CONTACT_RATE_LIMITER) {
      const ip = getClientIp(request);
      const { success } = await appEnv.CONTACT_RATE_LIMITER.limit({ key: `contact:${ip}` });
      if (!success) return tooMany('Too many requests. Please try again later.');
    }

    const body = await request.json() as Record<string, unknown>;
    const name = body.name as string | undefined;
    const email = body.email as string | undefined;
    const subject = body.subject as string | undefined;
    const message = body.message as string | undefined;
    const _website = body._website as string | undefined;

    // Honeypot: if a bot filled the hidden field, silently accept but don't send
    if (_website) {
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate inputs
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'All fields (name, email, subject, message) are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Strip CRLF from header-injectable fields to prevent email header injection
    const sanitize = (s: string) => s.replace(/[\r\n]/g, '').trim();

    const safeName = sanitize(name).slice(0, 100);
    const safeEmail = sanitize(email);
    const safeSubject = sanitize(subject).slice(0, 150);
    const safeMessage = (message || '').slice(0, 5000);

    // Re-check after sanitization
    if (!safeName || !safeEmail || !safeSubject || !safeMessage) {
      return new Response(
        JSON.stringify({ error: 'All fields (name, email, subject, message) are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(safeEmail)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sender = 'contact-form@bitsnotes.com'; // Must be a verified address/domain in Cloudflare Email Routing
    const recipient = 'support@bitsnotes.com';
    const messageId = `<${crypto.randomUUID()}@bitsnotes.com>`;

    // Construct raw RFC2822/MIME plaintext email message
    // Setting Reply-To lets support agents reply directly to the submitter's email
    const mimeText = [
      `Message-ID: ${messageId}`,
      `From: BitsNotes Contact Form <${sender}>`,
      `To: ${recipient}`,
      `Reply-To: ${safeName} <${safeEmail}>`,
      `Subject: [Contact Form] ${safeSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      `You received a new message from the BitsNotes Contact Form:`,
      ``,
      `Name: ${safeName}`,
      `Email: ${safeEmail}`,
      `Subject: ${safeSubject}`,
      ``,
      `Message:`,
      `--------------------------------------------------`,
      safeMessage,
      `--------------------------------------------------`,
      ``,
      `Sent via BitsNotes Cloudflare Email Routing.`
    ].join('\r\n');

    // Retrieve SEND_EMAIL binding
    const emailBinding = (env as any).SEND_EMAIL;

    if (!emailBinding) {
      // Demo/local: acknowledge without echoing PII to logs
      console.log('[Contact API] SEND_EMAIL binding inactive — simulated accept');
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: 'Demo Mode: Message accepted (email binding not active).'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send email using Cloudflare Email Service binding
    const emailMessage = new EmailMessage(sender, recipient, mimeText);
    await emailBinding.send(emailMessage);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('[Contact API] Internal server error:', error);
    return serverError('Server failed to process your request. Please try again later.');
  }
};
