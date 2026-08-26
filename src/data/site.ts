/**
 * Site-wide configuration — centralized so values are never hard-coded in
 * markup. Currently holds the Support (Phase 6) payment channels.
 *
 * Each support channel is rendered only when its config is present/enabled:
 *   - `buymeacoffee` renders whenever `url` is set.
 *   - `upi` renders only when `enabled === true`.
 */

export interface BuyMeACoffeeConfig {
  url: string;
}

export interface UpiPreset {
  /** Short label shown on the preset chip, e.g. "Chai". */
  label: string;
  /** Amount in INR. */
  amount: number;
}

export interface UpiConfig {
  enabled: boolean;
  payeeName: string;
  upiId: string;
  note?: string;
  /** Preset amounts shown as selectable chips (chai-tier style). */
  presets?: UpiPreset[];
  /** Max characters allowed in the optional personal message (UPI `tn`). */
  maxMessageLength?: number;
}

export interface SiteConfig {
  support: {
    buymeacoffee: BuyMeACoffeeConfig | null;
    upi: UpiConfig;
  };
}

export const site: SiteConfig = {
  support: {
    buymeacoffee: {
      url: 'https://buymeacoffee.com/bitsnotes',
    },
    // Demo UPI ID for now — replace `upiId` with your real VPA before
    // linking this page publicly. The live QR is generated in the browser
    // from this config, so it updates automatically once changed.
    upi: {
      enabled: true,
      payeeName: 'BitsNotes',
      upiId: 'support@bitsnotes',
      note: 'Supporting BitsNotes',
      presets: [
        { label: 'A chai', amount: 20 },
        { label: 'Study fuel', amount: 50 },
        { label: 'Full meal', amount: 100 },
        { label: 'Sponsor a subject', amount: 250 },
      ],
      maxMessageLength: 50,
    },
  },
};

export default site;
