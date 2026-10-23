import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import {
  getHiddenSubjectNames,
  isSubjectPublic,
  setSubjectVisibility,
  listSubjectVisibilityMap,
} from '../src/lib/subjectVisibility';
import {
  createTag,
  setSubjectTags,
  getSectionsWithSubjects,
} from '../src/lib/tags';
import type { AuthDb } from '../src/lib/auth/db';

describe('Subject Visibility (Admin Preview Mode)', () => {
  let db: AuthDb;

  beforeEach(() => {
    db = makeDb();
  });

  describe('Database & Service operations', () => {
    it('returns empty hidden set by default when table is empty', async () => {
      const hidden = await getHiddenSubjectNames(db);
      expect(hidden.size).toBe(0);
    });

    it('defaults unknown subjects to public', async () => {
      const isPublic = await isSubjectPublic(db, 'Unknown Subject');
      expect(isPublic).toBe(true);
    });

    it('hides and unhides a subject', async () => {
      await setSubjectVisibility(db, 'Secret Course', false, 'admin_user_1');

      let isPublic = await isSubjectPublic(db, 'Secret Course');
      expect(isPublic).toBe(false);

      let hidden = await getHiddenSubjectNames(db);
      expect(hidden.has('Secret Course')).toBe(true);

      // Unhide
      await setSubjectVisibility(db, 'Secret Course', true, 'admin_user_1');
      isPublic = await isSubjectPublic(db, 'Secret Course');
      expect(isPublic).toBe(true);

      hidden = await getHiddenSubjectNames(db);
      expect(hidden.has('Secret Course')).toBe(false);
    });

    it('handles multiple subjects and lists visibility map', async () => {
      await setSubjectVisibility(db, 'Subject A', false);
      await setSubjectVisibility(db, 'Subject B', true);

      const map = await listSubjectVisibilityMap(db);
      expect(map.get('Subject A')).toBe(false);
      expect(map.get('Subject B')).toBe(true);

      const hidden = await getHiddenSubjectNames(db);
      expect(hidden.size).toBe(1);
      expect(hidden.has('Subject A')).toBe(true);
      expect(hidden.has('Subject B')).toBe(false);
    });

    it('gracefully handles missing DB or errors', async () => {
      const hidden = await getHiddenSubjectNames(null);
      expect(hidden.size).toBe(0);

      const isPub = await isSubjectPublic(null, 'Any Subject');
      expect(isPub).toBe(true);

      const map = await listSubjectVisibilityMap(null);
      expect(map.size).toBe(0);
    });
  });

  describe('Sections filtering for non-admin vs admin', () => {
    const mockCatalog = [
      { subject: 'Public Math', description: 'Math lectures', lectures: [{ scope: 'lecture' }] },
      { subject: 'Secret Quantum', description: 'Unreleased lectures', lectures: [{ scope: 'lecture' }] },
    ];

    it('hides unreleased subjects from non-admin users in tagged catalog', async () => {
      const tag = await createTag(db, { name: 'Sem 1', slug: 'sem-1' });
      await setSubjectTags(db, 'Public Math', [tag.id]);
      await setSubjectTags(db, 'Secret Quantum', [tag.id]);

      // Hide Secret Quantum
      await setSubjectVisibility(db, 'Secret Quantum', false);

      // Non-admin request
      const nonAdminResult = await getSectionsWithSubjects(db, mockCatalog as any, { isAdmin: false });
      expect(nonAdminResult.sections.length).toBe(1);
      const subjectsInTag = nonAdminResult.sections[0].subjects;
      expect(subjectsInTag.map((s) => s.name)).toEqual(['Public Math']);
      expect(subjectsInTag.some((s) => s.name === 'Secret Quantum')).toBe(false);

      // Admin request
      const adminResult = await getSectionsWithSubjects(db, mockCatalog as any, { isAdmin: true });
      expect(adminResult.sections.length).toBe(1);
      const adminSubjects = adminResult.sections[0].subjects;
      expect(adminSubjects.map((s) => s.name)).toContain('Public Math');
      expect(adminSubjects.map((s) => s.name)).toContain('Secret Quantum');

      const quantumSubject = adminSubjects.find((s) => s.name === 'Secret Quantum');
      expect(quantumSubject?.isHidden).toBe(true);
    });

    it('hides unreleased subjects from non-admin users in fallback (semester) catalog', async () => {
      const fallbackCatalog = [
        { subject: 'Visible Physics', semester: 1, lectures: [{ scope: 'lecture' }] },
        { subject: 'Draft Biology', semester: 1, lectures: [{ scope: 'lecture' }] },
      ];

      await setSubjectVisibility(db, 'Draft Biology', false);

      // Non-admin
      const nonAdmin = await getSectionsWithSubjects(db, fallbackCatalog as any, { isAdmin: false });
      const nonAdminSubs = nonAdmin.sections.flatMap((s) => s.subjects.map((sub) => sub.name));
      expect(nonAdminSubs).toContain('Visible Physics');
      expect(nonAdminSubs).not.toContain('Draft Biology');

      // Admin
      const admin = await getSectionsWithSubjects(db, fallbackCatalog as any, { isAdmin: true });
      const adminSubs = admin.sections.flatMap((s) => s.subjects);
      expect(adminSubs.map((s) => s.name)).toContain('Visible Physics');
      expect(adminSubs.map((s) => s.name)).toContain('Draft Biology');

      const draftBio = adminSubs.find((s) => s.name === 'Draft Biology');
      expect(draftBio?.isHidden).toBe(true);
    });
  });
});
