import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { EmailMessage } from 'cloudflare:email';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { name, email, subject, message } = body;

    // Validate inputs
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'All fields (name, email, subject, message) are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
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
      `Reply-To: ${name} <${email}>`,
      `Subject: [Contact Form] ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      `You received a new message from the BitsNotes Contact Form:`,
      ``,
      `Name: ${name}`,
      `Email: ${email}`,
      `Subject: ${subject}`,
      ``,
      `Message:`,
      `--------------------------------------------------`,
      message,
      `--------------------------------------------------`,
      ``,
      `Sent via BitsNotes Cloudflare Email Routing.`
    ].join('\r\n');

    // Retrieve SEND_EMAIL binding
    const emailBinding = (env as any).SEND_EMAIL;

    if (!emailBinding) {
      console.log('--- [DEMO MODE] EMAIL TRANSMISSION SIMULATION ---');
      console.log(`From: ${sender}`);
      console.log(`To: ${recipient}`);
      console.log(`Reply-To: ${name} <${email}>`);
      console.log(`Subject: [Contact Form] ${subject}`);
      console.log('Body:');
      console.log(message);
      console.log('-------------------------------------------------');

      return new Response(
        JSON.stringify({
          success: true,
          simulated: true,
          message: 'Demo Mode: Message logged to server console since SEND_EMAIL binding is not active.'
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
  } catch (error: any) {
    console.error('[Contact API] Internal server error:', error);
    return new Response(
      JSON.stringify({ error: `Server failed to process your request: ${error.message || error}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
