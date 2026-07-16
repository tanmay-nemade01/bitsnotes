import fs from 'node:fs';
import path from 'node:path';

const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const patchCode = `
// ─── START LOCAL DEPLOY GUARD ──────────────────────────────────────────────
const args = process.argv.slice(2);
const isDeploy = args.some(arg => arg === 'deploy' || arg === 'publish');
const isCI = process.env.CI === 'true' || process.env.CI === '1' || !!process.env.GITHUB_ACTIONS || !!process.env.CF_PAGES;

if (isDeploy && !isCI) {
  console.error("\\n${RED}${BOLD}┌──────────────────────────────────────────────────────────┐${RESET}");
  console.error("${RED}${BOLD}│                    DEPLOYMENT BLOCKED                    │${RESET}");
  console.error("${RED}${BOLD}└──────────────────────────────────────────────────────────┘${RESET}");
  console.error("${RED}Direct deployments from local machines are strictly disabled.${RESET}");
  console.error("All deployments must go through Git and Cloudflare Workers (CI/CD).\\n");
  process.exit(1);
}
// ─── END LOCAL DEPLOY GUARD ────────────────────────────────────────────────
`;

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('LOCAL DEPLOY GUARD')) {
    console.log(`[guard] Wrangler binary already patched: ${path.basename(filePath)}`);
    return;
  }

  // Insert the patch right after the shebang or at the very beginning
  if (content.startsWith('#!')) {
    const lines = content.split('\n');
    lines.splice(1, 0, patchCode);
    content = lines.join('\n');
  } else {
    content = patchCode + content;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[guard] Successfully patched Wrangler binary: ${path.basename(filePath)}`);
}

const rootDir = process.cwd();
const bins = [
  path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'cf-wrangler.js')
];

for (const bin of bins) {
  try {
    patchFile(bin);
  } catch (err) {
    console.error(`[guard] Failed to patch ${bin}:`, err);
  }
}
