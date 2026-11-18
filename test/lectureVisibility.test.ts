import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeDb } from './setup';
import {
  getHiddenLectureKeys,
  isLecturePublic,
  setLectureVisibility,
  listLectureVisibilityMap,
  invalidateLectureVisibilityCache,
  computeHiddenLectureFingerprint,
  filterVisibleLectures,
  isLectureHiddenForViewer,
  isLecturePublicBySettings,
  seedLectureVisibilityDefaults,
  makeLectureKey,
  LectureVisibilityUnavailableError,
} from '../src/lib/lectureVisibility';
import {
  isSubjectPublic,
  setSubjectAutoHide,
  getAutoHideLectureSubjectNames,
  listSubjectAutoHideMap,
  invalidateSubjectVisibilityCache,
} from '../src/lib/subjectVisibility';
import type { AuthDb } from '../src/lib/auth/db';

describe('Lecture Visibility (per-lecture admin preview)', () => {
  let db: AuthDb;

  beforeEach(() => {
    db = makeDb();
    invalidateLectureVisibilityCache();
    invalidateSubjectVisibilityCache();
  });

  describe('Database & service operations', () => {
    it('returns empty hidden set by default when table is empty', async () => {
      const hidden = await getHiddenLectureKeys(db);
      expect(hidden.size).toBe(0);
    });

    it('defaults unknown lectures to public', async () => {
      expect(await isLecturePublic(db, 'Math', 'Lecture 1')).toBe(true);
    });

    it('hides and unhides a single lecture without affecting its siblings', async () => {
      await setLectureVisibility(db, 'Math', 'Lecture 1', false, 'admin_user_1');
      await setLectureVisibility(db, 'Math', 'Lecture 2', true, 'admin_user_1');

      expect(await isLecturePublic(db, 'Math', 'Lecture 1')).toBe(false);
      expect(await isLecturePublic(db, 'Math', 'Lecture 2')).toBe(true);
      expect(await isLecturePublic(db, 'Physics', 'Lecture 1')).toBe(true);

      let hidden = await getHiddenLectureKeys(db);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(true);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 2'))).toBe(false);

      // Case-insensitive lookups
      expect(await isLecturePublic(db, 'math', 'lecture 1')).toBe(false);

      // Unhide restores public visibility
      await setLectureVisibility(db, 'Math', 'Lecture 1', true, 'admin_user_1');
      expect(await isLecturePublic(db, 'Math', 'Lecture 1')).toBe(true);
      hidden = await getHiddenLectureKeys(db);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(false);
    });

    it('handles multiple subjects and lists the visibility map', async () => {
      await setLectureVisibility(db, 'Subject A', 'L1', false);
      await setLectureVisibility(db, 'Subject B', 'L1', true);

      const map = await listLectureVisibilityMap(db);
      expect(map.get(makeLectureKey('Subject A', 'L1'))).toBe(false);
      expect(map.get(makeLectureKey('Subject B', 'L1'))).toBe(true);

      const hidden = await getHiddenLectureKeys(db);
      expect(hidden.size).toBe(1);
      expect(hidden.has(makeLectureKey('Subject A', 'L1'))).toBe(true);
    });

    it('gracefully handles missing DB in test environment', async () => {
      expect((await getHiddenLectureKeys(null)).size).toBe(0);
      expect(await isLecturePublic(null, 'Any', 'L1')).toBe(true);
      expect((await listLectureVisibilityMap(null)).size).toBe(0);
    });

    it('fails closed when the DB query throws on first call', async () => {
      const failingDb: AuthDb = {
        prepare: vi.fn(() => {
          throw new Error('D1 transient network failure');
        }),
        exec: vi.fn(async () => ({} as any)),
      };

      await expect(getHiddenLectureKeys(failingDb)).rejects.toThrow(
        LectureVisibilityUnavailableError,
      );
    });

    it('returns stale cached set when DB throws after a successful call', async () => {
      await setLectureVisibility(db, 'Cached', 'Secret Lecture', false);
      const initial = await getHiddenLectureKeys(db);
      expect(initial.has(makeLectureKey('Cached', 'Secret Lecture'))).toBe(true);

      // Force cache expiry by advancing time past the TTL.
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
      const brokenDb: AuthDb = {
        prepare: vi.fn(() => {
          throw new Error('D1 query failure after cache');
        }),
        exec: vi.fn(async () => ({} as any)),
      };

      const fallback = await getHiddenLectureKeys(brokenDb);
      expect(fallback.has(makeLectureKey('Cached', 'Secret Lecture'))).toBe(true);
      nowSpy.mockRestore();
    });
  });

  describe('Viewer filtering', () => {
    const lectures = [
      { folderName: 'Lecture 1' },
      { folderName: 'Lecture 2' },
      { folderName: 'Lecture 3' },
    ];

    it('removes hidden lectures for non-admins but keeps them for admins', async () => {
      await setLectureVisibility(db, 'Math', 'Lecture 2', false);
      const hidden = await getHiddenLectureKeys(db);

      const publicLectures = filterVisibleLectures(lectures, 'Math', hidden, false);
      expect(publicLectures.map((l) => l.folderName)).toEqual(['Lecture 1', 'Lecture 3']);

      const adminLectures = filterVisibleLectures(lectures, 'Math', hidden, true);
      expect(adminLectures.map((l) => l.folderName)).toEqual([
        'Lecture 1',
        'Lecture 2',
        'Lecture 3',
      ]);
    });

    it('scopes hidden lectures to their subject', async () => {
      await setLectureVisibility(db, 'Math', 'Lecture 2', false);
      const hidden = await getHiddenLectureKeys(db);

      expect(isLectureHiddenForViewer('Math', 'Lecture 2', hidden, false)).toBe(true);
      expect(isLectureHiddenForViewer('Physics', 'Lecture 2', hidden, false)).toBe(false);
      expect(isLectureHiddenForViewer('Math', 'Lecture 2', hidden, true)).toBe(false);
    });
  });

  describe('Cache keys', () => {
    it('computeHiddenLectureFingerprint is stable and order-independent', async () => {
      const a = await computeHiddenLectureFingerprint(new Set(['math::l1', 'math::l2']));
      const b = await computeHiddenLectureFingerprint(new Set(['math::l2', 'math::l1']));
      const c = await computeHiddenLectureFingerprint(new Set(['math::l1', 'phys::l1']));

      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a.length).toBe(16);
    });
  });

  describe('Auto-hide new lectures', () => {
    const catalog = [
      {
        subject: 'Math',
        lectures: [
          { folderName: 'Lecture 1' },
          { folderName: 'Lecture 2' },
        ],
      },
      {
        subject: 'Physics',
        lectures: [{ folderName: 'Lecture 1' }],
      },
    ];

    it('stores and lists the per-subject setting without changing subject visibility', async () => {
      const result = await setSubjectAutoHide(db, 'Math', true, 'admin_1');
      expect(result).toEqual({ subjectName: 'Math', hideNewLectures: true });

      expect((await getAutoHideLectureSubjectNames(db)).has('math')).toBe(true);
      expect((await listSubjectAutoHideMap(db)).get('Math')).toBe(true);

      // Subject visibility is independent and unaffected.
      expect(await isSubjectPublic(db, 'Math')).toBe(true);

      await setSubjectAutoHide(db, 'Math', false, 'admin_1');
      expect((await getAutoHideLectureSubjectNames(db)).has('math')).toBe(false);
    });

    it('infers unconfigured lectures as hidden only in auto-hide subjects', async () => {
      await setSubjectAutoHide(db, 'Math', true);

      const hidden = await getHiddenLectureKeys(db, catalog as any);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(true);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 2'))).toBe(true);
      expect(hidden.has(makeLectureKey('Physics', 'Lecture 1'))).toBe(false);

      const visible = filterVisibleLectures(
        catalog[0].lectures,
        'Math',
        hidden,
        false,
      );
      expect(visible).toEqual([]);
    });

    it('keeps lectures explicitly published public after auto-hide is enabled', async () => {
      // Simulate the admin enable flow: snapshot existing lectures as public,
      // then turn auto-hide on.
      const seeded = await seedLectureVisibilityDefaults(
        db,
        'Math',
        catalog[0].lectures,
        true,
        'admin_1',
      );
      expect(seeded).toBe(2);
      await setSubjectAutoHide(db, 'Math', true);
      invalidateLectureVisibilityCache();

      const hidden = await getHiddenLectureKeys(db, catalog as any);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(false);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 2'))).toBe(false);

      // A newly added lecture has no row -> hidden by default.
      const withNewLecture = [
        ...catalog,
        { subject: 'Math', lectures: [{ folderName: 'Lecture 3' }] },
      ];
      invalidateLectureVisibilityCache();
      const hiddenAfterNew = await getHiddenLectureKeys(db, withNewLecture as any);
      expect(hiddenAfterNew.has(makeLectureKey('Math', 'Lecture 3'))).toBe(true);
      expect(hiddenAfterNew.has(makeLectureKey('Math', 'Lecture 1'))).toBe(false);
    });

    it('snapshots hidden lectures when auto-hide is turned off so state is preserved', async () => {
      await setSubjectAutoHide(db, 'Math', true);
      let hidden = await getHiddenLectureKeys(db, catalog as any);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(true);

      const seeded = await seedLectureVisibilityDefaults(
        db,
        'Math',
        catalog[0].lectures,
        false,
        'admin_1',
      );
      expect(seeded).toBe(2);
      await setSubjectAutoHide(db, 'Math', false);
      invalidateLectureVisibilityCache();

      hidden = await getHiddenLectureKeys(db, catalog as any);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 1'))).toBe(true);
      expect(hidden.has(makeLectureKey('Math', 'Lecture 2'))).toBe(true);
    });

    it('computes effective visibility from explicit rows and the auto-hide flag', () => {
      const explicit = new Map<string, boolean>([[makeLectureKey('Math', 'Lecture 1'), true]]);
      const autoHide = new Set(['math']);

      expect(isLecturePublicBySettings('Math', 'Lecture 1', explicit, autoHide)).toBe(true);
      expect(isLecturePublicBySettings('Math', 'Lecture 2', explicit, autoHide)).toBe(false);
      expect(isLecturePublicBySettings('Physics', 'Lecture 1', explicit, autoHide)).toBe(true);
    });
  });
});
