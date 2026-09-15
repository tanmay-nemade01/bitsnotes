/**
 * Community supporters who have contributed to keeping BitsNotes free and open.
 *
 * ⚠️ This file is now only the **static fallback**. The live roster lives in the
 * D1 `supporters` table and is managed from /admin (Wall of Gratitude tab), so
 * new supporters appear instantly without a rebuild or deploy.
 *
 * This list is used when:
 *   - the page is rendered at build time (initial paint + SEO), and
 *   - the D1 table is missing or unreachable (e.g. local dev before migrations).
 *
 * Keep it in sync with the seed in `src/db/migrations/007_supporters.sql`.
 */

export type SupporterTier = 'chai' | 'fuel' | 'meal' | 'sponsor' | 'supporter';

export interface Supporter {
  id?: string;
  name: string;
  tier?: SupporterTier;
  tierLabel?: string;
  message?: string;
  date?: string; // e.g. '2026-03' or 'March 2026'
  avatarUrl?: string;
}

export const supporters: Supporter[] = [
  {
    id: '0199a000-0000-7000-8000-000000000001',
    name: 'Tanu Tapli',
    tier: 'supporter',
    tierLabel: 'Supporter',
  },
  {
    id: '0199a000-0000-7000-8000-000000000002',
    name: 'Rajat Singh',
    tier: 'supporter',
    tierLabel: 'Supporter',
  },
  {
    id: '0199a000-0000-7000-8000-000000000003',
    name: 'Chinmay Das',
    tier: 'supporter',
    tierLabel: 'Supporter',
  },
];

export default supporters;

