import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateSecureToken } from '../../utils/crypto';
import { sendZeptoMailEmail } from '../../utils/zoho';
import { getDisposableDomains, isDomainDisposable } from '../../utils/disposableEmails';

export const prerender = false;

interface SubscriberData {
  email: string;
  status: 'pending' | 'subscribed' | 'unsubscribed';
  confirmationToken: string;
  unsubscribeToken?: string;
  createdAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
}

export const POST: APIRoute = async ({ request, url }) => {
  const jsonHeaders = { 'Content-Type': 'application/json' };

  try {
    const body = await request.json() as Record<string, unknown>;
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const honeypot = body._website as string | undefined;

    // Honeypot: silently succeed for bots
    if (honeypot) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: jsonHeaders });
    }

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Access KV binding via cloudflare:workers env (same pattern as contact.ts)
    const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;

    // Graceful fallback when KV is unavailable (local dev)
    if (!kv) {
      console.log('[Newsletter] NEWSLETTER_KV binding not found. Simulating subscription.');
      return new Response(
        JSON.stringify({ success: true, simulated: true }),
        { status: 200, headers: jsonHeaders }
      );
    }

    // Block disposable email domains (dynamic list cached in KV for 24h)
    const emailDomain = email.split('@').pop()!;
    const blocklist = await getDisposableDomains(kv);
    if (isDomainDisposable(emailDomain, blocklist)) {
      return new Response(
        JSON.stringify({ error: 'Please use a standard email address.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Check existing subscriber
    const existingRaw = await kv.get(`contact:${email}`);
    if (existingRaw) {
      const existing: SubscriberData = JSON.parse(existingRaw);
      if (existing.status === 'subscribed') {
        return new Response(
          JSON.stringify({ success: true, message: 'You are already subscribed!' }),
          { status: 200, headers: jsonHeaders }
        );
      }
      // If pending or unsubscribed, allow re-subscription below
    }

    const confirmationToken = generateSecureToken();
    const domain = url.origin;

    const contactData: SubscriberData = {
      email,
      status: 'pending',
      confirmationToken,
      createdAt: new Date().toISOString(),
    };

    // Store subscriber record with a 24-hour TTL to prevent storage leaks if not confirmed
    await kv.put(`contact:${email}`, JSON.stringify(contactData), { expirationTtl: 86400 });

    // Store confirmation token with 24-hour TTL for auto-expiry
    await kv.put(`token:${confirmationToken}`, email, { expirationTtl: 86400 });

    // Send confirmation email via Zoho ZeptoMail
    const ZEPTOMAIL_TOKEN = (env as any).ZEPTOMAIL_TOKEN as string | undefined;

    if (ZEPTOMAIL_TOKEN) {
      const confirmUrl = `${domain}/api/confirm?token=${confirmationToken}`;

      try {
        await sendZeptoMailEmail({
          toEmail: email,
          subject: 'Confirm your BitsNotes subscription',
          htmlBody: [
            '<div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">',
            '  <h2 style="font-family: Fraunces, serif; font-size: 22px; color: #1A1916; margin: 0 0 12px;">Confirm your subscription</h2>',
            '  <p style="font-size: 14px; color: #48453F; line-height: 1.6; margin: 0 0 24px;">',
            '    Thank you for subscribing to BitsNotes! Please click the button below to confirm your email address.',
            '  </p>',
            `  <a href="${confirmUrl}" style="display: inline-block; padding: 10px 24px; background: #0F766E; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px;">`,
            '    Confirm Subscription',
            '  </a>',
            '  <p style="font-size: 12px; color: #736E65; margin-top: 24px; line-height: 1.5;">',
            '    This link expires in 24 hours. If you did not sign up, you can safely ignore this email.',
            '  </p>',
            '</div>',
          ].join('\n'),
        });
      } catch (error) {
        console.error('[Newsletter Subscribe] Failed to send confirmation email via ZeptoMail:', error);
      }
    } else {
      console.warn('[Newsletter] ZEPTOMAIL_TOKEN not set. Confirmation email not sent.');
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (error: any) {
    console.error('[Newsletter Subscribe] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Server failed to process your subscription.' }),
      { status: 500, headers: jsonHeaders }
    );
  }
};
