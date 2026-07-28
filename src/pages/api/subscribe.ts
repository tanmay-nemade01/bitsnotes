import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateSecureToken } from '../../utils/crypto';
import { subscribeToCampaignsList, sendZeptoMailEmail } from '../../utils/zoho';
import { getEnv, getUser, unauthorized, json } from '../../lib/apiHelpers';
import { validateOrigin, csrfForbidden } from '../../lib/auth/csrf';

export const prerender = false;

interface SubscriberData {
  email: string;
  status: 'pending' | 'subscribed' | 'unsubscribed';
  confirmationToken?: string;
  unsubscribeToken?: string;
  createdAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
}

async function sendWelcomeEmail(email: string, origin: string, unsubscribeToken: string): Promise<void> {
  const ZEPTOMAIL_TOKEN = (env as any).ZEPTOMAIL_TOKEN as string | undefined;
  if (!ZEPTOMAIL_TOKEN) {
    console.warn('[Newsletter Subscribe] ZEPTOMAIL_TOKEN not set. Welcome email not sent.');
    return;
  }

  const unsubscribeUrl = `${origin}/api/unsubscribe?token=${unsubscribeToken}`;

  try {
    await sendZeptoMailEmail({
      toEmail: email,
      subject: 'Subscription Confirmed | Welcome to BitsNotes! 🎉',
      listUnsubscribeUrl: unsubscribeUrl,
      htmlBody: [
        '<div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #FAF9F6; border: 1px solid #9D9689; border-radius: 10px;">',
        '  <h2 style="font-family: Fraunces, serif; font-size: 24px; color: #1A1916; margin: 0 0 12px;">You’re subscribed!</h2>',
        '  <p style="font-size: 14px; color: #48453F; line-height: 1.6; margin: 0 0 20px;">',
        '    Your account email is now subscribed to the BitsNotes newsletter.',
        '  </p>',
        '  <p style="font-size: 14px; color: #48453F; line-height: 1.6; margin: 0 0 24px;">',
        '    Get ready for curated postgraduate lecture notes, study guides, and resources delivered directly to your inbox.',
        '  </p>',
        `  <a href="${origin}" style="display: inline-block; padding: 10px 24px; background: #0F766E; color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px;">`,
        '    Visit BitsNotes',
        '  </a>',
        '  <hr style="border: 0; border-top: 1px solid #9D9689; margin: 28px 0;" />',
        '  <p style="font-size: 11px; color: #736E65; line-height: 1.5; margin: 0;">',
        '    You received this email because you subscribed to BitsNotes.',
        `    To unsubscribe, <a href="${unsubscribeUrl}" style="color: #0F766E; text-decoration: underline;">click here</a>.`,
        '  </p>',
        '</div>',
      ].join('\n'),
    });
  } catch (e) {
    console.error('[Newsletter Subscribe] Failed to send welcome email:', e);
  }
}

export const POST: APIRoute = async (context) => {
  const user = getUser(context);
  if (!user) return unauthorized('Sign in to subscribe');

  const appEnv = await getEnv(context);
  if (!validateOrigin(context.request, appEnv.APP_BASE_URL)) {
    return csrfForbidden();
  }

  const email = user.email.trim().toLowerCase();
  const origin = new URL(context.request.url).origin;

  try {
    const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;

    if (!kv) {
      console.log('[Newsletter] NEWSLETTER_KV binding not found. Simulating subscription.');
      return json({ success: true, simulated: true });
    }

    const existingRaw = await kv.get(`contact:${email}`);
    let existing: SubscriberData | null = null;
    if (existingRaw) {
      existing = JSON.parse(existingRaw) as SubscriberData;
      if (existing.status === 'subscribed') {
        return json({ success: true, alreadySubscribed: true, message: 'You are already subscribed!' });
      }
    }

    const now = new Date().toISOString();
    const unsubscribeToken = generateSecureToken();

    const contactData: SubscriberData = {
      email,
      status: 'subscribed',
      unsubscribeToken,
      createdAt: existing?.createdAt ?? now,
      confirmedAt: now,
    };

    try {
      await subscribeToCampaignsList(email, kv);
    } catch (e) {
      console.error('[Newsletter Subscribe] Failed to register contact in Zoho Campaigns:', e);
    }

    await kv.put(`contact:${email}`, JSON.stringify(contactData));
    await kv.put(`unsubscribe:${unsubscribeToken}`, email);

    await sendWelcomeEmail(email, origin, unsubscribeToken);

    return json({ success: true });
  } catch (error) {
    console.error('[Newsletter Subscribe] Error:', error);
    return json({ error: 'Server failed to process your subscription.' }, 500);
  }
};
