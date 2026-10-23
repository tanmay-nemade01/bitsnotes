/**
 * tags.ts
 *
 * Subject Tags & Section Organization data-access layer.
 *
 * Provides dynamic tag management and subject-tag assignment in Cloudflare D1.
 * Admins can:
 *  - Create custom tags (e.g. 'Featured', 'Semester 1', 'Electives', 'Crash Course').
 *  - Rank tags to determine the order sections appear on the homepage (top to bottom).
 *  - Toggle tag section visibility (show/hide draft sections).
 *  - Assign multiple tags to a single subject (e.g. a subject can be both 'Semester 1' and 'Featured').
 *  - Rank subjects within a tag section to control display priority.
 *  - One-click seed from existing catalog structure.
 */

import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';
import { slugify } from '../utils/lectureDisplay';
import { getHiddenSubjectNames } from './subjectVisibility';

// ─── Constants & Types ────────────────────────────────────────────────────────

export const TAG_COLORS = ['accent', 'amber', 'emerald', 'blue', 'purple', 'rose', 'cyan'] as const;
export type TagColor = typeof TAG_COLORS[number];

export const TAG_COLOR_CLASSES: Record<TagColor, { badge: string; border: string; text: string }> = {
  accent: {
    badge: 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent)]/30',
    border: 'border-[var(--accent)]',
    text: 'text-[var(--accent)]',
  },
  amber: {
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    border: 'border-amber-500',
    text: 'text-amber-500',
  },
  emerald: {
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    border: 'border-emerald-500',
    text: 'text-emerald-500',
  },
  blue: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    border: 'border-blue-500',
    text: 'text-blue-500',
  },
  purple: {
    badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
    border: 'border-purple-500',
    text: 'text-purple-500',
  },
  rose: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    border: 'border-rose-500',
    text: 'text-rose-500',
  },
  cyan: {
    badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    border: 'border-cyan-500',
    text: 'text-cyan-500',
  },
};

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  display_order: number;
  is_visible: number;
  created_at: number;
  updated_at: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color: TagColor;
  displayOrder: number;
  isVisible: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SubjectTagRow {
  id: string;
  subject_name: string;
  tag_id: string;
  display_order: number;
  created_at: number;
}

export interface SubjectTagJoinRow extends TagRow {
  subject_name: string;
  subject_display_order: number;
}

export interface TagSectionViewModel {
  id: string;
  tagId: string;
  title: string;
  slug: string;
  description?: string;
  color: TagColor;
  displayOrder: number;
  subjects: Array<{
    name: string;
    description: string;
    lectureCount: number;
    additionalCount: number;
    order: number;
    isHidden?: boolean;
    tags: Array<{ id: string; name: string; color: TagColor; slug: string }>;
  }>;
}

function clean(value: unknown, maxLen = 100): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function normalizeColor(color: unknown): TagColor {
  if (typeof color === 'string' && (TAG_COLORS as readonly string[]).includes(color)) {
    return color as TagColor;
  }
  return 'accent';
}

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    color: normalizeColor(row.color),
    displayOrder: Number(row.display_order) || 0,
    isVisible: Number(row.is_visible) === 1,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

// ─── Tag Reads ───────────────────────────────────────────────────────────────

export async function listTags(db: AuthDb, options?: { includeHidden?: boolean }): Promise<Tag[]> {
  const whereClause = options?.includeHidden ? '' : 'WHERE is_visible = 1';
  const rows = await db
    .prepare(`SELECT * FROM tags ${whereClause} ORDER BY display_order ASC, created_at ASC`)
    .all<TagRow>();
  return (rows.results ?? []).map(toTag);
}

export async function getTagById(db: AuthDb, id: string): Promise<Tag | null> {
  const row = await db.prepare('SELECT * FROM tags WHERE id = ?').bind(id).first<TagRow>();
  return row ? toTag(row) : null;
}

export async function getTagBySlug(db: AuthDb, slug: string): Promise<Tag | null> {
  const row = await db.prepare('SELECT * FROM tags WHERE slug = ?').bind(slug).first<TagRow>();
  return row ? toTag(row) : null;
}

// ─── Tag Mutations ───────────────────────────────────────────────────────────

export interface CreateTagInput {
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  displayOrder?: number;
  isVisible?: boolean;
}

export async function createTag(db: AuthDb, input: CreateTagInput): Promise<Tag> {
  const name = clean(input.name, 60);
  if (!name) throw new Error('Tag name is required.');

  const slug = clean(input.slug || slugify(name), 60);
  if (!slug) throw new Error('Tag slug is invalid.');

  const existing = await db
    .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE OR slug = ? COLLATE NOCASE')
    .bind(name, slug)
    .first();
  if (existing) {
    throw new Error(`A tag with name "${name}" or slug "${slug}" already exists.`);
  }

  const id = uuidv7();
  const now = Date.now();
  const description = input.description ? clean(input.description, 200) : null;
  const color = normalizeColor(input.color);
  
  let displayOrder = input.displayOrder;
  if (displayOrder === undefined || displayOrder === null) {
    const maxRow = await db.prepare('SELECT MAX(display_order) as max_order FROM tags').first<{ max_order: number | null }>();
    displayOrder = (maxRow?.max_order ?? -1) + 1;
  }

  const isVisible = input.isVisible === false ? 0 : 1;

  await db
    .prepare(
      `INSERT INTO tags (id, name, slug, description, color, display_order, is_visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, name, slug, description, color, displayOrder, isVisible, now, now)
    .run();

  const created = await getTagById(db, id);
  if (!created) throw new Error('Tag was created but could not be read back.');
  return created;
}

export interface UpdateTagInput {
  name?: string;
  slug?: string;
  description?: string;
  color?: string;
  displayOrder?: number;
  isVisible?: boolean;
}

export async function updateTag(db: AuthDb, id: string, input: UpdateTagInput): Promise<Tag | null> {
  const existing = await getTagById(db, id);
  if (!existing) return null;

  const name = input.name !== undefined ? clean(input.name, 60) : existing.name;
  if (!name) throw new Error('Tag name cannot be empty.');

  const slug = input.slug !== undefined ? clean(input.slug, 60) : existing.slug;
  if (!slug) throw new Error('Tag slug cannot be empty.');

  // Check unique collision with another tag
  const collision = await db
    .prepare('SELECT id FROM tags WHERE (name = ? COLLATE NOCASE OR slug = ? COLLATE NOCASE) AND id != ?')
    .bind(name, slug, id)
    .first();
  if (collision) {
    throw new Error(`Another tag with name "${name}" or slug "${slug}" already exists.`);
  }

  const description = input.description !== undefined ? clean(input.description, 200) : (existing.description || null);
  const color = input.color !== undefined ? normalizeColor(input.color) : existing.color;
  const displayOrder = input.displayOrder !== undefined ? Number(input.displayOrder) : existing.displayOrder;
  const isVisible = input.isVisible !== undefined ? (input.isVisible ? 1 : 0) : (existing.isVisible ? 1 : 0);
  const now = Date.now();

  await db
    .prepare(
      `UPDATE tags
       SET name = ?, slug = ?, description = ?, color = ?, display_order = ?, is_visible = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(name, slug, description, color, displayOrder, isVisible, now, id)
    .run();

  return getTagById(db, id);
}

export async function deleteTag(db: AuthDb, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  return Number((res as any)?.meta?.changes ?? 0) > 0;
}

export async function reorderTags(db: AuthDb, orderedIds: string[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .prepare('UPDATE tags SET display_order = ?, updated_at = ? WHERE id = ?')
      .bind(i, now, orderedIds[i])
      .run();
  }
}

// ─── Subject Tags (Assignments) ──────────────────────────────────────────────

export async function listSubjectTagsMap(db: AuthDb): Promise<Map<string, Tag[]>> {
  const rows = await db
    .prepare(
      `SELECT t.*, st.subject_name, st.display_order as subject_display_order
       FROM subject_tags st
       JOIN tags t ON st.tag_id = t.id
       ORDER BY t.display_order ASC, st.display_order ASC`
    )
    .all<SubjectTagJoinRow>();

  const map = new Map<string, Tag[]>();
  for (const row of rows.results ?? []) {
    const sName = row.subject_name;
    if (!map.has(sName)) {
      map.set(sName, []);
    }
    map.get(sName)!.push(toTag(row));
  }
  return map;
}

export async function getTagsForSubject(db: AuthDb, subjectName: string): Promise<Tag[]> {
  const rows = await db
    .prepare(
      `SELECT t.*
       FROM subject_tags st
       JOIN tags t ON st.tag_id = t.id
       WHERE st.subject_name = ?
       ORDER BY t.display_order ASC`
    )
    .bind(subjectName)
    .all<TagRow>();

  return (rows.results ?? []).map(toTag);
}

export async function setSubjectTags(db: AuthDb, subjectName: string, tagIds: string[]): Promise<void> {
  const canonicalName = clean(subjectName, 120);
  if (!canonicalName) throw new Error('Subject name is required.');

  // Delete current assignments for this subject
  await db.prepare('DELETE FROM subject_tags WHERE subject_name = ?').bind(canonicalName).run();

  // Insert new assignments
  const now = Date.now();
  for (let i = 0; i < tagIds.length; i++) {
    const tagId = tagIds[i];
    const id = uuidv7();
    await db
      .prepare(
        `INSERT OR IGNORE INTO subject_tags (id, subject_name, tag_id, display_order, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, canonicalName, tagId, i, now)
      .run();
  }
}

export async function reorderSubjectsInTag(
  db: AuthDb,
  tagId: string,
  orderedSubjectNames: string[]
): Promise<void> {
  for (let i = 0; i < orderedSubjectNames.length; i++) {
    await db
      .prepare('UPDATE subject_tags SET display_order = ? WHERE tag_id = ? AND subject_name = ?')
      .bind(i, tagId, orderedSubjectNames[i])
      .run();
  }
}

// ─── Seeding from Catalog ───────────────────────────────────────────────────

export async function seedTagsFromCatalog(
  db: AuthDb,
  catalogSubjects: Array<{ subject: string; semester?: number; order?: number }>
): Promise<{ tagsCreated: number; assignmentsCreated: number }> {
  let tagsCreated = 0;
  let assignmentsCreated = 0;

  // Ensure standard default tags exist
  const defaultTags = [
    { name: 'Featured', slug: 'featured', description: 'Core recommended subjects and flagship lecture notes.', color: 'amber', displayOrder: 0 },
    { name: 'Semester 2', slug: 'semester-2', description: 'Second semester postgraduate AI & ML modules.', color: 'emerald', displayOrder: 1 },
    { name: 'Semester 1', slug: 'semester-1', description: 'First semester foundational courses and prerequisites.', color: 'blue', displayOrder: 2 },
    { name: 'Basics', slug: 'basics', description: 'Introductory and refresher materials.', color: 'purple', displayOrder: 3 },
  ];

  const tagMap = new Map<string, string>(); // slug -> tag.id

  for (const t of defaultTags) {
    let existing = await getTagBySlug(db, t.slug);
    if (!existing) {
      existing = await createTag(db, {
        name: t.name,
        slug: t.slug,
        description: t.description,
        color: t.color,
        displayOrder: t.displayOrder,
      });
      tagsCreated++;
    }
    tagMap.set(t.slug, existing.id);
  }

  // Tag subjects based on their declared semester/order
  const now = Date.now();
  for (const item of catalogSubjects) {
    const sName = item.subject;
    const sem = item.semester;
    let targetTagSlug = 'basics';
    if (sem === 1) targetTagSlug = 'semester-1';
    else if (sem === 2) targetTagSlug = 'semester-2';

    const targetTagId = tagMap.get(targetTagSlug);
    if (!targetTagId) continue;

    // Check if assignment already exists
    const existing = await db
      .prepare('SELECT id FROM subject_tags WHERE subject_name = ? AND tag_id = ?')
      .bind(sName, targetTagId)
      .first();

    if (!existing) {
      const order = item.order ?? 999;
      await db
        .prepare(
          `INSERT INTO subject_tags (id, subject_name, tag_id, display_order, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(uuidv7(), sName, targetTagId, order, now)
        .run();
      assignmentsCreated++;
    }
  }

  return { tagsCreated, assignmentsCreated };
}

// ─── Homepage Sections Builder ──────────────────────────────────────────────

export async function getSectionsWithSubjects(
  db: AuthDb | undefined,
  catalog: Array<{
    subject: string;
    description?: string;
    order?: number;
    semester?: number;
    lectures: Array<{ scope: string }>;
  }>,
  options?: { isAdmin?: boolean }
): Promise<{ sections: TagSectionViewModel[]; usingTags: boolean }> {
  const hiddenSubjectNames = await getHiddenSubjectNames(db);
  const isAdmin = options?.isAdmin ?? false;

  // Build a fast lookup map for subject details from catalog
  const catalogMap = new Map(
    catalog.map((s) => {
      const lectures = s.lectures.filter((l) => l.scope === 'lecture');
      const additional = s.lectures.filter((l) => l.scope !== 'lecture');
      return [
        s.subject,
        {
          name: s.subject,
          description: s.description || 'Lecture notes and study resources for this subject.',
          lectureCount: lectures.length,
          additionalCount: additional.length,
          order: s.order ?? 999,
          semester: s.semester,
        },
      ];
    })
  );

  // For non-admins, completely remove hidden subjects so they never appear on the homepage
  if (!isAdmin && hiddenSubjectNames.size > 0) {
    for (const hidden of hiddenSubjectNames) {
      catalogMap.delete(hidden);
    }
  }

  // If DB is available, attempt to build sections from dynamic tags
  if (db) {
    try {
      const tags = await listTags(db, { includeHidden: false });
      if (tags.length > 0) {
        // Fetch all subject_tags join rows
        const subjectTagsRows = await db
          .prepare(
            `SELECT st.tag_id, st.subject_name, st.display_order
             FROM subject_tags st
             JOIN tags t ON st.tag_id = t.id
             WHERE t.is_visible = 1
             ORDER BY st.display_order ASC, st.subject_name ASC`
          )
          .all<{ tag_id: string; subject_name: string; display_order: number }>();

        const subjectTagsMap = await listSubjectTagsMap(db);

        // Group subjects by tag
        const tagSubjectsMap = new Map<string, Array<{ name: string; displayOrder: number }>>();
        for (const row of subjectTagsRows.results ?? []) {
          if (!tagSubjectsMap.has(row.tag_id)) {
            tagSubjectsMap.set(row.tag_id, []);
          }
          tagSubjectsMap.get(row.tag_id)!.push({
            name: row.subject_name,
            displayOrder: row.display_order,
          });
        }

        const sections: TagSectionViewModel[] = [];
        const seenInSections = new Set<string>();

        for (const tag of tags) {
          const subjectsForTag = tagSubjectsMap.get(tag.id) || [];
          const sectionSubjects = [];

          for (const item of subjectsForTag) {
            const catInfo = catalogMap.get(item.name);
            if (!catInfo) continue; // subject folder deleted or hidden from non-admin

            seenInSections.add(item.name);

            // Collect all tag badges for this subject
            const allTagsForSub = (subjectTagsMap.get(item.name) || []).map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              slug: t.slug,
            }));

            sectionSubjects.push({
              name: catInfo.name,
              description: catInfo.description,
              lectureCount: catInfo.lectureCount,
              additionalCount: catInfo.additionalCount,
              order: item.displayOrder ?? catInfo.order,
              isHidden: hiddenSubjectNames.has(catInfo.name),
              tags: allTagsForSub,
            });
          }

          if (sectionSubjects.length > 0) {
            sections.push({
              id: tag.slug,
              tagId: tag.id,
              title: tag.name,
              slug: tag.slug,
              description: tag.description,
              color: tag.color,
              displayOrder: tag.displayOrder,
              subjects: sectionSubjects,
            });
          }
        }

        // Check if there are any orphaned/untagged subjects in the catalog
        const untaggedSubjects = [];
        for (const [name, catInfo] of catalogMap.entries()) {
          if (!seenInSections.has(name)) {
            untaggedSubjects.push({
              name: catInfo.name,
              description: catInfo.description,
              lectureCount: catInfo.lectureCount,
              additionalCount: catInfo.additionalCount,
              order: catInfo.order,
              isHidden: hiddenSubjectNames.has(catInfo.name),
              tags: [],
            });
          }
        }

        if (untaggedSubjects.length > 0) {
          untaggedSubjects.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
          sections.push({
            id: 'other-subjects',
            tagId: 'other-subjects',
            title: 'Other Subjects',
            slug: 'other-subjects',
            description: 'Additional notes and reference subjects.',
            color: 'purple',
            displayOrder: 9999,
            subjects: untaggedSubjects,
          });
        }

        if (sections.length > 0) {
          return { sections, usingTags: true };
        }
      }
    } catch (err) {
      console.warn('[tags] Falling back to file-based semester grouping:', err);
    }
  }

  // ─── Fallback: File-based semester grouping (pre-migration / D1 offline) ─────
  const fallbackSubjectsVM = [...catalogMap.values()];
  const semesterNumbers = Array.from(
    new Set(
      fallbackSubjectsVM
        .map((s) => s.semester)
        .filter((sem): sem is number => typeof sem === 'number')
    )
  ).sort((a, b) => b - a);

  const fallbackSections: TagSectionViewModel[] = [];

  for (const sem of semesterNumbers) {
    const semSubjects = fallbackSubjectsVM
      .filter((s) => s.semester === sem)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((s) => ({
        name: s.name,
        description: s.description,
        lectureCount: s.lectureCount,
        additionalCount: s.additionalCount,
        order: s.order,
        isHidden: hiddenSubjectNames.has(s.name),
        tags: [
          {
            id: `sem-${sem}`,
            name: `Semester ${sem}`,
            color: (sem === 2 ? 'emerald' : sem === 1 ? 'blue' : 'accent') as TagColor,
            slug: `semester-${sem}`,
          },
        ],
      }));

    if (semSubjects.length > 0) {
      fallbackSections.push({
        id: `semester-${sem}`,
        tagId: `semester-${sem}`,
        title: `Semester ${sem}`,
        slug: `semester-${sem}`,
        color: sem === 2 ? 'emerald' : 'blue',
        displayOrder: sem === 2 ? 1 : 2,
        subjects: semSubjects,
      });
    }
  }

  const basics = fallbackSubjectsVM
    .filter((s) => typeof s.semester !== 'number')
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      lectureCount: s.lectureCount,
      additionalCount: s.additionalCount,
      order: s.order,
      isHidden: hiddenSubjectNames.has(s.name),
      tags: [{ id: 'basics', name: 'Basics', color: 'purple' as TagColor, slug: 'basics' }],
    }));

  if (basics.length > 0) {
    fallbackSections.push({
      id: 'basics',
      tagId: 'basics',
      title: 'Basics',
      slug: 'basics',
      color: 'purple',
      displayOrder: 999,
      subjects: basics,
    });
  }

  return { sections: fallbackSections, usingTags: false };
}
