import type { APIRoute } from 'astro';
import { getEnv, getClientIp, tooMany, serverError, badRequest } from '../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../lib/auth/csrf';

export const prerender = false;

/**
 * Safely resolves the EmailMessage constructor across environments.
 * Cloudflare Workers provides EmailMessage either on globalThis or via 'cloudflare:email'.
 */
async function getEmailMessageConstructor(): Promise<(new (from: string, to: string, raw: string | Uint8Array) => unknown) | null> {
  if (typeof (globalThis as any).EmailMessage !== 'undefined') {
    return (globalThis as any).EmailMessage;
  }
  try {
    const cfEmail = await import('cloudflare:email');
    return cfEmail.EmailMessage as unknown as (new (from: string, to: string, raw: string | Uint8Array) => unknown);
  } catch {
    return null;
  }
}

export const POST: APIRoute = async (context) => {
  const request = context.request;
  try {
    const appEnv = await getEnv(context);

    // CSRF check
    if (!validateOrigin(request, appEnv.APP_BASE_URL)) {
      return csrfForbidden();
    }

    // Rate limiting: 5 requests per minute per IP
    if (appEnv.CONTACT_RATE_LIMITER) {
      try {
        const ip = getClientIp(request);
        const { success } = await appEnv.CONTACT_RATE_LIMITER.limit({ key: `contact:${ip}` });
        if (!success) {
          return tooMany('Too many messages sent. Please wait a moment before trying again.');
        }
      } catch (rateLimitErr) {
        console.warn('[Contact API] Rate limiter encountered an issue:', rateLimitErr);
      }
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return badRequest('Invalid JSON request body.');
    }

    const name = typeof body.name === 'string' ? body.name : '';
    const email = typeof body.email === 'string' ? body.email : '';
    const subject = typeof body.subject === 'string' ? body.subject : '';
    const message = typeof body.message === 'string' ? body.message : '';
    const _website = typeof body._website === 'string' ? body._website : '';

    // Honeypot: silently accept bot submissions
    if (_website.trim()) {
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Strip CRLF from header-injectable fields to prevent email header injection
    const sanitizeHeader = (s: string) => s.replace(/[\r\n]/g, '').trim();

    const safeName = sanitizeHeader(name).slice(0, 100);
    const safeEmail = sanitizeHeader(email).toLowerCase();
    const safeSubject = sanitizeHeader(subject).slice(0, 150);
    const safeMessage = message.trim().slice(0, 5000);

    // Required fields check
    if (!safeName || !safeEmail || !safeSubject || !safeMessage) {
      return new Response(
        JSON.stringify({ error: 'All fields (name, email, subject, message) are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(safeEmail)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sender = 'noreply@bitsnotes.com';
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

    const emailBinding = appEnv.SEND_EMAIL;

    if (!emailBinding) {
      // Demo / local dev: acknowledge submission gracefully
      console.log('[Contact API] SEND_EMAIL binding inactive — simulated accept');
      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: 'Message accepted (email binding not active in this environment).'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send email using Cloudflare Email Service binding
    try {
      const EmailMsg = await getEmailMessageConstructor();
      if (!EmailMsg) {
        throw new Error('EmailMessage constructor unavailable in current runtime');
      }
      const emailMessage = new EmailMsg(sender, recipient, mimeText);
      await emailBinding.send(emailMessage);
    } catch (sendErr) {
      console.error('[Contact API] Cloudflare email transmission failed:', sendErr);
      return serverError('Failed to send message. Please contact us directly at support@bitsnotes.com.');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('[Contact API] Internal server error:', error);
    return serverError('Server failed to process your request. Please try again later.');
  }
};
