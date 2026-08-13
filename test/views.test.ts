import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/blogLoader', () => ({
  getPostBySlug: async (slug: string) => {
    if (slug === 'kimi-k3-a-justified-price-jump') {
      return {
        slug,
        frontmatter: {
          title: 'Kimi K3',
          publishedAt: '2026-07-17',
        },
      };
    }
    if (slug === 'deepseek-v4-pro-2-month-review') {
      return {
        slug,
        frontmatter: {
          title: 'DeepSeek',
          publishedAt: '2026-07-16',
        },
      };
    }
    return undefined;
  },
}));

vi.mock('../src/utils/notesLoader', () => ({
  getManifest: async () => ({
    version: 'dev-manifest',
    subjects_count: 1,
    total_lectures: 2,
    updatedAt: '2026-07-17T12:00:00Z',
    subjects: [
      {
        name: 'NLP',
        lectureCount: 2,
        lectures: [
          {
            name: 'Lecture 1',
            folderName: 'Lecture_01',
            fileName: 'Lecture_01',
            metadata: {
              datePublished: '2026-07-16',
            },
          },
          {
            name: 'Lecture 2',
            folderName: 'Lecture_02',
            fileName: 'Lecture_02',
            metadata: {
              datePublished: '2026-07-17',
            },
          },
        ],
      },
    ],
  }),
}));

import { seedOffsetForKey, incrementViews, getViews } from '../src/lib/views';
import { makeDb } from './setup';

describe('Views Seeding & Tracking', () => {
  describe('seedOffsetForKey', () => {
    it('returns a high offset for home page', async () => {
      const offset = await seedOffsetForKey('home');
      expect(offset).toBeGreaterThanOrEqual(10000);
      expect(offset).toBeLessThanOrEqual(11000);
    });

    it('returns 0 for a new blog post (published >= 2026-07-17)', async () => {
      const offset = await seedOffsetForKey('blog:kimi-k3-a-justified-price-jump');
      expect(offset).toBe(0);
    });

    it('returns standard seed offset (50-60) for older blog posts', async () => {
      const offset = await seedOffsetForKey('blog:deepseek-v4-pro-2-month-review');
      expect(offset).toBeGreaterThanOrEqual(50);
      expect(offset).toBeLessThanOrEqual(60);
    });

    it('returns standard seed offset for non-existent blog posts', async () => {
      const offset = await seedOffsetForKey('blog:non-existent');
      expect(offset).toBeGreaterThanOrEqual(50);
      expect(offset).toBeLessThanOrEqual(60);
    });

    it('returns 0 for new lecture notes (datePublished >= 2026-07-17)', async () => {
      const offset = await seedOffsetForKey('lecture:NLP:Lecture_02');
      expect(offset).toBe(0);
    });

    it('returns standard seed offset (400-500) for older lecture notes', async () => {
      const offset = await seedOffsetForKey('lecture:NLP:Lecture_01');
      expect(offset).toBeGreaterThanOrEqual(400);
      expect(offset).toBeLessThanOrEqual(500);
    });

    it('returns standard seed offset for non-existent lectures', async () => {
      const offset = await seedOffsetForKey('lecture:NLP:non-existent');
      expect(offset).toBeGreaterThanOrEqual(400);
      expect(offset).toBeLessThanOrEqual(500);
    });
  });

  describe('DB Operations', () => {
    it('initializes a new blog post views count at 1 upon first view increment', async () => {
      const db = makeDb();
      const views = await incrementViews(db, 'blog:kimi-k3-a-justified-price-jump');
      expect(views).toBe(1);

      const check = await getViews(db, 'blog:kimi-k3-a-justified-price-jump');
      expect(check).toBe(1);
    });

    it('initializes an old blog post views count at offset + 1 upon first view increment', async () => {
      const db = makeDb();
      const views = await incrementViews(db, 'blog:deepseek-v4-pro-2-month-review');
      expect(views).toBeGreaterThanOrEqual(51);
      expect(views).toBeLessThanOrEqual(61);
    });
  });
});
