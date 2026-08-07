import fs from 'fs';

const path = 'C:/Users/Tanmay/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const toml = fs.readFileSync(path, 'utf8');
const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!m) {
  console.error('NO_TOKEN');
  process.exit(1);
}
const token = m[1];
const accountId = '468e2afc5e4e5f03cdbc1d369400b51a';
const script = 'bitsnotes';
const listKey = '3z3ce022f62a9346a787036bf07edb166378871a469c28100a9865719aecdd0b69';

async function api(method, urlPath, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const settings = await api('GET', `/workers/scripts/${script}/settings`);
console.log('settings_ok', settings.success);
if (!settings.success) {
  console.log(JSON.stringify(settings.errors || settings, null, 2));
  process.exit(1);
}

const bindings = settings.result?.bindings || [];
console.log('bindings', bindings.map((b) => `${b.name}:${b.type}`).join(', '));
const zoho = bindings.find((b) => b.name === 'ZOHO_CAMPAIGNS_LIST_KEY');
console.log('zoho_binding', zoho ? JSON.stringify({ name: zoho.name, type: zoho.type }) : 'none');

const secretRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${script}/secrets`,
  {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'ZOHO_CAMPAIGNS_LIST_KEY',
      text: listKey,
      type: 'secret_text',
    }),
  },
);
const secretJson = await secretRes.json();
console.log('secret_put_ok', secretJson.success);
if (!secretJson.success) {
  console.log('secret_put_errors', JSON.stringify(secretJson.errors || secretJson, null, 2));
}
