import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { site, EXPECTED_UPI_ID, EXPECTED_PAYEE_NAME } from '../src/data/site';

/**
 * Tamper-evident tests for the donation receiver.
 * Any silent swap of the UPA/VPA to an attacker's account fails the suite.
 */
describe('donation receiver integrity', () => {
  it('upi config matches the declared source of truth', () => {
    expect(site.support.upi.upiId).toBe(EXPECTED_UPI_ID);
    expect(site.support.upi.payeeName).toBe(EXPECTED_PAYEE_NAME);
  });

  it('uses the bank-verified personal account name', () => {
    expect(EXPECTED_PAYEE_NAME).toBe('Tanmay Nemade');
    expect(site.support.upi.payeeName).toBe('Tanmay Nemade');
  });

  it('VPA has valid format', () => {
    expect(EXPECTED_UPI_ID).toMatch(/^[\w.\-]{2,256}@[a-zA-Z0-9.\-]{2,64}$/);
  });

  it('support page keeps verification UI + machine-readable hooks', () => {
    const src = readFileSync(path.resolve('src/pages/support.astro'), 'utf8');
    for (const needle of [
      'data-upi-id=',
      'data-payee-name=',
      'data-upi-id-text',
      'data-payee-name-text',
      'data-verify-payee-notice',
      'donate-tamper-warning',
      'checkIntegrity',
    ]) {
      expect(src, `missing ${needle}`).toContain(needle);
    }
  });

  it('orphan static QR stays deleted (single live-generated source)', () => {
    expect(existsSync(path.resolve('public/support-upi-qr.png'))).toBe(false);
  });
});
