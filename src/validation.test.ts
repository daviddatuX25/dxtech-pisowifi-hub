import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  normalizeDeviceId,
  validateDocument,
  validateGhostCredit,
  validateLostPoints,
  validateProfile,
  validateProfileEdit,
} from './validation';

describe('profile validation', () => {
  it('normalizes UI device IDs without hiding invalid characters', () => {
    expect(normalizeDeviceId('ab-12 c')).toBe('AB-12 C');
    expect(validateProfile({ deviceId: 'AB-12 C', name: 'Mina', branchId: 'lane', privacyConsent: true }).deviceId).toContain('Letters at numbers');
  });

  it('requires all onboarding identity and consent fields', () => {
    const errors = validateProfile({ deviceId: '', name: '', branchId: '', privacyConsent: false });
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['deviceId', 'name', 'branchId', 'privacyConsent']));
  });

  it('validates editable profile details without onboarding-only fields', () => {
    expect(validateProfileEdit({ deviceId: 'AB123', name: 'Mina' })).toEqual({});
    expect(validateProfileEdit({ deviceId: '', name: '' })).toEqual(expect.objectContaining({ deviceId: expect.any(String), name: expect.any(String) }));
  });
});

describe('issue validation', () => {
  it('rejects ghost credit amounts where credited exceeds inserted', () => {
    const errors = validateGhostCredit({ unit: 'money', amountInserted: '10', amountCredited: '11' });
    expect(errors.amountCredited).toMatch(/Hindi puwedeng mas mataas/);
  });

  it('requires a positive lost-points amount', () => {
    expect(validateLostPoints('0').pointsLost).toMatch(/points ang nawala/);
    expect(validateLostPoints('5')).toEqual({});
  });
});

describe('student document validation', () => {
  it('accepts supported image types within the five megabyte limit', () => {
    expect(validateDocument(new File(['id'], 'id.webp', { type: 'image/webp' }))).toBeNull();
    expect(validateDocument(new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'id.png', { type: 'image/png' }))).toMatch(/Max 5 MB/);
  });

  it('rejects unsupported document types', () => {
    expect(validateDocument(new File(['id'], 'id.pdf', { type: 'application/pdf' }))).toMatch(/JPG, PNG, o WebP/);
  });
});
