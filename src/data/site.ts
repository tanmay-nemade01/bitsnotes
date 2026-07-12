/**
 * Site-wide configuration — centralized so values are never hard-coded in
 * markup. Currently holds the Support (Phase 6) payment channels.
 *
 * Each support channel is rendered only when its config is present/enabled:
 *   - `buymeacoffee` renders whenever `url` is set.
 *   - `upi` renders only when `enabled === true` (kept false for now; the
 *     static QR asset and config remain in place, ready to flip on later).
 */

export interface BuyMeACoffeeConfig {
  url: string;
}

export interface UpiConfig {
  enabled: boolean;
  payeeName: string;
  upiId: string;
  note?: string;
}

export interface SiteConfig {
  support: {
    buymeacoffee: BuyMeACoffeeConfig | null;
    upi: UpiConfig;
  };
}

export const site: SiteConfig = {
  support: {
    // Active support channel for now.
    buymeacoffee: {
      url: 'https://buymeacoffee.com/bitsnotes',
    },
    // Ready but disabled. Flip `enabled` to true to reveal the UPI block
    // (static QR at /support-upi-qr.png must exist).
    upi: {
      enabled: false,
      payeeName: 'BitsNotes',
      upiId: 'support@bitsnotes',
      note: 'Supporting BitsNotes',
    },
  },
};

export default site;
