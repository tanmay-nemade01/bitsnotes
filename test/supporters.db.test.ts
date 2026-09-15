import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import type { AuthDb } from '../src/lib/auth/db';
import {
  DuplicateSupporterError,
  MAX_MESSAGE_LENGTH,
  addSupporter,
  countSupporters,
  deleteSupporter,
  fallbackSupporterList,
  getSupporterById,
  listSupporters,
  normalizeSupporterInput,
  updateSupporter,
} from '../src/lib/supporters';

let db: AuthDb;

beforeEach(async () => {
  db = makeDb();
});

function valid(overrides: Record<string, unknown> = {}) {
  return { name: 'Chinmay Das', ...overrides };
}

function parsed(overrides: Record<string, unknown> = {}) {
  const result = normalizeSupporterInput(valid(overrides));
  if (!result.ok) throw new Error(`Expected valid input, got: ${result.error}`);
  return result.value;
}

describe('normalizeSupporterInput', () => {
  it('requires a name', () => {
    expect(normalizeSupporterInput({}).ok).toBe(false);
    expect(normalizeSupporterInput({ name: '   ' }).ok).toBe(false);
    expect(normalizeSupporterInput({ name: 'A' }).ok).toBe(false);
  });

  it('collapses whitespace and strips control characters', () => {
    const value = parsed({ name: '  Chinmay \n  Das \u0000 ' });
    expect(value.name).toBe('Chinmay Das');
  });

  it('defaults the tier to supporter and derives its label', () => {
    const value = parsed();
    expect(value.tier).toBe('supporter');
    expect(value.tierLabel).toBe('Supporter');
  });

  it('ignores an unknown tier', () => {
    expect(parsed({ tier: 'diamond' }).tier).toBe('supporter');
  });

  it('keeps a custom tier label', () => {
    const value = parsed({ tier: 'chai', tierLabel: 'Chai Treat' });
    expect(value.tier).toBe('chai');
    expect(value.tierLabel).toBe('Chai Treat');
  });

  it('rejects an over-long message', () => {
    const result = normalizeSupporterInput(valid({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }));
    expect(result.ok).toBe(false);
  });

  it('accepts a message at the limit', () => {
    const result = normalizeSupporterInput(valid({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it('rejects non-http avatar URLs', () => {
    expect(normalizeSupporterInput(valid({ avatarUrl: 'javascript:alert(1)' })).ok).toBe(false);
    expect(normalizeSupporterInput(valid({ avatarUrl: 'not a url' })).ok).toBe(false);
  });

  it('accepts an https avatar URL', () => {
    const result = normalizeSupporterInput(valid({ avatarUrl: 'https://example.com/a.png' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.avatarUrl).toBe('https://example.com/a.png');
  });

  it('treats empty optional fields as absent', () => {
    const value = parsed({ message: '  ', date: '', avatarUrl: '', tierLabel: '' });
    expect(value.message).toBeNull();
    expect(value.date).toBeNull();
    expect(value.avatarUrl).toBeNull();
    expect(value.tierLabel).toBe('Supporter');
  });
});

describe('supporters data layer', () => {
  it('starts empty', async () => {
    expect(await listSupporters(db)).toEqual([]);
    expect(await countSupporters(db)).toBe(0);
  });

  it('adds a supporter and reads it back', async () => {
    const created = await addSupporter(db, parsed({ message: 'Great notes!' }), 'admin-1');

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Chinmay Das');
    expect(created.tier).toBe('supporter');
    expect(created.tierLabel).toBe('Supporter');
    expect(created.message).toBe('Great notes!');

    const fetched = await getSupporterById(db, created.id);
    expect(fetched).toEqual(created);
    expect(await countSupporters(db)).toBe(1);
  });

  it('rejects a duplicate name regardless of case', async () => {
    await addSupporter(db, parsed());
    await expect(addSupporter(db, parsed({ name: 'chinmay das' }))).rejects.toBeInstanceOf(
      DuplicateSupporterError,
    );
    expect(await countSupporters(db)).toBe(1);
  });

  it('lists supporters newest first', async () => {
    // created_at comes from Date.now(); pin distinct timestamps to make order deterministic.
    await db
      .prepare(
        `INSERT INTO supporters (id, name, tier, tier_label, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind('s1', 'Oldest', 'supporter', 'Supporter', 1000)
      .run();
    await db
      .prepare(
        `INSERT INTO supporters (id, name, tier, tier_label, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind('s2', 'Newest', 'supporter', 'Supporter', 3000)
      .run();

    const list = await listSupporters(db);
    expect(list.map((s) => s.name)).toEqual(['Newest', 'Oldest']);
  });

  it('omits absent optional fields from the public payload', async () => {
    const created = await addSupporter(db, parsed());
    expect(created).not.toHaveProperty('message');
    expect(created).not.toHaveProperty('avatarUrl');
    expect(created).not.toHaveProperty('date');
  });

  it('updates an existing supporter', async () => {
    const created = await addSupporter(db, parsed());
    const updated = await updateSupporter(
      db,
      created.id,
      parsed({ name: 'Chinmay D.', tier: 'meal', tierLabel: 'A Full Meal' }),
    );

    expect(updated?.name).toBe('Chinmay D.');
    expect(updated?.tier).toBe('meal');
    expect(updated?.tierLabel).toBe('A Full Meal');
    expect(await countSupporters(db)).toBe(1);
  });

  it('returns null when updating a missing supporter', async () => {
    expect(await updateSupporter(db, 'nope', parsed())).toBeNull();
  });

  it('deletes a supporter', async () => {
    const created = await addSupporter(db, parsed());

    expect(await deleteSupporter(db, created.id)).toBe(true);
    expect(await countSupporters(db)).toBe(0);
    expect(await deleteSupporter(db, created.id)).toBe(false);
  });

  it('caps the roster at MAX_SUPPORTERS-ish limits without erroring', async () => {
    await addSupporter(db, parsed({ name: 'Chinmay Das' }));
    await addSupporter(db, parsed({ name: 'Tanu Tapli' }));

    expect((await listSupporters(db, 1)).map((s) => s.name)).toEqual(['Tanu Tapli']);
    expect(await countSupporters(db)).toBe(2);
  });

  it('falls back to the static list outside D1, including the newest backer', () => {
    const fallback = fallbackSupporterList();
    expect(fallback.map((s) => s.name)).toContain('Chinmay Das');
    expect(fallback.every((s) => !!s.id && !!s.tierLabel)).toBe(true);
  });
});
