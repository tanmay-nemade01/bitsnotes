import { env } from 'cloudflare:workers';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}

/**
 * Reads an environment variable and strips surrounding single/double quotes and extra spaces.
 * This is crucial for local wrangler dev because .dev.vars can load surrounding quotes as part of the value.
 */
function getCleanEnvVar(key: string): string | undefined {
  const value = (env as any)[key];
  if (typeof value !== 'string') return undefined;
  return value.trim().replace(/^["'](.*)["']$/, '$1').trim();
}

/**
 * Gets a valid Zoho Campaigns OAuth Access Token.
 * Reads from KV cache first; if expired or not found, exchanges the refresh token.
 */
export async function getCampaignsAccessToken(kv: KVNamespace): Promise<string> {
  const cachedToken = await kv.get('zoho:access_token');
  if (cachedToken) {
    return cachedToken;
  }

  const clientId = getCleanEnvVar('ZOHO_CLIENT_ID');
  const clientSecret = getCleanEnvVar('ZOHO_CLIENT_SECRET');
  const refreshToken = getCleanEnvVar('ZOHO_REFRESH_TOKEN');
  const region = getCleanEnvVar('ZOHO_REGION') || 'com';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Zoho OAuth credentials in environment.');
  }

  const tokenUrl = `https://accounts.zoho.${region}/oauth/v2/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh Zoho token: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as TokenResponse;
  if (data.error) {
    throw new Error(`Zoho OAuth response contained error: ${data.error}`);
  }

  // Cache access token in KV. Standard Zoho tokens expire in 3600s (1 hour).
  // Cache it for slightly less (e.g., 3000s / 50 minutes) to avoid edge cases.
  await kv.put('zoho:access_token', data.access_token, {
    expirationTtl: Math.max(60, data.expires_in - 600),
  });

  return data.access_token;
}

/**
 * Adds a contact to the Zoho Campaigns mailing list.
 */
export async function subscribeToCampaignsList(email: string, kv: KVNamespace): Promise<void> {
  const listKey = getCleanEnvVar('ZOHO_CAMPAIGNS_LIST_KEY');
  const region = getCleanEnvVar('ZOHO_REGION') || 'com';
  if (!listKey) {
    console.warn('[Zoho Campaigns] ZOHO_CAMPAIGNS_LIST_KEY not set. Skipping subscription.');
    return;
  }

  const accessToken = await getCampaignsAccessToken(kv);
  const url = `https://campaigns.zoho.${region}/api/v1.1/json/listsubscribe`;

  const contactInfo = JSON.stringify({
    'Contact Email': email,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      resfmt: 'JSON',
      listkey: listKey,
      contactinfo: contactInfo,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zoho Campaigns listsubscribe error: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as any;
  if (result.status !== 'success' && result.code !== 0) {
    throw new Error(`Zoho Campaigns listsubscribe failed: ${JSON.stringify(result)}`);
  }
}

/**
 * Unsubscribes a contact from the Zoho Campaigns mailing list.
 */
export async function unsubscribeFromCampaignsList(email: string, kv: KVNamespace): Promise<void> {
  const listKey = getCleanEnvVar('ZOHO_CAMPAIGNS_LIST_KEY');
  const region = getCleanEnvVar('ZOHO_REGION') || 'com';
  if (!listKey) {
    console.warn('[Zoho Campaigns] ZOHO_CAMPAIGNS_LIST_KEY not set. Skipping unsubscription.');
    return;
  }

  const accessToken = await getCampaignsAccessToken(kv);
  const url = `https://campaigns.zoho.${region}/api/v1.1/json/listunsubscribe`;

  const contactInfo = JSON.stringify({
    'Contact Email': email,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      resfmt: 'JSON',
      listkey: listKey,
      contactinfo: contactInfo,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zoho Campaigns listunsubscribe error: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as any;
  if (result.status !== 'success' && result.code !== 0) {
    throw new Error(`Zoho Campaigns listunsubscribe failed: ${JSON.stringify(result)}`);
  }
}

/**
 * Sends a transactional email using Zoho ZeptoMail API.
 */
export async function sendZeptoMailEmail(options: {
  toEmail: string;
  subject: string;
  htmlBody: string;
  listUnsubscribeUrl?: string;
}): Promise<void> {
  const token = getCleanEnvVar('ZEPTOMAIL_TOKEN');
  const sender = getCleanEnvVar('ZEPTOMAIL_SENDER');
  const region = getCleanEnvVar('ZEPTOMAIL_REGION') || 'com';

  if (!token || !sender) {
    console.warn('[ZeptoMail] ZEPTOMAIL_TOKEN or ZEPTOMAIL_SENDER is not configured. Skipping email.');
    return;
  }

  // Parse sender format, e.g. "BitsNotes <newsletter@bitsnotes.com>"
  let senderName = 'BitsNotes';
  let senderEmail = 'newsletter@bitsnotes.com';
  const match = sender.match(/^(.*?)\s*<(.*?)>$/);
  if (match) {
    senderName = match[1].trim();
    senderEmail = match[2].trim();
  } else {
    senderEmail = sender.trim();
  }

  const url = `https://api.zeptomail.${region}/v1.1/email`;

  const payload: any = {
    from: {
      address: senderEmail,
      name: senderName,
    },
    to: [
      {
        email_address: {
          address: options.toEmail,
        },
      },
    ],
    subject: options.subject,
    htmlbody: options.htmlBody,
  };

  // Inject RFC 8058 compliant headers if unsubscription URL is provided
  if (options.listUnsubscribeUrl) {
    payload.mime_headers = {
      'List-Unsubscribe': `<${options.listUnsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  const authHeader = token.trim().startsWith('Zoho-enczapikey ')
    ? token.trim()
    : `Zoho-enczapikey ${token.trim()}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ZeptoMail send error: ${response.status} - ${errorText}`);
  }
}
