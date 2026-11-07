import { describe, expect, it } from 'vitest';
import { summarizePromoDuration } from './promo-duration';

describe('summarizePromoDuration', () => {
  it('does not present a known time as uniform when available codes also have unknown times', () => {
    const summary = summarizePromoDuration({
      fulfillmentType: 'voucher',
      voucherDurationLabels: ['1 Hour'],
      voucherHasUndeclaredDuration: true,
    });
    expect(summary.durationLabel).not.toBe('1 Hour');
    expect(summary.durationNote).toContain('1 Hour');
    expect(summary.dataUnavailable).toBe(false);
  });

  it('lists distinct declared times when available codes have mixed durations', () => {
    const summary = summarizePromoDuration({
      fulfillmentType: 'voucher',
      voucherDurationLabels: ['1 Hour', '5 Hours'],
      voucherHasUndeclaredDuration: false,
    });
    expect(summary.durationLabel).not.toBe('1 Hour');
    expect(summary.durationLabel).not.toBe('5 Hours');
    expect(summary.durationNote).toContain('1 Hour');
    expect(summary.durationNote).toContain('5 Hours');
  });

  it('marks older API responses without duration summary fields as unavailable', () => {
    expect(summarizePromoDuration({ fulfillmentType: 'voucher' }).dataUnavailable).toBe(true);
  });

  it('prefers the saved promotion time over mixed or undeclared voucher inventory', () => {
    const summary = summarizePromoDuration({
      declaredDuration: ' 45 Minutes ',
      fulfillmentType: 'voucher',
      voucherDurationLabels: ['1 Hour', '5 Hours'],
      voucherHasUndeclaredDuration: true,
    });
    expect(summary.durationLabel).toBe('45 Minutes');
    expect(summary.durationNote).toBe('');
    expect(summary.dataUnavailable).toBe(false);
  });

  it('falls back to inventory-derived duration when the saved time is cleared', () => {
    const summary = summarizePromoDuration({
      declaredDuration: null,
      fulfillmentType: 'voucher',
      voucherDurationLabels: ['1 Hour'],
      voucherHasUndeclaredDuration: true,
    });
    expect(summary.durationLabel).not.toBe('1 Hour');
    expect(summary.durationNote).toContain('1 Hour');
    expect(summary.dataUnavailable).toBe(false);
  });

  it('uses a saved promotion time for manual top-up promotions', () => {
    const summary = summarizePromoDuration({
      declaredDuration: '2 Hours',
      fulfillmentType: 'manual_topup',
    });
    expect(summary.durationLabel).toBe('2 Hours');
    expect(summary.durationNote).toBe('');
    expect(summary.dataUnavailable).toBe(false);
  });
});
