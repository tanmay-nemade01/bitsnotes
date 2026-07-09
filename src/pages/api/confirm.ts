import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateSecureToken } from '../../utils/crypto';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return Response.redirect(`${url.origin}/?subscribe_error=invalid`, 302);
  }

  // Access KV binding via cloudflare:workers env (same pattern as contact.ts)
  const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;

  if (!kv) {
    return Response.redirect(`${url.origin}/?subscribe_error=server`, 302);
  }

  // Look up the confirmation token
  const email = await kv.get(`token:${token}`);
  if (!email) {
    // Token expired or invalid
    return Response.redirect(`${url.origin}/?subscribe_error=expired`, 302);
  }

  // Retrieve contact data
  const rawContact = await kv.get(`contact:${email}`);
  if (!rawContact) {
    return Response.redirect(`${url.origin}/?subscribe_error=not_found`, 302);
  }

  const contact = JSON.parse(rawContact);

  // Update status to subscribed
  const unsubscribeToken = generateSecureToken();
  contact.status = 'subscribed';
  contact.confirmedAt = new Date().toISOString();
  contact.unsubscribeToken = unsubscribeToken;

  // Store updated contact + permanent unsubscribe token mapping
  await kv.put(`contact:${email}`, JSON.stringify(contact));
  await kv.put(`unsubscribe:${unsubscribeToken}`, email);

  // Clean up the one-time confirmation token
  await kv.delete(`token:${token}`);

  // Send subscription confirmation/welcome email via Resend
  const RESEND_API_KEY = (env as any).RESEND_API_KEY as string | undefined;
  if (RESEND_API_KEY) {
    const unsubscribeUrl = `${url.origin}/api/unsubscribe?token=${unsubscribeToken}`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'BitsNotes <newsletter@bitsnotes.com>',
          to: email,
          subject: 'Subscription Confirmed | Welcome to BitsNotes! \uD83C\uDF89',
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          html: [
            '<div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #FAF9F6; border: 1px solid #9D9689; border-radius: 10px;">',
            '  <h2 style="font-family: Fraunces, serif; font-size: 24px; color: #1A1916; margin: 0 0 12px;">You\u2019re subscribed!</h2>',
            '  <p style="font-size: 14px; color: #48453F; line-height: 1.6; margin: 0 0 20px;">',
            '    Your email address has been successfully confirmed. You are now officially subscribed to the BitsNotes newsletter.',
            '  </p>',
            '  <p style="font-size: 14px; color: #48453F; line-height: 1.6; margin: 0 0 24px;">',
            '    Get ready for curated postgraduate lecture notes, study guides, and resources delivered directly to your inbox.',
            '  </p>',
            `  <a href="${url.origin}" style="display: inline-block; padding: 10px 24px; background: #0F766E; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px;">`,
            '    Visit BitsNotes',
            '  </a>',
            '  <hr style="border: 0; border-top: 1px solid #9D9689; margin: 28px 0;" />',
            '  <p style="font-size: 11px; color: #736E65; line-height: 1.5; margin: 0;">',
            '    You received this email because you subscribed to BitsNotes.',
            `    To unsubscribe, <a href="${unsubscribeUrl}" style="color: #0F766E; text-decoration: underline;">click here</a>.`,
            '  </p>',
            '</div>',
          ].join('\n'),
        }),
      });
    } catch (e) {
      console.error('[Newsletter Confirm] Failed to send welcome email:', e);
    }
  } else {
    console.warn('[Newsletter Confirm] RESEND_API_KEY not set. Welcome email not sent.');
  }

  // Redirect to the dedicated subscription confirmed page
  return Response.redirect(`${url.origin}/subscribed`, 302);
};
