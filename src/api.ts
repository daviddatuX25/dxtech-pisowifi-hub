import { appConfig, getProfileToken, hasBackendConfig } from './config';
import type { AdminData, ApiErrorPayload, Branch, Profile, PublicData, VoucherInventoryItem } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface CallOptions {
  profileToken?: string | null;
  adminToken?: string | null;
  body?: BodyInit;
  isMultipart?: boolean;
}

async function call<T>(payload: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
  if (!hasBackendConfig) {
    throw new ApiError(
      'Connect Supabase before using the live room. Add the public environment values and reload.',
      0,
      'CONFIGURATION',
    );
  }

  const headers = new Headers({
    Accept: 'application/json',
  });
  if (!options.isMultipart) headers.set('Content-Type', 'application/json');
  const profileToken = options.profileToken !== undefined ? options.profileToken : getProfileToken();
  if (profileToken) {
    headers.set('x-profile-token', profileToken);
  }
  if (options.adminToken) headers.set('Authorization', `Bearer ${options.adminToken}`);

  const response = await fetch(appConfig.functionsUrl, {
    method: 'POST',
    headers,
    body: options.body ?? JSON.stringify(payload),
  });

  const raw = await response.text();
  let result: T | ApiErrorPayload = {};
  try {
    result = raw ? (JSON.parse(raw) as T | ApiErrorPayload) : {};
  } catch {
    result = {};
  }

  if (!response.ok) {
    const errorPayload = result as ApiErrorPayload;
    throw new ApiError(
      errorPayload.error || 'The request could not be completed.',
      response.status,
      errorPayload.code || 'REQUEST_FAILED',
    );
  }

  return result as T;
}

export function createProfile(input: {
  deviceId: string;
  name: string;
  branchId: string;
  privacyConsent: boolean;
}): Promise<{ profile: Profile; profileToken: string }> {
  return call({ action: 'create_profile', ...input }, { profileToken: null });
}

export function updateProfile(input: {
  deviceId: string;
  name: string;
}, profileToken: string): Promise<{ profile: Profile }> {
  return call({ action: 'update_profile', ...input }, { profileToken });
}

export function loadPublicBranches(): Promise<{ branches: Branch[] }> {
  return call<{ branches: Branch[] }>({ action: 'load_public_branches' }, { profileToken: null });
}

export function loadPublicData(profileToken: string): Promise<PublicData> {
  return call<PublicData>({ action: 'load_public_data' }, { profileToken });
}

export function uploadStudentDocument(file: File, profileToken: string): Promise<{
  hasStudentDocument: boolean;
}> {
  const body = new FormData();
  body.set('action', 'upload_document');
  body.set('file', file, file.name);
  return call({ action: 'upload_document' }, { profileToken, body, isMultipart: true });
}

export function submitPromoRequest(promotionId: string, profileToken: string): Promise<{
  requestId: string;
  status: 'pending' | 'approved';
  voucherCode?: string | null;
}> {
  return call({ action: 'submit_promo_request', promotionId }, { profileToken });
}

export function submitIssue(input: {
  issueType: 'ghost_credit' | 'lost_points';
  unit?: 'money' | 'time' | 'coins';
  amountInserted?: number;
  amountCredited?: number;
  pointsLost?: number;
  description?: string;
}, profileToken: string): Promise<{ issueId: string; status: 'pending' }> {
  return call({ action: 'submit_issue', ...input }, { profileToken });
}

export function savePushSubscription(subscription: PushSubscriptionJSON, profileToken: string): Promise<{
  enabled: boolean;
}> {
  return call({ action: 'save_push_subscription', subscription }, { profileToken });
}

export function loadAdminData(adminToken: string): Promise<AdminData> {
  return call<AdminData>({ action: 'admin_load_data' }, { adminToken, profileToken: null });
}

export function saveBranch(adminToken: string, input: { id?: string; name: string; active: boolean }): Promise<{ branch: Branch }> {
  return call({ action: 'admin_save_branch', ...input }, { adminToken, profileToken: null });
}

export function savePromotion(adminToken: string, input: Record<string, unknown>): Promise<{ promotionId: string }> {
  return call({ action: 'admin_save_promotion', ...input }, { adminToken, profileToken: null });
}

export function importVouchers(
  adminToken: string,
  promotionId: string,
  vouchers: Array<{ code: string; durationLabel?: string; branchId?: string }>
): Promise<{ importedCount: number; totalBatch: number }> {
  return call({ action: 'admin_import_vouchers', promotionId, vouchers }, { adminToken, profileToken: null });
}

export function getPromotionVouchers(
  adminToken: string,
  promotionId: string
): Promise<{ vouchers: VoucherInventoryItem[] }> {
  return call<{ vouchers: VoucherInventoryItem[] }>({ action: 'admin_get_promotion_vouchers', promotionId }, { adminToken, profileToken: null });
}

export function reviewPromoRequests(adminToken: string, requestIds: string[], status: 'approved' | 'rejected'): Promise<{
  approved: string[];
  rejected: string[];
  skipped: Array<{ id: string; reason: string }>;
}> {
  return call({ action: 'admin_review_promos', requestIds, status }, { adminToken, profileToken: null });
}

export function reviewIssue(adminToken: string, issueId: string, status: 'approved' | 'rejected'): Promise<{ issueId: string; status: string }> {
  return call({ action: 'admin_review_issue', issueId, status }, { adminToken, profileToken: null });
}

export function getStudentDocumentUrl(adminToken: string, documentId: string): Promise<{ url: string }> {
  return call({ action: 'admin_document_url', documentId }, { adminToken, profileToken: null });
}
