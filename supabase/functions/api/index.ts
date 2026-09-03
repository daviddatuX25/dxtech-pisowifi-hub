import { corsHeaders, errorResponse, HttpError, jsonResponse } from '../_shared/cors.ts';
import {
  enforceRateLimit,
  getServiceClient,
  hashText,
  isUuid,
  requireAdmin,
  requireProfile,
} from '../_shared/auth.ts';
import type { ProfileContext } from '../_shared/auth.ts';

const client = getServiceClient();
const MAX_JSON_BYTES = 100_000;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES: Record<string, true> = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
const ISSUE_TYPES: Record<string, true> = { ghost_credit: true, lost_points: true };
const CREDIT_UNITS: Record<string, true> = { money: true, time: true, coins: true };
const MAX_VOUCHER_BATCH = 5_000;
const VOUCHER_CODE_PATTERN = /^[A-Z0-9_-]{1,120}$/;

type JsonBody = Record<string, unknown>;

type Relation = Record<string, unknown> | null;

function relation(value: unknown): Relation {
  if (Array.isArray(value)) return (value[0] as Relation) || null;
  return value && typeof value === 'object' ? value as Relation : null;
}

function requiredString(body: JsonBody, key: string, label: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${label} is invalid.`, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function optionalString(body: JsonBody, key: string, maxLength: number): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new HttpError(400, 'One of the text fields is invalid.', 'VALIDATION_ERROR');
  }
  return value.trim();
}

function requiredUuid(body: JsonBody, key: string, label: string): string {
  const value = body[key];
  if (!isUuid(value)) throw new HttpError(400, `${label} is invalid.`, 'VALIDATION_ERROR');
  return value;
}

type VoucherRow = { code: string; duration_label: string | null; branch_id: string | null };

function parseVoucherRows(value: unknown): VoucherRow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'No voucher codes provided.', 'VALIDATION_ERROR');
  }
  if (value.length > MAX_VOUCHER_BATCH) {
    throw new HttpError(413, `Import at most ${MAX_VOUCHER_BATCH} voucher codes at a time.`, 'PAYLOAD_TOO_LARGE');
  }

  const rows: VoucherRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!item || typeof item !== 'object') throw new HttpError(400, `Voucher row ${index + 1} is invalid.`, 'VALIDATION_ERROR');
    const input = item as Record<string, unknown>;
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    if (!VOUCHER_CODE_PATTERN.test(code)) throw new HttpError(400, `Voucher row ${index + 1} has an invalid code.`, 'VALIDATION_ERROR');

    const durationValue = input.durationLabel;
    const durationLabel = durationValue === undefined || durationValue === null || durationValue === ''
      ? null
      : typeof durationValue === 'string' ? durationValue.trim() : '';
    if (durationValue !== undefined && durationValue !== null && durationValue !== '' && (!durationLabel || durationLabel.length > 80)) {
      throw new HttpError(400, `Voucher row ${index + 1} has an invalid duration label.`, 'VALIDATION_ERROR');
    }

    const branchValue = input.branchId;
    const branchId = branchValue === undefined || branchValue === null || branchValue === ''
      ? null
      : typeof branchValue === 'string' && isUuid(branchValue) ? branchValue : null;
    if (branchValue !== undefined && branchValue !== null && branchValue !== '' && !branchId) {
      throw new HttpError(400, `Voucher row ${index + 1} has an invalid branch.`, 'VALIDATION_ERROR');
    }

    const key = code;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code, duration_label: durationLabel, branch_id: branchId });
  }
  if (!rows.length) throw new HttpError(400, 'No valid voucher codes found.', 'VALIDATION_ERROR');
  return rows;
}

async function validateVoucherBranches(rows: VoucherRow[]): Promise<void> {
  const branchIds = [...new Set(rows.map((row) => row.branch_id).filter((id): id is string => Boolean(id)))];
  if (!branchIds.length) return;
  const { data, error } = await client.from('branches').select('id').in('id', branchIds);
  if (error || (data || []).length !== branchIds.length) throw new HttpError(400, 'Every voucher branch must be configured.', 'BRANCH_INVALID');
}

function numericValue(value: unknown, label: string, positive: boolean): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const valid = Number.isFinite(parsed) && (positive ? parsed > 0 : parsed >= 0);
  if (!valid || parsed > 9_999_999_999) throw new HttpError(400, `${label} is invalid.`, 'VALIDATION_ERROR');
  return parsed;
}

function stringFromForm(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function isDeviceIdConflict(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' && /device_id/i.test(error.message || '');
}

function deviceIdTakenError(): HttpError {
  return new HttpError(409, 'May naka-link nang profile sa Device ID na ito. Gamitin ang saved profile sa device na iyon o humingi ng tulong sa admin.', 'DEVICE_ID_TAKEN');
}

async function parseJson(request: Request): Promise<JsonBody> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_JSON_BYTES) throw new HttpError(413, 'Request is too large.', 'PAYLOAD_TOO_LARGE');
  try {
    const body = JSON.parse(new TextDecoder().decode(raw));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    return body as JsonBody;
  } catch {
    throw new HttpError(400, 'Send a valid JSON request.', 'INVALID_JSON');
  }
}

function profileView(context: ProfileContext, hasStudentDocument: boolean, notificationsEnabled: boolean) {
  return {
    id: context.id,
    deviceId: context.deviceId,
    name: context.name,
    branchId: context.branchId,
    branchName: context.branchName,
    hasStudentDocument,
    notificationsEnabled,
  };
}

async function getProfileState(context: ProfileContext) {
  const [{ data: document }, { data: subscription }] = await Promise.all([
    client.from('student_documents').select('id').eq('profile_id', context.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('push_subscriptions').select('id').eq('profile_id', context.id).eq('active', true).limit(1).maybeSingle(),
  ]);
  return profileView(context, Boolean(document), Boolean(subscription));
}

async function loadPublicBranches(request: Request) {
  await enforceRateLimit(request, client, 'public-branches', 30);
  const { data, error } = await client.from('branches').select('id,name,active').eq('active', true).order('name');
  if (error) throw new Error(error.message);
  return { branches: data || [] };
}

async function createProfile(request: Request, body: JsonBody) {
  await enforceRateLimit(request, client, 'create-profile', 8, 60);
  const deviceId = requiredString(body, 'deviceId', 'Device ID', 64).toUpperCase();
  if (!/^[A-Z0-9]{1,64}$/.test(deviceId)) throw new HttpError(400, 'Device ID must use letters and numbers only.', 'VALIDATION_ERROR');
  const name = requiredString(body, 'name', 'Name', 120);
  const branchId = requiredUuid(body, 'branchId', 'Branch');
  if (body.privacyConsent !== true) throw new HttpError(400, 'Privacy consent is required.', 'CONSENT_REQUIRED');

  const { data: branch, error: branchError } = await client.from('branches').select('id,name').eq('id', branchId).eq('active', true).maybeSingle();
  if (branchError || !branch) throw new HttpError(400, 'Choose an active branch.', 'BRANCH_INVALID');

  const { data: existingProfile, error: existingProfileError } = await client.from('profiles').select('id').eq('device_id', deviceId).maybeSingle();
  if (existingProfileError) throw new Error(existingProfileError.message);
  if (existingProfile) throw deviceIdTakenError();

  const { data: profile, error: profileError } = await client.from('profiles').insert({
    device_id: deviceId,
    id_value: deviceId,
    name,
    branch_id: branchId,
    privacy_consent_at: new Date().toISOString(),
  }).select('id').single();
  if (profileError) {
    if (isDeviceIdConflict(profileError)) throw deviceIdTakenError();
    throw new Error(profileError.message || 'Profile insert failed.');
  }
  if (!profile) throw new Error('Profile insert failed.');

  const profileToken = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`;
  const tokenHash = await hashText(profileToken);
  const { error: sessionError } = await client.from('profile_sessions').insert({ profile_id: profile.id, token_hash: tokenHash });
  if (sessionError) {
    await client.from('profiles').delete().eq('id', profile.id);
    throw new Error(sessionError.message);
  }

  return {
    profile: profileView({ id: profile.id, deviceId, name, branchId, branchName: branch.name }, false, false),
    profileToken,
  };
}

async function updateProfile(request: Request, body: JsonBody) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'update-profile', 10, 300, context.id);
  const deviceId = requiredString(body, 'deviceId', 'Device ID', 64).toUpperCase();
  if (!/^[A-Z0-9]{1,64}$/.test(deviceId)) throw new HttpError(400, 'Device ID must use letters and numbers only.', 'VALIDATION_ERROR');
  const name = requiredString(body, 'name', 'Name', 120);

  const { data: profile, error: profileError } = await client.from('profiles').update({
    device_id: deviceId,
    id_value: deviceId,
    name,
    updated_at: new Date().toISOString(),
  }).eq('id', context.id).select('id').maybeSingle();
  if (profileError) {
    if (isDeviceIdConflict(profileError)) throw deviceIdTakenError();
    throw new Error(profileError.message || 'Profile update failed.');
  }
  if (!profile) throw new HttpError(404, 'Your profile could not be found.', 'PROFILE_NOT_FOUND');

  return { profile: await getProfileState({ ...context, deviceId, name }) };
}

async function loadPublicData(request: Request) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'load-public-data', 120, 60, context.id);
  const [
    { data: promotions, error: promotionsError },
    { data: slots, error: slotsError },
    { data: requests, error: requestsError },
    { data: issues, error: issuesError },
    { data: unassignedVouchers, error: vouchersError },
    profile,
  ] = await Promise.all([
    client.from('promotions').select('id,name,description,audience,fulfillment_type,requires_student_document,published_at').eq('active', true).eq('published', true).order('published_at', { ascending: false }),
    client.from('promotion_slots').select('promotion_id,branch_id,capacity,approved_count').eq('branch_id', context.branchId),
    client.from('promo_requests').select('id,promotion_id,branch_id,status,voucher_code,created_at,reviewed_at,promotions(name),branches(name)').eq('profile_id', context.id).order('created_at', { ascending: false }),
    client.from('issues').select('id,issue_type,unit,amount_inserted,amount_credited,points_lost,description,status,created_at,reviewed_at,branches(name)').eq('profile_id', context.id).order('created_at', { ascending: false }),
    client.from('promotion_vouchers').select('promotion_id,branch_id').is('assigned_profile_id', null),
    getProfileState(context),
  ]);
  if (promotionsError || slotsError || requestsError || issuesError || vouchersError) {
    throw new Error(promotionsError?.message || slotsError?.message || requestsError?.message || issuesError?.message || vouchersError?.message || 'Public data could not be loaded.');
  }

  const slotByPromotion = new Map((slots || []).map((slot) => [slot.promotion_id, slot]));
  const requestByPromotion = new Map((requests || []).map((item) => [item.promotion_id, item.status]));
  const voucherByPromotion = new Map((requests || []).map((item) => [item.promotion_id, item.voucher_code]));

  const unassignedCounts = new Map<string, number>();
  for (const voucher of unassignedVouchers || []) {
    if (!voucher.branch_id || voucher.branch_id === context.branchId) {
      unassignedCounts.set(voucher.promotion_id, (unassignedCounts.get(voucher.promotion_id) || 0) + 1);
    }
  }

  const publicPromotions = (promotions || []).flatMap((promotion) => {
    const slot = slotByPromotion.get(promotion.id);
    const isVoucher = promotion.fulfillment_type === 'voucher';
    if (!slot && !isVoucher) return [];

    const unassignedCount = unassignedCounts.get(promotion.id) || 0;
    const myVoucherCode = voucherByPromotion.get(promotion.id) || null;
    if (isVoucher && unassignedCount === 0 && !myVoucherCode) return [];

    const capacity = isVoucher
      ? unassignedCount + (myVoucherCode ? 1 : 0)
      : Number(slot?.capacity || 0);
    const approvedCount = isVoucher
      ? (myVoucherCode ? 1 : 0)
      : Number(slot?.approved_count || 0);
    const availableSlots = isVoucher
      ? unassignedCount
      : Math.max(0, capacity - approvedCount);

    return [{
      id: promotion.id,
      name: promotion.name,
      description: promotion.description,
      audience: promotion.audience,
      fulfillmentType: promotion.fulfillment_type || 'manual_topup',
      requiresStudentDocument: promotion.requires_student_document,
      branchId: context.branchId,
      branchName: context.branchName,
      capacity,
      approvedCount,
      availableSlots,
      myRequestStatus: requestByPromotion.get(promotion.id) || null,
      myVoucherCode,
      publishedAt: promotion.published_at,
    }];
  });

  return {
    profile,
    promotions: publicPromotions,
    requests: (requests || []).map((item) => ({
      id: item.id,
      promotionId: item.promotion_id,
      promotionName: relation(item.promotions)?.name || 'Promo',
      branchName: relation(item.branches)?.name || context.branchName,
      status: item.status,
      voucherCode: item.voucher_code || null,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
    })),
    issues: (issues || []).map((item) => ({
      id: item.id,
      issueType: item.issue_type,
      issueLabel: item.issue_type === 'ghost_credit' ? 'Ghost credit' : 'Lost points',
      branchName: relation(item.branches)?.name || context.branchName,
      unit: item.unit,
      amountInserted: item.amount_inserted === null ? null : Number(item.amount_inserted),
      amountCredited: item.amount_credited === null ? null : Number(item.amount_credited),
      pointsLost: item.points_lost === null ? null : Number(item.points_lost),
      description: item.description,
      status: item.status,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
    })),
  };
}

async function uploadDocument(request: Request) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'upload-document', 5, 300, context.id);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_DOCUMENT_BYTES + 100_000) throw new HttpError(413, 'Upload is too large.', 'PAYLOAD_TOO_LARGE');
  const form = await request.formData();
  const value = form.get('file');
  if (!(value instanceof File)) throw new HttpError(400, 'Choose a school ID image.', 'DOCUMENT_REQUIRED');
  if (!Boolean(DOCUMENT_TYPES[value.type])) throw new HttpError(400, 'Use a JPG, PNG, or WebP image.', 'DOCUMENT_TYPE_INVALID');
  if (value.size < 1 || value.size > MAX_DOCUMENT_BYTES) throw new HttpError(400, 'Image must be 5 MB or smaller.', 'DOCUMENT_SIZE_INVALID');

  const extension = value.type === 'image/jpeg' ? 'jpg' : value.type === 'image/png' ? 'png' : 'webp';
  const storagePath = `${context.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage.from('student-documents').upload(storagePath, value, { contentType: value.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data: createdDocument, error: documentError } = await client.from('student_documents').insert({ profile_id: context.id, storage_path: storagePath, mime_type: value.type, byte_size: value.size }).select('id').single();
  if (documentError || !createdDocument) {
    await client.storage.from('student-documents').remove([storagePath]);
    throw new Error(documentError?.message || 'School ID image could not be saved.');
  }
  const { data: previousDocuments, error: previousDocumentsReadError } = await client.from('student_documents').select('id,storage_path').eq('profile_id', context.id).is('deleted_at', null).neq('id', createdDocument.id);
  if (previousDocumentsReadError) {
    await client.from('student_documents').delete().eq('id', createdDocument.id);
    await client.storage.from('student-documents').remove([storagePath]);
    throw new Error(previousDocumentsReadError.message);
  }
  const now = new Date().toISOString();
  const { error: previousDocumentsError } = await client.from('student_documents').update({ deleted_at: now }).eq('profile_id', context.id).is('deleted_at', null).neq('id', createdDocument.id);
  if (previousDocumentsError) {
    await client.from('student_documents').delete().eq('id', createdDocument.id);
    await client.storage.from('student-documents').remove([storagePath]);
    throw new Error(previousDocumentsError.message);
  }
  if (previousDocuments?.length) await client.storage.from('student-documents').remove(previousDocuments.map((document) => document.storage_path));
  return { hasStudentDocument: true };
}

async function submitPromoRequest(request: Request, body: JsonBody) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'submit-promo-request', 10, 300, context.id);
  const promotionId = requiredUuid(body, 'promotionId', 'Promotion');
  const [{ data: promotion, error: promotionError }, { data: slot, error: slotError }, { data: document, error: documentError }] = await Promise.all([
    client.from('promotions').select('id,name,audience,fulfillment_type,requires_student_document,active,published').eq('id', promotionId).maybeSingle(),
    client.from('promotion_slots').select('capacity,approved_count').eq('promotion_id', promotionId).eq('branch_id', context.branchId).maybeSingle(),
    client.from('student_documents').select('id').eq('profile_id', context.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (promotionError || slotError || documentError) throw new Error(promotionError?.message || slotError?.message || documentError?.message || 'Promo could not be checked.');
  const isVoucher = promotion?.fulfillment_type === 'voucher';
  if (!promotion || !promotion.active || !promotion.published || (!isVoucher && !slot)) {
    throw new HttpError(409, 'This promo is not available for your branch.', 'PROMO_UNAVAILABLE');
  }
  if ((promotion.audience === 'students' || promotion.requires_student_document) && !document) throw new HttpError(400, 'Upload a school ID image before requesting this student promo.', 'STUDENT_DOCUMENT_REQUIRED');

  if (isVoucher) {
    const { data: claimed, error: claimError } = await client.rpc('claim_voucher_promo', {
      p_promotion_id: promotionId,
      p_profile_id: context.id,
      p_branch_id: context.branchId,
      p_student_document_id: document?.id || null,
    });
    if (claimError) {
      if (claimError.code === 'P0002') throw new HttpError(409, 'No voucher code is available for this promo right now.', 'NO_AVAILABLE_SLOT');
      if (claimError.code === 'P0003' || claimError.code === '23505') throw new HttpError(409, 'You already claimed this voucher promo.', 'DUPLICATE_REQUEST');
      if (claimError.code === 'P0005') throw new HttpError(400, 'Upload a school ID image before requesting this student promo.', 'STUDENT_DOCUMENT_REQUIRED');
      if (claimError.code === 'P0001' || claimError.code === 'P0004') throw new HttpError(409, 'This promo is not available for your branch.', 'PROMO_UNAVAILABLE');
      throw new Error(claimError.message || 'Failed to claim voucher.');
    }

    const claim = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!claim?.request_id || !claim.voucher_code) throw new Error('Voucher claim returned no code.');
    return { requestId: claim.request_id, status: 'approved', voucherCode: claim.voucher_code };
  }

  // Manual Top-Up Flow
  if (Number(slot.approved_count) >= Number(slot.capacity)) throw new HttpError(409, 'No slot is available for this promo right now.', 'NO_AVAILABLE_SLOT');

  const { data: created, error } = await client.from('promo_requests').insert({
    promotion_id: promotionId,
    profile_id: context.id,
    branch_id: context.branchId,
    student_document_id: document?.id || null,
  }).select('id,status').single();

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You already have a request for this promo.', 'DUPLICATE_REQUEST');
    throw new Error(error.message);
  }
  return { requestId: created.id, status: created.status };
}

async function submitIssue(request: Request, body: JsonBody) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'submit-issue', 10, 300, context.id);
  const issueType = requiredString(body, 'issueType', 'Issue type', 40);
  if (!Boolean(ISSUE_TYPES[issueType])) throw new HttpError(400, 'Choose a valid issue type.', 'VALIDATION_ERROR');
  const description = optionalString(body, 'description', 500);
  const values: Record<string, unknown> = { profile_id: context.id, branch_id: context.branchId, issue_type: issueType, description };

  if (issueType === 'ghost_credit') {
    const unit = requiredString(body, 'unit', 'Affected unit', 20);
    if (!Boolean(CREDIT_UNITS[unit])) throw new HttpError(400, 'Choose Money, Time, or Coins.', 'VALIDATION_ERROR');
    const amountInserted = numericValue(body.amountInserted, 'Amount inserted', true);
    const amountCredited = numericValue(body.amountCredited, 'Amount credited', false);
    if (amountCredited > amountInserted) throw new HttpError(400, 'Credited amount cannot be greater than inserted amount.', 'VALIDATION_ERROR');
    values.unit = unit;
    values.amount_inserted = amountInserted;
    values.amount_credited = amountCredited;
  } else {
    values.points_lost = numericValue(body.pointsLost, 'Points lost', true);
  }

  const { data: created, error } = await client.from('issues').insert(values).select('id,status').single();
  if (error) throw new Error(error.message);
  return { issueId: created.id, status: created.status };
}

async function savePushSubscription(request: Request, body: JsonBody) {
  const context = await requireProfile(request, client);
  await enforceRateLimit(request, client, 'save-push-subscription', 5, 300, context.id);
  const subscription = body.subscription;
  if (!subscription || typeof subscription !== 'object') throw new HttpError(400, 'Push subscription is invalid.', 'PUSH_INVALID');
  const candidate = subscription as Record<string, unknown>;
  const endpoint = candidate.endpoint;
  const keys = candidate.keys;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys || typeof keys !== 'object') throw new HttpError(400, 'Push subscription is invalid.', 'PUSH_INVALID');
  const keyValues = keys as Record<string, unknown>;
  if (typeof keyValues.p256dh !== 'string' || typeof keyValues.auth !== 'string' || endpoint.length > 2048 || keyValues.p256dh.length > 512 || keyValues.auth.length > 512) throw new HttpError(400, 'Push subscription is invalid.', 'PUSH_INVALID');
  const { error } = await client.from('push_subscriptions').upsert({ profile_id: context.id, endpoint, p256dh: keyValues.p256dh, auth: keyValues.auth, active: true, last_used_at: new Date().toISOString() }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
  return { enabled: true };
}

async function audit(adminUserId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  const { error } = await client.from('audit_logs').insert({ admin_user_id: adminUserId, action, target_type: targetType, target_id: targetId, outcome: 'success', metadata });
  if (error) throw new Error(error.message);
}

async function adminLoadData() {
  const [
    branchesResult,
    promotionsResult,
    slotsResult,
    requestsResult,
    issuesResult,
    pendingRequestsResult,
    pendingIssuesResult,
    activePromotionsResult,
    subscribersResult,
    auditLogsResult,
    vouchersResult,
  ] = await Promise.all([
    client.from('branches').select('id,name,active').order('name'),
    client.from('promotions').select('id,name,description,audience,fulfillment_type,requires_student_document,active,published,notify_on_publish,published_at').order('created_at', { ascending: false }),
    client.from('promotion_slots').select('promotion_id,branch_id,capacity,approved_count,branches(name)'),
    client.from('promo_requests').select('id,promotion_id,profile_id,branch_id,student_document_id,status,voucher_code,created_at,reviewed_at,promotions(name),profiles(device_id,name),branches(name)').order('created_at', { ascending: false }),
    client.from('issues').select('id,profile_id,branch_id,issue_type,unit,amount_inserted,amount_credited,points_lost,description,status,created_at,reviewed_at,profiles(device_id,name),branches(name)').order('created_at', { ascending: false }),
    client.from('promo_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    client.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    client.from('promotions').select('id', { count: 'exact', head: true }).eq('active', true).eq('published', true),
    client.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('active', true),
    client.from('audit_logs').select('id,action,target_type,target_id,outcome,created_at').order('created_at', { ascending: false }).limit(12),
    client.from('promotion_vouchers').select('promotion_id,assigned_profile_id'),
  ]);
  const firstError = branchesResult.error || promotionsResult.error || slotsResult.error || requestsResult.error || issuesResult.error || pendingRequestsResult.error || pendingIssuesResult.error || activePromotionsResult.error || subscribersResult.error || auditLogsResult.error || vouchersResult.error;
  if (firstError) throw new Error(firstError.message);

  const branches = branchesResult.data || [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const slotsByPromotion = new Map<string, Array<Record<string, unknown>>>();
  for (const slot of slotsResult.data || []) {
    const list = slotsByPromotion.get(slot.promotion_id) || [];
    list.push(slot);
    slotsByPromotion.set(slot.promotion_id, list);
  }

  const voucherStatsByPromo = new Map<string, { total: number; unassigned: number; assigned: number }>();
  for (const v of vouchersResult.data || []) {
    const curr = voucherStatsByPromo.get(v.promotion_id) || { total: 0, unassigned: 0, assigned: 0 };
    curr.total += 1;
    if (v.assigned_profile_id) curr.assigned += 1;
    else curr.unassigned += 1;
    voucherStatsByPromo.set(v.promotion_id, curr);
  }

  const promotions = (promotionsResult.data || []).map((promotion) => {
    const vStats = voucherStatsByPromo.get(promotion.id) || { total: 0, unassigned: 0, assigned: 0 };
    const isVoucher = promotion.fulfillment_type === 'voucher';
    return {
      id: promotion.id,
      name: promotion.name,
      description: promotion.description,
      audience: promotion.audience,
      fulfillmentType: promotion.fulfillment_type || 'manual_topup',
      requiresStudentDocument: promotion.requires_student_document,
      active: promotion.active,
      published: promotion.published,
      notifyOnPublish: promotion.notify_on_publish,
      publishedAt: promotion.published_at,
      voucherTotalCount: vStats.total,
      voucherUnassignedCount: vStats.unassigned,
      voucherAssignedCount: vStats.assigned,
      slots: (slotsByPromotion.get(promotion.id) || []).map((slot) => {
        const capacity = Number(slot.capacity);
        const approvedCount = Number(slot.approved_count);
        return {
          branchId: slot.branch_id,
          branchName: relation(slot.branches)?.name || branchById.get(slot.branch_id)?.name || 'Unknown branch',
          capacity: isVoucher ? Math.max(capacity, vStats.total) : capacity,
          approvedCount,
          availableSlots: isVoucher ? vStats.unassigned : Math.max(0, capacity - approvedCount),
        };
      }),
    };
  });

  const requests = (requestsResult.data || []).map((item) => {
    const profile = relation(item.profiles);
    const branch = relation(item.branches);
    return {
      id: item.id,
      promotionId: item.promotion_id,
      promotionName: relation(item.promotions)?.name || 'Promo',
      profileId: item.profile_id,
      deviceId: profile?.device_id || '',
      name: profile?.name || 'Unknown user',
      branchId: item.branch_id,
      branchName: branch?.name || 'Unknown branch',
      status: item.status,
      voucherCode: item.voucher_code || null,
      studentDocumentId: item.student_document_id,
      hasStudentDocument: Boolean(item.student_document_id),
      notificationEnabled: false,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
    };
  });
  const profileIds = [...new Set([...requests.map((item) => item.profileId), ...(issuesResult.data || []).map((item) => item.profile_id)])];
  if (profileIds.length) {
    const { data: subscriptions } = await client.from('push_subscriptions').select('profile_id').eq('active', true).in('profile_id', profileIds);
    const subscribed = new Set((subscriptions || []).map((item) => item.profile_id));
    for (const item of requests) item.notificationEnabled = subscribed.has(item.profileId);
  }
  const issues = (issuesResult.data || []).map((item) => {
    const profile = relation(item.profiles);
    const branch = relation(item.branches);
    return {
      id: item.id,
      profileId: item.profile_id,
      branchId: item.branch_id,
      deviceId: profile?.device_id || '',
      name: profile?.name || 'Unknown user',
      branchName: branch?.name || 'Unknown branch',
      issueType: item.issue_type,
      issueLabel: item.issue_type === 'ghost_credit' ? 'Ghost credit' : 'Lost points',
      unit: item.unit,
      amountInserted: item.amount_inserted === null ? null : Number(item.amount_inserted),
      amountCredited: item.amount_credited === null ? null : Number(item.amount_credited),
      pointsLost: item.points_lost === null ? null : Number(item.points_lost),
      description: item.description,
      status: item.status,
      notificationEnabled: false,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
    };
  });
  if (profileIds.length) {
    const { data: subscriptions } = await client.from('push_subscriptions').select('profile_id').eq('active', true).in('profile_id', profileIds);
    const subscribed = new Set((subscriptions || []).map((item) => item.profile_id));
    for (const item of issues) item.notificationEnabled = subscribed.has(item.profileId);
  }
  const auditLogs = (auditLogsResult.data || []).map((item) => ({
    id: item.id,
    action: item.action,
    targetType: item.target_type,
    targetId: item.target_id,
    outcome: item.outcome,
    createdAt: item.created_at,
  }));

  return {
    summary: {
      pendingPromoRequests: pendingRequestsResult.count || 0,
      pendingIssues: pendingIssuesResult.count || 0,
      activePromotions: activePromotionsResult.count || 0,
      notificationSubscribers: subscribersResult.count || 0,
    },
    promotions,
    branches,
    requests,
    issues,
    auditLogs,
  };
}

async function adminSaveBranch(adminUserId: string, body: JsonBody) {
  const name = requiredString(body, 'name', 'Branch name', 80);
  const active = body.active !== false;
  const id = body.id;
  if (id !== undefined && !isUuid(id)) throw new HttpError(400, 'Branch ID is invalid.', 'VALIDATION_ERROR');
  const values = id ? { id, name, active } : { name, active };
  const { data: branch, error } = await client.from('branches').upsert(values).select('id,name,active').single();
  if (error || !branch) {
    if (error?.code === '23505') throw new HttpError(409, 'That branch already exists.', 'DUPLICATE_BRANCH');
    throw new Error(error?.message || 'Branch could not be saved.');
  }
  await audit(adminUserId, 'save_branch', 'branch', branch.id, { name: branch.name, active: branch.active });
  return { branch };
}

async function adminSavePromotion(adminUserId: string, body: JsonBody) {
  const name = requiredString(body, 'name', 'Promo name', 160);
  const description = optionalString(body, 'description', 500);
  const audience = requiredString(body, 'audience', 'Audience', 20);
  if (!['everyone', 'students'].includes(audience)) throw new HttpError(400, 'Audience is invalid.', 'VALIDATION_ERROR');
  const fulfillmentType = body.fulfillmentType === 'voucher' ? 'voucher' : 'manual_topup';
  const requiresStudentDocument = audience === 'students';
  const published = body.published === true;
  const notifyOnPublish = body.notifyOnPublish === true;
  const active = body.active !== false;
  const id = body.id;
  if (id !== undefined && !isUuid(id)) throw new HttpError(400, 'Promo ID is invalid.', 'VALIDATION_ERROR');
  const slotInput = Array.isArray(body.slots) ? body.slots : [];
  if (fulfillmentType === 'manual_topup' && !slotInput.length) {
    throw new HttpError(400, 'Add at least one branch capacity.', 'SLOTS_REQUIRED');
  }
  const slots = slotInput.map((value) => {
    if (!value || typeof value !== 'object') throw new HttpError(400, 'Branch capacity is invalid.', 'VALIDATION_ERROR');
    const item = value as Record<string, unknown>;
    if (!isUuid(item.branchId)) throw new HttpError(400, 'Branch capacity is invalid.', 'VALIDATION_ERROR');
    const capacity = numericValue(item.capacity, 'Branch capacity', false);
    if (!Number.isInteger(capacity)) throw new HttpError(400, 'Branch capacity must be a whole number.', 'VALIDATION_ERROR');
    return { branch_id: item.branchId, capacity };
  });
  const branchIds = slots.map((slot) => slot.branch_id);
  if (new Set(branchIds).size !== branchIds.length) throw new HttpError(400, 'Each branch may appear only once.', 'SLOTS_INVALID');
  if (branchIds.length) {
    const { data: branches, error: branchError } = await client.from('branches').select('id').in('id', branchIds);
    if (branchError || (branches || []).length !== new Set(branchIds).size) throw new HttpError(400, 'Every slot must use a configured branch.', 'BRANCH_INVALID');
  }

  let previous: Record<string, unknown> | null = null;
  if (id) {
    const { data, error } = await client.from('promotions').select('id,published,published_at').eq('id', id).maybeSingle();
    if (error || !data) throw new HttpError(404, 'Promo not found.', 'PROMO_NOT_FOUND');
    previous = data;
    const { data: currentSlots, error: slotError } = await client.from('promotion_slots').select('branch_id,approved_count').eq('promotion_id', id);
    if (slotError) throw new Error(slotError.message);
    const capacityByBranch = new Map(slots.map((slot) => [slot.branch_id, slot.capacity]));
    for (const current of currentSlots || []) {
      const nextCapacity = capacityByBranch.get(current.branch_id);
      if (nextCapacity === undefined && Number(current.approved_count) > 0) throw new HttpError(409, 'An approved slot cannot be removed.', 'CAPACITY_CONFLICT');
      if (nextCapacity !== undefined && nextCapacity < Number(current.approved_count)) throw new HttpError(409, 'Capacity cannot be lower than approved requests.', 'CAPACITY_CONFLICT');
    }
  }

  const publishedAt = published ? (previous?.published ? previous.published_at : new Date().toISOString()) : null;
  const values = { name, description, audience, fulfillment_type: fulfillmentType, requires_student_document: requiresStudentDocument, published, active, notify_on_publish: notifyOnPublish, published_at: publishedAt };
  const promotionResult = id
    ? await client.from('promotions').update(values).eq('id', id).select('id').single()
    : await client.from('promotions').insert(values).select('id').single();
  if (promotionResult.error || !promotionResult.data) throw new Error(promotionResult.error?.message || 'Promo could not be saved.');
  const promotionId = promotionResult.data.id;
  if (slots.length) {
    const { error: slotsError } = await client.from('promotion_slots').upsert(
      slots.map((slot) => ({ promotion_id: promotionId, branch_id: slot.branch_id, capacity: slot.capacity })),
      { onConflict: 'promotion_id,branch_id' },
    );
    if (slotsError) throw new Error(slotsError.message);
  }
  if (id) {
    const retained = new Set(branchIds);
    const { data: oldSlots } = await client.from('promotion_slots').select('branch_id,approved_count').eq('promotion_id', promotionId);
    const removable = (oldSlots || []).filter((slot) => !retained.has(slot.branch_id) && Number(slot.approved_count) === 0).map((slot) => slot.branch_id);
    if (removable.length) await client.from('promotion_slots').delete().eq('promotion_id', promotionId).in('branch_id', removable);
  }

  if (Array.isArray(body.vouchers) && body.vouchers.length > 0) {
    if (fulfillmentType !== 'voucher') throw new HttpError(400, 'Voucher codes require voucher fulfillment.', 'FULFILLMENT_INVALID');
    const rows = parseVoucherRows(body.vouchers);
    await validateVoucherBranches(rows);
    const { error: voucherError } = await client.from('promotion_vouchers').upsert(
      rows.map((row) => ({ ...row, promotion_id: promotionId })),
      { onConflict: 'promotion_id,code', ignoreDuplicates: true },
    );
    if (voucherError) throw new Error(voucherError.message);
  }

  await audit(adminUserId, id ? 'update_promotion' : 'create_promotion', 'promotion', promotionId, { published, audience, fulfillmentType });
  if (published && !previous?.published && notifyOnPublish) {
    await client.from('notification_jobs').insert({ event_type: 'new_promotion', payload: { title: 'New promo available', body: `${name} is now available in the room.`, path: '/' }, dedupe_key: `promotion:${promotionId}:${publishedAt}` }).select('id').maybeSingle();
  }
  return { promotionId };
}

async function adminImportVouchers(adminUserId: string, body: JsonBody) {
  const promotionId = requiredUuid(body, 'promotionId', 'Promotion');
  const { data: promotion, error: promotionError } = await client.from('promotions').select('id,fulfillment_type').eq('id', promotionId).maybeSingle();
  if (promotionError) throw new Error(promotionError.message);
  if (!promotion) throw new HttpError(404, 'Promo not found.', 'PROMO_NOT_FOUND');
  if (promotion.fulfillment_type !== 'voucher') throw new HttpError(409, 'Voucher codes require voucher fulfillment.', 'FULFILLMENT_INVALID');

  const rows = parseVoucherRows(body.vouchers);
  await validateVoucherBranches(rows);
  const { data, error } = await client.from('promotion_vouchers').upsert(
    rows.map((row) => ({ ...row, promotion_id: promotionId })),
    { onConflict: 'promotion_id,code', ignoreDuplicates: true },
  ).select('id');
  if (error) throw new Error(error.message);

  const importedCount = data?.length || 0;
  await audit(adminUserId, 'import_vouchers', 'promotion', promotionId, { importedCount, batchSize: rows.length });
  return { importedCount, totalBatch: rows.length };
}

async function adminGetPromotionVouchers(body: JsonBody) {
  const promotionId = requiredUuid(body, 'promotionId', 'Promotion');
  const { data, error } = await client
    .from('promotion_vouchers')
    .select('id,code,duration_label,branch_id,assigned_profile_id,assigned_at,created_at,branches(name),profiles(device_id,name)')
    .eq('promotion_id', promotionId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return {
    vouchers: (data || []).map((item) => ({
      id: item.id,
      code: item.code,
      durationLabel: item.duration_label,
      branchId: item.branch_id,
      branchName: relation(item.branches)?.name || 'All Branches',
      assignedProfileId: item.assigned_profile_id,
      assignedDevice: relation(item.profiles)?.device_id || null,
      assignedName: relation(item.profiles)?.name || null,
      assignedAt: item.assigned_at,
      createdAt: item.created_at,
    })),
  };
}

async function adminReviewPromos(adminUserId: string, body: JsonBody) {
  const requestIds = body.requestIds;
  const status = body.status;
  if (!Array.isArray(requestIds) || requestIds.length < 1 || requestIds.length > 100 || requestIds.some((id) => !isUuid(id))) throw new HttpError(400, 'Select valid requests.', 'VALIDATION_ERROR');
  if (status !== 'approved' && status !== 'rejected') throw new HttpError(400, 'Review status is invalid.', 'VALIDATION_ERROR');
  const { data, error } = await client.rpc('review_promo_requests', { p_request_ids: requestIds, p_status: status, p_admin_user_id: adminUserId });
  if (error) throw new Error(error.message);
  const result = { approved: [] as string[], rejected: [] as string[], skipped: [] as Array<{ id: string; reason: string }> };
  for (const item of data || []) {
    if (item.outcome === 'approved') result.approved.push(item.request_id);
    else if (item.outcome === 'rejected') result.rejected.push(item.request_id);
    else result.skipped.push({ id: item.request_id, reason: item.reason || 'not_processed' });
  }
  return result;
}

async function adminReviewIssue(adminUserId: string, body: JsonBody) {
  const issueId = requiredUuid(body, 'issueId', 'Issue');
  const status = body.status;
  if (status !== 'approved' && status !== 'rejected') throw new HttpError(400, 'Review status is invalid.', 'VALIDATION_ERROR');
  const { data: issue, error: issueError } = await client.from('issues').select('id,profile_id,issue_type,status').eq('id', issueId).maybeSingle();
  if (issueError || !issue) throw new HttpError(404, 'Issue not found.', 'ISSUE_NOT_FOUND');
  if (issue.status !== 'pending') throw new HttpError(409, 'This issue has already been reviewed.', 'ISSUE_ALREADY_REVIEWED');
  const { data: updatedIssue, error } = await client.from('issues').update({ status, reviewed_by: adminUserId, reviewed_at: new Date().toISOString() }).eq('id', issueId).eq('status', 'pending').select('id,status').maybeSingle();
  if (error) throw new Error(error.message);
  if (!updatedIssue) throw new HttpError(409, 'This issue has already been reviewed.', 'ISSUE_ALREADY_REVIEWED');
  await audit(adminUserId, `${status}_issue`, 'issue', issueId, { issueType: issue.issue_type });
  await client.from('notification_jobs').insert({ event_type: 'issue_reviewed', target_profile_id: issue.profile_id, payload: { title: 'Issue update', body: status === 'approved' ? 'Your issue report was approved.' : 'Your issue report was not approved.', path: '/' }, dedupe_key: `issue:${issueId}:${status}` }).select('id').maybeSingle();
  return { issueId, status };
}

async function adminDocumentUrl(adminUserId: string, body: JsonBody) {
  const documentId = requiredUuid(body, 'documentId', 'Document');
  const { data: document, error } = await client.from('student_documents').select('id,storage_path').eq('id', documentId).is('deleted_at', null).maybeSingle();
  if (error || !document) throw new HttpError(404, 'Document not found.', 'DOCUMENT_NOT_FOUND');
  const { data: signed, error: signedError } = await client.storage.from('student-documents').createSignedUrl(document.storage_path, 120);
  if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || 'Document URL could not be created.');
  await audit(adminUserId, 'view_student_document', 'student_document', documentId);
  return { url: signed.signedUrl };
}

async function handlePost(request: Request, body: JsonBody): Promise<unknown> {
  const action = body.action;
  switch (action) {
    case 'load_public_branches': return loadPublicBranches(request);
    case 'create_profile': return createProfile(request, body);
    case 'update_profile': return updateProfile(request, body);
    case 'load_public_data': return loadPublicData(request);
    case 'submit_promo_request': return submitPromoRequest(request, body);
    case 'submit_issue': return submitIssue(request, body);
    case 'save_push_subscription': return savePushSubscription(request, body);
    case 'admin_load_data': { await requireAdmin(request, client); return adminLoadData(); }
    case 'admin_save_branch': { const adminUserId = await requireAdmin(request, client); return adminSaveBranch(adminUserId, body); }
    case 'admin_save_promotion': { const adminUserId = await requireAdmin(request, client); return adminSavePromotion(adminUserId, body); }
    case 'admin_import_vouchers': { const adminUserId = await requireAdmin(request, client); return adminImportVouchers(adminUserId, body); }
    case 'admin_get_promotion_vouchers': { await requireAdmin(request, client); return adminGetPromotionVouchers(body); }
    case 'admin_review_promos': { const adminUserId = await requireAdmin(request, client); return adminReviewPromos(adminUserId, body); }
    case 'admin_review_issue': { const adminUserId = await requireAdmin(request, client); return adminReviewIssue(adminUserId, body); }
    case 'admin_document_url': { const adminUserId = await requireAdmin(request, client); return adminDocumentUrl(adminUserId, body); }
    default: throw new HttpError(404, 'Unknown API action.', 'ACTION_NOT_FOUND');
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, new HttpError(405, 'Only POST is supported.', 'METHOD_NOT_ALLOWED'));
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const action = (await request.clone().formData()).get('action');
      if (action !== 'upload_document') throw new HttpError(404, 'Unknown upload action.', 'ACTION_NOT_FOUND');
      return jsonResponse(request, await uploadDocument(request));
    }
    return jsonResponse(request, await handlePost(request, await parseJson(request)));
  } catch (error) {
    return errorResponse(request, error);
  }
});
