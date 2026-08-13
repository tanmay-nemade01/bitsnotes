import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';

export const BIT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🤔', '😮'] as const;

export type BitReactionEmoji = (typeof BIT_REACTION_EMOJIS)[number];

const ALLOWED = new Set<string>(BIT_REACTION_EMOJIS);

export function isAllowedBitEmoji(emoji: string): emoji is BitReactionEmoji {
  return ALLOWED.has(emoji);
}

export interface BitReactionState {
  counts: Record<string, number>;
  mine: string[];
}

export async function getReactionState(
  db: AuthDb,
  slug: string,
  userId?: string | null,
): Promise<BitReactionState> {
  const map = await getReactionStates(db, [slug], userId);
  return map[slug] ?? { counts: {}, mine: [] };
}

export async function getReactionStates(
  db: AuthDb,
  slugs: string[],
  userId?: string | null,
): Promise<Record<string, BitReactionState>> {
  const result: Record<string, BitReactionState> = {};
  for (const slug of slugs) {
    result[slug] = { counts: {}, mine: [] };
  }
  if (slugs.length === 0) return result;

  const placeholders = slugs.map(() => '?').join(',');
  const countRows = await db.prepare(
    `SELECT slug, emoji, COUNT(*) AS count FROM bit_reactions WHERE slug IN (${placeholders}) GROUP BY slug, emoji`,
  ).bind(...slugs).all<{ slug: string; emoji: string; count: number }>();

  for (const row of countRows.results ?? []) {
    if (!result[row.slug]) result[row.slug] = { counts: {}, mine: [] };
    if (row.count > 0) result[row.slug].counts[row.emoji] = Number(row.count);
  }

  if (userId) {
    const mineRows = await db.prepare(
      `SELECT slug, emoji FROM bit_reactions WHERE user_id = ? AND slug IN (${placeholders})`,
    ).bind(userId, ...slugs).all<{ slug: string; emoji: string }>();
    for (const row of mineRows.results ?? []) {
      if (!result[row.slug]) result[row.slug] = { counts: {}, mine: [] };
      result[row.slug].mine.push(row.emoji);
    }
  }

  return result;
}

export async function toggleBitReaction(
  db: AuthDb,
  userId: string,
  slug: string,
  emoji: string,
): Promise<BitReactionState & { active: boolean; emoji: string }> {
  const existing = await db.prepare(
    'SELECT id FROM bit_reactions WHERE user_id = ? AND slug = ? AND emoji = ?',
  ).bind(userId, slug, emoji).first<{ id: string }>();

  if (existing) {
    await db.prepare(
      'DELETE FROM bit_reactions WHERE user_id = ? AND slug = ? AND emoji = ?',
    ).bind(userId, slug, emoji).run();
  } else {
    await db.prepare(
      'INSERT INTO bit_reactions (id, user_id, slug, emoji, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(uuidv7(), userId, slug, emoji, Date.now()).run();
  }

  const state = await getReactionState(db, slug, userId);
  return { ...state, active: !existing, emoji };
}
