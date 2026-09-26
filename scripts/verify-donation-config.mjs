/**
 * Tamper-evident guard for donation receiver details.
 *
 * Fails (exit 1) if:
 *  - src/data/site.ts upiId / payeeName drift from EXPECTED_* constants
 *  - the VPA format is invalid
 *  - src/pages/support.astro lost its verification UI or data attributes
 *  - the orphan static QR (public/support-upi-qr.png) reappears
 *
 * Usage:
 *   node scripts/verify-donation-config.mjs [--live-url https://bitsnotes.com/support]
 *
 * With --live-url, also fetches the deployed HTML and asserts the expected
 * `pa=` VPA is present. Used by the daily donation-integrity workflow.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  errors.push(msg);
  console.error(`  ✗ ${msg}`);
};

const sitePath = path.join(root, 'src/data/site.ts');
const supportPath = path.join(root, 'src/pages/support.astro');
const orphanQr = path.join(root, 'public/support-upi-qr.png');

const siteSrc = readFileSync(sitePath, 'utf8');
const supportSrc = readFileSync(supportPath, 'utf8');

function extract(re, label) {
  const m = siteSrc.match(re);
  if (!m) {
    fail(`${label} not found in src/data/site.ts`);
    return null;
  }
  return m[1];
}

const expectedId = extract(/EXPECTED_UPI_ID\s*=\s*['"]([^'"]+)['"]/, 'EXPECTED_UPI_ID');
const expectedName = extract(/EXPECTED_PAYEE_NAME\s*=\s*['"]([^'"]+)['"]/, 'EXPECTED_PAYEE_NAME');
const configuredId = extract(/upiId:\s*(?:EXPECTED_UPI_ID|['"]([^'"]+)['"])/, 'upi.upiId');
const configuredName = extract(/payeeName:\s*(?:EXPECTED_PAYEE_NAME|['"]([^'"]+)['"])/, 'upi.payeeName');

// Resolve the actual literal when the config references the constant.
const actualId = siteSrc.includes('upiId: EXPECTED_UPI_ID') ? expectedId : configuredId;
const actualName = siteSrc.includes('payeeName: EXPECTED_PAYEE_NAME') ? expectedName : configuredName;

if (expectedId) {
  if (!/^[\w.\-]{2,256}@[a-zA-Z0-9.\-]{2,64}$/.test(expectedId)) {
    fail(`EXPECTED_UPI_ID has invalid VPA format: ${expectedId}`);
  } else {
    ok(`EXPECTED_UPI_ID format valid (${expectedId})`);
  }
}
if (expectedId && actualId) {
  if (actualId !== expectedId) fail(`upi.upiId (${actualId}) != EXPECTED_UPI_ID (${expectedId})`);
  else ok('upi.upiId matches EXPECTED_UPI_ID');
}
if (expectedName && actualName) {
  if (actualName !== expectedName) fail(`upi.payeeName (${actualName}) != EXPECTED_PAYEE_NAME (${expectedName})`);
  else ok(`upi.payeeName matches bank-verified name (${actualName})`);
}

// support.astro must keep the anti-tamper UI + machine-readable hooks.
const required = [
  ['data-upi-id=', 'data-upi-id attribute on #donate-widget'],
  ['data-payee-name=', 'data-payee-name attribute on #donate-widget'],
  ['data-upi-id-text', 'visible UPI ID element'],
  ['data-payee-name-text', 'visible payee-name element'],
  ['data-verify-payee-notice', 'verify-before-you-pay notice'],
  ['donate-tamper-warning', 'runtime tamper-warning banner'],
  ['checkIntegrity', 'client-side integrity check'],
  ['/contact', 'report-tampering link'],
];
for (const [needle, label] of required) {
  if (supportSrc.includes(needle)) ok(label);
  else fail(`support.astro missing ${label} (${needle})`);
}

// The old static QR must stay deleted — it was an untracked second source.
if (existsSync(orphanQr)) fail('public/support-upi-qr.png exists (delete it; QR is generated live)');
else ok('orphan static QR absent');

// Optional live check against production HTML.
const liveIdx = process.argv.indexOf('--live-url');
if (liveIdx !== -1) {
  const liveUrl = process.argv[liveIdx + 1];
  if (!liveUrl) {
    fail('--live-url requires a URL argument');
  } else {
    try {
      const res = await fetch(liveUrl, { headers: { 'User-Agent': 'bitsnotes-donation-guard/1.0' } });
      const html = await res.text();
      if (!res.ok) {
        fail(`live check: HTTP ${res.status} from ${liveUrl}`);
      } else if (!html.includes(`pa=${encodeURIComponent(expectedId)}`) && !html.includes(`pa=${expectedId}`) && !html.includes(expectedId)) {
        fail(`live check: expected VPA ${expectedId} NOT found in ${liveUrl}`);
      } else {
        ok(`live check: ${liveUrl} contains expected VPA`);
      }
      if (expectedName && !html.includes(expectedName)) {
        fail(`live check: expected payee name "${expectedName}" NOT found in ${liveUrl}`);
      } else if (expectedName) {
        ok(`live check: ${liveUrl} contains payee name`);
      }
    } catch (err) {
      fail(`live check failed: ${String(err)}`);
    }
  }
}

if (errors.length) {
  console.error(`\nDONATION GUARD FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('\nDonation guard passed.');
