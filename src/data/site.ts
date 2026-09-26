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
  /**
   * Name the donor's UPI app will show after resolving `upiId`.
   * MUST exactly match the bank-verified account holder name,
   * otherwise donors cannot verify the payee and tampering is invisible.
   */
  payeeName: string;
  /** Receiver VPA. Changing this redirects all donations — see tamper checks. */
  upiId: string;
  note?: string;
  /** Preset amounts shown as selectable chips (chai-tier style). */
  presets?: UpiPreset[];
  /** Max characters allowed in the optional personal message (UPI `tn`). */
  maxMessageLength?: number;
}

/**
 * Tamper-evident source of truth for donations.
 *
 * These MUST match `site.support.upi` below. They are imported by
 * `scripts/verify-donation-config.mjs`, `test/donation-integrity.test.ts`,
 * and the e2e suite, so any silent change to the receiver fails CI.
 * A daily workflow also asserts the live `/support` HTML contains this VPA.
 */
export const EXPECTED_UPI_ID = 'tanmaynemade-3@okicici';
export const EXPECTED_PAYEE_NAME = 'Tanmay Nemade';

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
    // The live QR is generated in the browser from this config.
    // The UPI ID IS rendered visibly on the page (and in data attributes)
    // on purpose: transparency lets donors + monitors spot a swapped VPA.
    // payeeName must stay equal to EXPECTED_PAYEE_NAME (bank-verified name).
    upi: {
      enabled: true,
      payeeName: EXPECTED_PAYEE_NAME,
      upiId: EXPECTED_UPI_ID,
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
