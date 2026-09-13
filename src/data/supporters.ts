/**
 * Community supporters who have contributed to keeping BitsNotes free and open.
 * New supporters can be appended here.
 */

export type SupporterTier = 'chai' | 'fuel' | 'meal' | 'sponsor' | 'supporter';

export interface Supporter {
  name: string;
  tier?: SupporterTier;
  tierLabel?: string;
  message?: string;
  date?: string; // e.g. '2026-03' or 'March 2026'
  avatarUrl?: string;
}

export const supporters: Supporter[] = [
  {
    name: 'Tanu Tapli',
    tier: 'supporter',
    tierLabel: 'Supporter',
  },
  {
    name: 'Rajat Singh',
    tier: 'supporter',
    tierLabel: 'Supporter',
  },
];

export default supporters;

