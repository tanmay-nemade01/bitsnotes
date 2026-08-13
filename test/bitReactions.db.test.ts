import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import { getReactionState, getReactionStates, isAllowedBitEmoji, toggleBitReaction } from '../src/lib/bitReactions';

let db: AuthDb;

beforeEach(async () => {
  db = makeDb();
  await db.prepare(
    `INSERT INTO users (id, email, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?)`,
  ).bind('u1', 'a@example.com', Date.now(), Date.now(), 'active').run();
  await db.prepare(
    `INSERT INTO users (id, email, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?)`,
  ).bind('u2', 'b@example.com', Date.now(), Date.now(), 'active').run();
});

describe('bit reactions', () => {
  it('allows only the fixed emoji set', () => {
    expect(isAllowedBitEmoji('👍')).toBe(true);
    expect(isAllowedBitEmoji('🔥')).toBe(true);
    expect(isAllowedBitEmoji('🚀')).toBe(false);
    expect(isAllowedBitEmoji('')).toBe(false);
  });

  it('toggles an emoji on and off for one user', async () => {
    const on = await toggleBitReaction(db, 'u1', 'pomodoro-confession', '😂');
    expect(on.active).toBe(true);
    expect(on.counts['😂']).toBe(1);
    expect(on.mine).toEqual(['😂']);

    const off = await toggleBitReaction(db, 'u1', 'pomodoro-confession', '😂');
    expect(off.active).toBe(false);
    expect(off.counts['😂']).toBeUndefined();
    expect(off.mine).toEqual([]);
  });

  it('lets one user keep multiple emojis on the same bit', async () => {
    await toggleBitReaction(db, 'u1', 'three-drops-inertia-tax', '👍');
    await toggleBitReaction(db, 'u1', 'three-drops-inertia-tax', '🔥');
    const state = await getReactionState(db, 'three-drops-inertia-tax', 'u1');
    expect(state.counts['👍']).toBe(1);
    expect(state.counts['🔥']).toBe(1);
    expect(state.mine.sort()).toEqual(['👍', '🔥'].sort());
  });

  it('counts reactions from different users separately', async () => {
    await toggleBitReaction(db, 'u1', 'trivial-three-pages', '❤️');
    await toggleBitReaction(db, 'u2', 'trivial-three-pages', '❤️');
    const anon = await getReactionState(db, 'trivial-three-pages', null);
    expect(anon.counts['❤️']).toBe(2);
    expect(anon.mine).toEqual([]);

    const u1 = await getReactionState(db, 'trivial-three-pages', 'u1');
    expect(u1.mine).toEqual(['❤️']);
  });

  it('batches state for the timeline', async () => {
    await toggleBitReaction(db, 'u1', 'a', '👍');
    await toggleBitReaction(db, 'u1', 'b', '🤔');
    const map = await getReactionStates(db, ['a', 'b', 'c'], 'u1');
    expect(map.a.counts['👍']).toBe(1);
    expect(map.b.mine).toEqual(['🤔']);
    expect(map.c.counts).toEqual({});
    expect(map.c.mine).toEqual([]);
  });
});
