import { describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from './setup';
import {
  createTag,
  updateTag,
  deleteTag,
  listTags,
  getTagById,
  getTagBySlug,
  reorderTags,
  setSubjectTags,
  getTagsForSubject,
  listSubjectTagsMap,
  reorderSubjectsInTag,
  seedTagsFromCatalog,
  getSectionsWithSubjects,
  TAG_COLOR_CLASSES,
} from '../src/lib/tags';
import type { AuthDb } from '../src/lib/auth/db';

describe('Subject Tags & Organization System', () => {
  let db: AuthDb;

  beforeEach(() => {
    db = makeDb();
  });

  describe('Tag CRUD operations', () => {
    it('creates a new tag with custom color, description, and display order', async () => {
      const tag = await createTag(db, {
        name: 'Featured Notes',
        slug: 'featured-notes',
        description: 'Top recommended lecture series',
        color: 'amber',
        displayOrder: 0,
        isVisible: true,
      });

      expect(tag.id).toBeDefined();
      expect(tag.name).toBe('Featured Notes');
      expect(tag.slug).toBe('featured-notes');
      expect(tag.description).toBe('Top recommended lecture series');
      expect(tag.color).toBe('amber');
      expect(tag.displayOrder).toBe(0);
      expect(tag.isVisible).toBe(true);

      const byId = await getTagById(db, tag.id);
      expect(byId?.name).toBe('Featured Notes');

      const bySlug = await getTagBySlug(db, 'featured-notes');
      expect(bySlug?.id).toBe(tag.id);
    });

    it('prevents creating duplicate tag names or slugs', async () => {
      await createTag(db, { name: 'Core AI', slug: 'core-ai' });

      await expect(createTag(db, { name: 'Core AI', slug: 'different-slug' })).rejects.toThrow(
        /already exists/i
      );

      await expect(createTag(db, { name: 'Different Name', slug: 'core-ai' })).rejects.toThrow(
        /already exists/i
      );
    });

    it('updates tag properties including color and visibility', async () => {
      const tag = await createTag(db, { name: 'Sem 1', slug: 'sem-1', color: 'blue' });

      const updated = await updateTag(db, tag.id, {
        name: 'Semester 1 Foundational',
        color: 'emerald',
        isVisible: false,
        description: 'First semester courses',
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Semester 1 Foundational');
      expect(updated?.color).toBe('emerald');
      expect(updated?.isVisible).toBe(false);
      expect(updated?.description).toBe('First semester courses');

      // Hidden tags are excluded by default in listTags unless includeHidden is true
      const visibleTags = await listTags(db, { includeHidden: false });
      expect(visibleTags.some((t) => t.id === tag.id)).toBe(false);

      const allTags = await listTags(db, { includeHidden: true });
      expect(allTags.some((t) => t.id === tag.id)).toBe(true);
    });

    it('deletes a tag and cascades deletion from subject_tags', async () => {
      const tag = await createTag(db, { name: 'Temporary', slug: 'temp' });
      await setSubjectTags(db, 'Machine Learning', [tag.id]);

      let assigned = await getTagsForSubject(db, 'Machine Learning');
      expect(assigned.length).toBe(1);

      const deleted = await deleteTag(db, tag.id);
      expect(deleted).toBe(true);

      assigned = await getTagsForSubject(db, 'Machine Learning');
      expect(assigned.length).toBe(0);
    });

    it('reorders tags to rank how sections appear on homepage', async () => {
      const t1 = await createTag(db, { name: 'Tag 1', slug: 't1', displayOrder: 0 });
      const t2 = await createTag(db, { name: 'Tag 2', slug: 't2', displayOrder: 1 });
      const t3 = await createTag(db, { name: 'Tag 3', slug: 't3', displayOrder: 2 });

      // Move Tag 3 to top, then Tag 1, then Tag 2
      await reorderTags(db, [t3.id, t1.id, t2.id]);

      const ordered = await listTags(db);
      expect(ordered[0].id).toBe(t3.id);
      expect(ordered[0].displayOrder).toBe(0);
      expect(ordered[1].id).toBe(t1.id);
      expect(ordered[1].displayOrder).toBe(1);
      expect(ordered[2].id).toBe(t2.id);
      expect(ordered[2].displayOrder).toBe(2);
    });
  });

  describe('Subject-Tag Multi-Assignment and Per-Tag Ranking', () => {
    it('allows attaching multiple tags to a single subject folder', async () => {
      const featured = await createTag(db, { name: 'Featured', slug: 'featured', color: 'amber', displayOrder: 0 });
      const sem1 = await createTag(db, { name: 'Semester 1', slug: 'sem-1', color: 'blue', displayOrder: 1 });
      const core = await createTag(db, { name: 'Core Foundations', slug: 'core', color: 'purple', displayOrder: 2 });

      // Attach all 3 tags to Machine Learning
      await setSubjectTags(db, 'Machine Learning', [featured.id, sem1.id, core.id]);

      const tags = await getTagsForSubject(db, 'Machine Learning');
      expect(tags.length).toBe(3);
      expect(tags.map((t) => t.name)).toEqual(['Featured', 'Semester 1', 'Core Foundations']);

      // Check map
      const map = await listSubjectTagsMap(db);
      expect(map.get('Machine Learning')?.length).toBe(3);
    });

    it('replaces tags cleanly when re-assigning', async () => {
      const t1 = await createTag(db, { name: 'Tag 1', slug: 't1' });
      const t2 = await createTag(db, { name: 'Tag 2', slug: 't2' });

      await setSubjectTags(db, 'Deep Learning', [t1.id]);
      let tags = await getTagsForSubject(db, 'Deep Learning');
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe(t1.id);

      await setSubjectTags(db, 'Deep Learning', [t2.id]);
      tags = await getTagsForSubject(db, 'Deep Learning');
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe(t2.id);
    });

    it('ranks subjects within a tag section', async () => {
      const featured = await createTag(db, { name: 'Featured', slug: 'featured' });
      await setSubjectTags(db, 'Subject A', [featured.id]);
      await setSubjectTags(db, 'Subject B', [featured.id]);
      await setSubjectTags(db, 'Subject C', [featured.id]);

      // Reorder subjects within 'Featured': B first, then C, then A
      await reorderSubjectsInTag(db, featured.id, ['Subject B', 'Subject C', 'Subject A']);

      const mockCatalog = [
        { subject: 'Subject A', lectures: [{ scope: 'lecture' }] },
        { subject: 'Subject B', lectures: [{ scope: 'lecture' }] },
        { subject: 'Subject C', lectures: [{ scope: 'lecture' }] },
      ];

      const { sections } = await getSectionsWithSubjects(db, mockCatalog as any);
      expect(sections.length).toBe(1);
      expect(sections[0].subjects.map((s) => s.name)).toEqual(['Subject B', 'Subject C', 'Subject A']);
    });
  });

  describe('Catalog Seeding & Homepage Sections Builder', () => {
    it('seeds default tags and assigns them based on semester numbers', async () => {
      const mockCatalog = [
        { subject: 'Machine Learning', semester: 1, order: 1 },
        { subject: 'Computer Vision', semester: 2, order: 11 },
        { subject: 'General Math', semester: undefined, order: 999 },
      ];

      const { tagsCreated, assignmentsCreated } = await seedTagsFromCatalog(db, mockCatalog);
      expect(tagsCreated).toBe(4); // Featured, Semester 2, Semester 1, Basics
      expect(assignmentsCreated).toBe(3);

      const mlTags = await getTagsForSubject(db, 'Machine Learning');
      expect(mlTags.some((t) => t.slug === 'semester-1')).toBe(true);

      const cvTags = await getTagsForSubject(db, 'Computer Vision');
      expect(cvTags.some((t) => t.slug === 'semester-2')).toBe(true);

      const mathTags = await getTagsForSubject(db, 'General Math');
      expect(mathTags.some((t) => t.slug === 'basics')).toBe(true);
    });

    it('displays multi-tagged subjects across multiple sections in getSectionsWithSubjects', async () => {
      const featured = await createTag(db, { name: 'Featured', slug: 'featured', displayOrder: 0 });
      const sem1 = await createTag(db, { name: 'Semester 1', slug: 'semester-1', displayOrder: 1 });

      // 'Machine Learning' is both Featured AND Semester 1
      await setSubjectTags(db, 'Machine Learning', [featured.id, sem1.id]);
      // 'Calculus' is only Semester 1
      await setSubjectTags(db, 'Calculus', [sem1.id]);

      const mockCatalog = [
        { subject: 'Machine Learning', description: 'ML Desc', lectures: [{ scope: 'lecture' }] },
        { subject: 'Calculus', description: 'Calc Desc', lectures: [{ scope: 'lecture' }] },
      ];

      const { sections, usingTags } = await getSectionsWithSubjects(db, mockCatalog as any);
      expect(usingTags).toBe(true);
      expect(sections.length).toBe(2);

      // Section 0 is Featured (rank 0)
      expect(sections[0].title).toBe('Featured');
      expect(sections[0].subjects.map((s) => s.name)).toEqual(['Machine Learning']);
      // Machine Learning card carries all its attached tag badges
      expect(sections[0].subjects[0].tags.map((t) => t.name)).toContain('Featured');
      expect(sections[0].subjects[0].tags.map((t) => t.name)).toContain('Semester 1');

      // Section 1 is Semester 1 (rank 1)
      expect(sections[1].title).toBe('Semester 1');
      expect(sections[1].subjects.map((s) => s.name)).toContain('Machine Learning');
      expect(sections[1].subjects.map((s) => s.name)).toContain('Calculus');
    });

    it('falls back gracefully to file-based semester grouping when DB is unpopulated', async () => {
      // Empty DB
      const mockCatalog = [
        { subject: 'Natural Language Processing', semester: 2, lectures: [{ scope: 'lecture' }] },
        { subject: 'Machine Learning', semester: 1, lectures: [{ scope: 'lecture' }] },
        { subject: 'Basics Resource', lectures: [{ scope: 'lecture' }] },
      ];

      const { sections, usingTags } = await getSectionsWithSubjects(db, mockCatalog as any);
      expect(usingTags).toBe(false);
      expect(sections.length).toBe(3);
      expect(sections[0].title).toBe('Semester 2');
      expect(sections[1].title).toBe('Semester 1');
      expect(sections[2].title).toBe('Basics');
    });

    it('provides valid badge styling for all defined tag colors', () => {
      for (const color of ['accent', 'amber', 'emerald', 'blue', 'purple', 'rose', 'cyan'] as const) {
        const classes = TAG_COLOR_CLASSES[color];
        expect(classes.badge).toBeDefined();
        expect(classes.badge).toContain(color === 'accent' ? 'var(--accent)' : color);
      }
    });
  });
});
