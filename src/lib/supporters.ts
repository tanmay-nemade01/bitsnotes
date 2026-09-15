/**
 * Supporters data-access layer (Wall of Gratitude).
 *
 * The roster lives in the D1 `supporters` table and is edited from /admin, so
 * a new supporter shows up on /support immediately — no PR, rebuild, or deploy.
 *
 * `src/data/supporters.ts` remains the static fallback used when the table is
 * missing or unreachable (e.g. local dev before migrations are applied). We
 * only fall back on *error*, never merely because the table is empty: an admin
 * must be able to clear the wall without the old names reappearing.
 */

import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';
import fallbackSupporters, { type SupporterTier } from '../data/supporters';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SUPPORTER_TIERS = ['chai', 'fuel', 'meal', 'sponsor', 'supporter'] as const;

const TIER_SET = new Set<string>(SUPPORTER_TIERS);

/** Default display label per tier, used when `tierLabel` is not supplied. */
export const TIER_LABELS: Record<SupporterTier, string> = {
  chai: 'Chai Treat',
  fuel: 'Pomodoro Fuel',
  meal: 'A Full Meal',
  sponsor: 'Sponsor',
  supporter: 'Supporter',
};

export const MAX_NAME_LENGTH = 60;
export const MAX_MESSAGE_LENGTH = 280;
export const MAX_DATE_LENGTH = 40;
export const MAX_AVATAR_URL_LENGTH = 500;
/** Safety cap so a runaway roster can never blow up the payload. */
export const MAX_SUPPORTERS = 2000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SupporterRow {
  id: string;
  name: string;
  tier: string;
  tier_label: string | null;
  message: string | null;
  avatar_url: string | null;
  supporter_date: string | null;
  created_at: number;
}

/** Shape sent to the browser (camelCase, no internal columns). */
export interface PublicSupporter {
  id: string;
  name: string;
  tier: SupporterTier;
  tierLabel: string;
  message?: string;
  avatarUrl?: string;
  date?: string;
  createdAt: number;
}

export interface SupporterInput {
  name: string;
  tier: SupporterTier;
  tierLabel: string | null;
  message: string | null;
  avatarUrl: string | null;
  date: string | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function isSupporterTier(value: unknown): value is SupporterTier {
  return typeof value === 'string' && TIER_SET.has(value);
}

/** Trim, strip control characters, collapse runs of whitespace, clamp length. */
function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

const ALLOWED_AVATAR_SCHEMES = new Set(['http:', 'https:']);

export type ValidationResult =
  | { ok: true; value: SupporterInput }
  | { ok: false; error: string };

/**
 * Validate + normalise an admin submission. Returns a friendly error string
 * that can be surfaced directly in the dashboard UI.
 */
export function normalizeSupporterInput(body: Record<string, unknown>): ValidationResult {
  const name = clean(body.name, MAX_NAME_LENGTH);
  if (!name) return { ok: false, error: 'Name is required.' };
  if (name.length < 2) return { ok: false, error: 'Name is too short.' };

  const tier = isSupporterTier(body.tier) ? body.tier : 'supporter';

  const rawLabel = clean(body.tierLabel, MAX_NAME_LENGTH);
  // A custom label is optional; fall back to the tier's default label.
  const tierLabel = rawLabel || TIER_LABELS[tier];

  const message = clean(body.message, MAX_MESSAGE_LENGTH + 1);
  if (message && message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` };
  }

  const date = clean(body.date, MAX_DATE_LENGTH + 1);
  if (date && date.length > MAX_DATE_LENGTH) {
    return { ok: false, error: `Date must be ${MAX_DATE_LENGTH} characters or fewer.` };
  }

  let avatarUrl: string | null = null;
  const rawAvatar = clean(body.avatarUrl, MAX_AVATAR_URL_LENGTH + 1);
  if (rawAvatar) {
    if (rawAvatar.length > MAX_AVATAR_URL_LENGTH) {
      return { ok: false, error: 'Avatar URL is too long.' };
    }
    try {
      const parsed = new URL(rawAvatar);
      if (!ALLOWED_AVATAR_SCHEMES.has(parsed.protocol)) {
        return { ok: false, error: 'Avatar URL must start with http:// or https://' };
      }
      avatarUrl = parsed.toString();
    } catch {
      return { ok: false, error: 'Avatar URL is not a valid URL.' };
    }
  }

  return {
    ok: true,
    value: { name, tier, tierLabel, message, avatarUrl, date },
  };
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toPublic(row: SupporterRow): PublicSupporter {
  const tier = isSupporterTier(row.tier) ? row.tier : 'supporter';
  const supporter: PublicSupporter = {
    id: row.id,
    name: row.name,
    tier,
    tierLabel: row.tier_label || TIER_LABELS[tier],
    createdAt: Number(row.created_at) || 0,
  };
  if (row.message) supporter.message = row.message;
  if (row.avatar_url) supporter.avatarUrl = row.avatar_url;
  if (row.supporter_date) supporter.date = row.supporter_date;
  return supporter;
}

/** Convert the static fallback list into the public shape. */
export function fallbackSupporterList(): PublicSupporter[] {
  return fallbackSupporters.map((s, index) => {
    const tier: SupporterTier = s.tier ?? 'supporter';
    const supporter: PublicSupporter = {
      id: s.id || `static-${index}`,
      name: s.name,
      tier,
      tierLabel: s.tierLabel || TIER_LABELS[tier],
      createdAt: 0,
    };
    if (s.message) supporter.message = s.message;
    if (s.avatarUrl) supporter.avatarUrl = s.avatarUrl;
    if (s.date) supporter.date = s.date;
    return supporter;
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List supporters newest-first. Throws if the table is unavailable so the
 * caller can decide whether to fall back to the static list.
 */
export async function listSupporters(db: AuthDb, limit = MAX_SUPPORTERS): Promise<PublicSupporter[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, tier, tier_label, message, avatar_url, supporter_date, created_at
         FROM supporters
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(Math.min(Math.max(1, limit), MAX_SUPPORTERS))
    .all<SupporterRow>();

  return (rows.results ?? []).map(toPublic);
}

/** Total number of supporters, for the "+N more" summary. Throws on failure. */
export async function countSupporters(db: AuthDb): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM supporters').first<{ count: number }>();
  return Number(row?.count) || 0;
}

export async function getSupporterById(db: AuthDb, id: string): Promise<PublicSupporter | null> {
  const row = await db
    .prepare(
      `SELECT id, name, tier, tier_label, message, avatar_url, supporter_date, created_at
         FROM supporters WHERE id = ?`,
    )
    .bind(id)
    .first<SupporterRow>();
  return row ? toPublic(row) : null;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function supporterNameExists(db: AuthDb, name: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM supporters WHERE name = ? COLLATE NOCASE')
    .bind(name)
    .first<{ id: string }>();
  return !!row;
}

export class DuplicateSupporterError extends Error {
  constructor(name: string) {
    super(`"${name}" is already on the wall.`);
    this.name = 'DuplicateSupporterError';
  }
}

export async function addSupporter(
  db: AuthDb,
  input: SupporterInput,
  createdBy?: string | null,
): Promise<PublicSupporter> {
  if (await supporterNameExists(db, input.name)) {
    throw new DuplicateSupporterError(input.name);
  }

  const id = uuidv7();
  const now = Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO supporters
           (id, name, tier, tier_label, message, avatar_url, supporter_date, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.tier,
        input.tierLabel,
        input.message,
        input.avatarUrl,
        input.date,
        now,
        createdBy ?? null,
      )
      .run();
  } catch (err) {
    // UNIQUE(name) — surface the friendly error instead of a raw D1 failure.
    if (/UNIQUE/i.test(String(err))) throw new DuplicateSupporterError(input.name);
    throw err;
  }

  const created = await getSupporterById(db, id);
  if (!created) throw new Error('Supporter insert succeeded but row could not be read back.');
  return created;
}

/** Update an existing supporter. Returns the updated row, or null if missing. */
export async function updateSupporter(
  db: AuthDb,
  id: string,
  input: SupporterInput,
): Promise<PublicSupporter | null> {
  const existing = await getSupporterById(db, id);
  if (!existing) return null;

  try {
    await db
      .prepare(
        `UPDATE supporters
            SET name = ?, tier = ?, tier_label = ?, message = ?, avatar_url = ?, supporter_date = ?
          WHERE id = ?`,
      )
      .bind(input.name, input.tier, input.tierLabel, input.message, input.avatarUrl, input.date, id)
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new DuplicateSupporterError(input.name);
    throw err;
  }

  return getSupporterById(db, id);
}

/** Remove a supporter. Returns true when a row was deleted. */
export async function deleteSupporter(db: AuthDb, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM supporters WHERE id = ?').bind(id).run();
  return Number((result as any)?.meta?.changes ?? 0) > 0;
}
