import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

async function processUnsubscribe(token: string, kv: KVNamespace): Promise<boolean> {
  const email = await kv.get(`unsubscribe:${token}`);
  if (!email) return false;

  const rawContact = await kv.get(`contact:${email}`);
  if (rawContact) {
    const contact = JSON.parse(rawContact);
    contact.status = 'unsubscribed';
    contact.unsubscribedAt = new Date().toISOString();
    await kv.put(`contact:${email}`, JSON.stringify(contact));
  }

  // Remove the unsubscribe token lookup
  await kv.delete(`unsubscribe:${token}`);

  return true;
}

// GET: traditional link click from email
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) {
    return Response.redirect(`${url.origin}/?unsubscribe_error=invalid`, 302);
  }

  // Access KV binding via cloudflare:workers env (same pattern as contact.ts)
  const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;

  if (!kv) {
    return Response.redirect(`${url.origin}/?unsubscribe_error=server`, 302);
  }

  const success = await processUnsubscribe(token, kv);
  if (!success) {
    return Response.redirect(`${url.origin}/?unsubscribe_error=expired`, 302);
  }

  return Response.redirect(`${url.origin}/?unsubscribed=1`, 302);
};

// POST: Gmail/Yahoo RFC 8058 one-click unsubscribe
export const POST: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('token');
  const jsonHeaders = { 'Content-Type': 'application/json' };

  if (!token) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: jsonHeaders });
  }

  // Access KV binding via cloudflare:workers env (same pattern as contact.ts)
  const kv = (env as any).NEWSLETTER_KV as KVNamespace | undefined;

  if (!kv) {
    return new Response(JSON.stringify({ error: 'Server error.' }), { status: 500, headers: jsonHeaders });
  }

  const success = await processUnsubscribe(token, kv);
  if (!success) {
    return new Response(JSON.stringify({ error: 'Token expired or invalid.' }), { status: 404, headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: jsonHeaders });
};
