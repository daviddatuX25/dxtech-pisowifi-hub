export type Audience = 'everyone' | 'students';
export type FulfillmentType = 'manual_topup' | 'voucher';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type IssueType = 'ghost_credit' | 'lost_points';
export type IssueStatus = RequestStatus;
export type CreditUnit = 'money' | 'time' | 'coins';

export interface Branch {
  id: string;
  name: string;
  active: boolean;
}

export interface Profile {
  id: string;
  deviceId: string;
  name: string;
  branchId: string;
  branchName: string;
  hasStudentDocument: boolean;
  notificationsEnabled: boolean;
}

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  audience: Audience;
  fulfillmentType: FulfillmentType;
  requiresStudentDocument: boolean;
  branchId: string;
  branchName: string;
  capacity: number;
  approvedCount: number;
  availableSlots: number;
  myRequestStatus: RequestStatus | null;
  myVoucherCode: string | null;
  publishedAt: string | null;
}

export interface PromoRequest {
  id: string;
  promotionId: string;
  promotionName: string;
  branchName: string;
  status: RequestStatus;
  voucherCode: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface Issue {
  id: string;
  issueType: IssueType;
  issueLabel: string;
  branchName: string;
  unit: CreditUnit | null;
  amountInserted: number | null;
  amountCredited: number | null;
  pointsLost: number | null;
  description: string | null;
  status: IssueStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface PublicData {
  profile: Profile;
  promotions: Promotion[];
  requests: PromoRequest[];
  issues: Issue[];
}

export interface AdminSummary {
  pendingPromoRequests: number;
  pendingIssues: number;
  activePromotions: number;
  notificationSubscribers: number;
}

export interface AdminPromotion {
  id: string;
  name: string;
  description: string | null;
  audience: Audience;
  fulfillmentType: FulfillmentType;
  requiresStudentDocument: boolean;
  active: boolean;
  published: boolean;
  notifyOnPublish: boolean;
  publishedAt: string | null;
  voucherTotalCount?: number;
  voucherUnassignedCount?: number;
  voucherAssignedCount?: number;
  slots: Array<{
    branchId: string;
    branchName: string;
    capacity: number;
    approvedCount: number;
    availableSlots: number;
  }>;
}

export interface AdminRequest {
  id: string;
  promotionId: string;
  promotionName: string;
  profileId: string;
  deviceId: string;
  name: string;
  branchId: string;
  branchName: string;
  status: RequestStatus;
  voucherCode: string | null;
  studentDocumentId: string | null;
  hasStudentDocument: boolean;
  notificationEnabled: boolean;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AdminIssue {
  id: string;
  profileId: string;
  deviceId: string;
  name: string;
  branchId: string;
  branchName: string;
  issueType: IssueType;
  issueLabel: string;
  unit: CreditUnit | null;
  amountInserted: number | null;
  amountCredited: number | null;
  pointsLost: number | null;
  description: string | null;
  status: IssueStatus;
  notificationEnabled: boolean;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: string;
  createdAt: string;
}

export interface VoucherInventoryItem {
  id: string;
  code: string;
  durationLabel: string | null;
  branchId: string | null;
  branchName: string;
  assignedProfileId: string | null;
  assignedDevice: string | null;
  assignedName: string | null;
  assignedAt: string | null;
  createdAt: string;
}

export interface AdminData {
  summary: AdminSummary;
  promotions: AdminPromotion[];
  branches: Branch[];
  requests: AdminRequest[];
  issues: AdminIssue[];
  auditLogs: AdminAuditLog[];
}

export interface ApiErrorPayload {
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}
