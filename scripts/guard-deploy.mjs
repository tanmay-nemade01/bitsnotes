import { execSync } from "node:child_process";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const skipFlag = "--dangerously-skip-branch-check";
const skip = process.argv.includes(skipFlag);

let branch;
try {
  branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
} catch {
  bail("Not a git repository. Deploy aborted.");
}

if (!branch) {
  bail("Detached HEAD state. Deploy aborted.");
}

if (branch !== "main") {
  if (skip) {
    warn(`Branch is "${branch}" but ${skipFlag} was passed — proceeding anyway.`);
  } else {
    red();
    console.error(`${BOLD}DEPLOY BLOCKED${RESET}${RED}`);
    console.error(`You are on branch "${branch}", not "main".`);
    console.error("");
    console.error("Production deploys must come from main.");
    console.error(
      `To bypass this guard in a genuine emergency, pass: ${BOLD}${skipFlag}${RESET}${RED}`,
    );
    console.error(RESET);
    process.exit(1);
  }
}

let status;
try {
  status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
} catch {
  warn("Could not check working tree status.");
  status = "";
}

if (status) {
  warn("Working tree is dirty — uncommitted changes will NOT be included in this deploy.");
  warn("Files with changes:");
  const lines = status.split("\n");
  for (const line of lines.slice(0, 10)) {
    console.error(`  ${line}`);
  }
  if (lines.length > 10) {
    warn(`  ... and ${lines.length - 10} more`);
  }
}

function red() {
  process.stderr.write(RED);
}

function bail(msg) {
  red();
  console.error(`${BOLD}DEPLOY BLOCKED${RESET}${RED}`);
  console.error(msg);
  console.error(RESET);
  process.exit(1);
}

function warn(msg) {
  process.stderr.write(YELLOW);
  console.error(msg);
  process.stderr.write(RESET);
}
