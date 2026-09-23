import type { CreditUnit } from './types';

export type ValidationErrors = Record<string, string>;

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function normalizeDeviceId(value: string): string {
  return value.toUpperCase();
}

export function validateDeviceId(value: string): string | null {
  const normalized = normalizeDeviceId(value.trim());
  if (!normalized) return 'Ilagay ang Device ID.';
  if (!/^[A-Z0-9]{1,64}$/.test(normalized)) {
    return 'Letters at numbers lang ang Device ID.';
  }
  return null;
}
export function validateEmail(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 255) return 'Max 255 characters ang email.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'Maglagay ng tamang email format (hal. juan@gmail.com).';
  }
  return null;
}

function validateProfileDetails(input: {
  deviceId: string;
  name: string;
  email?: string | null;
}): ValidationErrors {
  const errors: ValidationErrors = {};
  const deviceError = validateDeviceId(input.deviceId);
  if (deviceError) errors.deviceId = deviceError;
  if (!input.name.trim()) errors.name = 'Ilagay ang pangalan.';
  else if (input.name.trim().length > 120) errors.name = 'Max 120 characters ang pangalan.';
  const emailError = validateEmail(input.email);
  if (emailError) errors.email = emailError;
  return errors;
}

export function validateProfile(input: {
  deviceId: string;
  name: string;
  email?: string | null;
  branchId: string;
  privacyConsent: boolean;
}): ValidationErrors {
  const errors = validateProfileDetails(input);
  if (!input.branchId) errors.branchId = 'Pumili ng branch.';
  if (!input.privacyConsent) errors.privacyConsent = 'Kailangan ang consent para ma-save ang details.';
  return errors;
}

export function validateProfileEdit(input: {
  deviceId: string;
  name: string;
  email?: string | null;
}): ValidationErrors {
  return validateProfileDetails(input);
}

export function parsePositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function validateGhostCredit(input: {
  unit: CreditUnit;
  amountInserted: string;
  amountCredited: string;
}): ValidationErrors {
  const errors: ValidationErrors = {};
  const inserted = parsePositiveNumber(input.amountInserted);
  const credited = parseNonNegativeNumber(input.amountCredited);
  if (!inserted) errors.amountInserted = 'Ilagay ang amount na higit sa zero.';
  if (credited === null) errors.amountCredited = 'Ilagay ang na-credit na amount.';
  if (inserted !== null && credited !== null && credited > inserted) {
    errors.amountCredited = 'Hindi puwedeng mas mataas ang na-credit kaysa sa nailagay.';
  }
  return errors;
}

export function validateLostPoints(value: string): ValidationErrors {
  return parsePositiveNumber(value) === null
    ? { pointsLost: 'Ilagay kung ilang points ang nawala.' }
    : {};
}

export function validateDocument(file: File | null): string | null {
  if (!file) return 'Pumili ng School ID image.';
  if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type as (typeof ACCEPTED_DOCUMENT_TYPES)[number])) {
    return 'JPG, PNG, o WebP image lang.';
  }
  if (file.size > MAX_DOCUMENT_BYTES) return 'Max 5 MB ang image.';
  return null;
}

export function firstError(errors: ValidationErrors): string | null {
  return Object.values(errors)[0] ?? null;
}
