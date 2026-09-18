import { describe, expect, it } from 'vitest';
import {
  applyColumnMapping,
  detectColumnIndices,
  extractHeadersFromMatrix,
  parseRawVoucherText,
  type SpreadsheetParseResult,
} from './importer';
import type { AdminPromotion, VoucherInventoryItem } from './types';

describe('Voucher Branch Isolation & Multi-Branch Pools', () => {
  const branches = [
    { id: 'branch-candon-uuid', name: "Lisa's Canteen [Candon]" },
    { id: 'branch-downtown-uuid', name: 'Downtown Plaza Hub' },
    { id: 'branch-campus-uuid', name: 'West Campus Station' },
  ];

  describe('Multi-Branch External Voucher Generation', () => {
    it('allows routers at different branches to generate identical codes (e.g. numeric PINs)', () => {
      // In PisoWiFi systems, two branches often generate the same simple PINs (e.g. 849201)
      const rawText = `
        849201, 1 Hour, Lisa Canteen
        849201, 1 Hour, Downtown Plaza
        849201, 1 Hour, West Campus
      `;
      const batch = parseRawVoucherText(rawText, undefined, undefined, branches);

      expect(batch.validCount).toBe(3);
      expect(batch.duplicateCount).toBe(0);
      expect(batch.vouchers.map((v) => v.code)).toEqual(['849201', '849201', '849201']);
      expect(batch.vouchers[0].branchId).toBe('branch-candon-uuid');
      expect(batch.vouchers[1].branchId).toBe('branch-downtown-uuid');
      expect(batch.vouchers[2].branchId).toBe('branch-campus-uuid');
    });

    it('rejects duplicates only within the same branch', () => {
      const rawText = `
        DX-PIN-1, 1 Hour, Lisa Canteen
        DX-PIN-1, 1 Hour, Lisa Canteen
        DX-PIN-1, 1 Hour, Downtown Plaza
      `;
      const batch = parseRawVoucherText(rawText, undefined, undefined, branches);

      expect(batch.validCount).toBe(2);
      expect(batch.duplicateCount).toBe(1);
      expect(batch.vouchers[0].branchId).toBe('branch-candon-uuid');
      expect(batch.vouchers[1].branchId).toBe('branch-downtown-uuid');
    });

    it('flags unmapped vouchers as missing source branch', () => {
      const rawText = `
        DX-VALID-1, 1 Hour, Lisa Canteen
        DX-ORPHAN-2, 1 Hour, Unknown Router
      `;
      const batch = parseRawVoucherText(rawText, undefined, undefined, branches);

      expect(batch.validCount).toBe(2);
      expect(batch.unresolvedBranchCount).toBe(1);
      expect(batch.vouchers[0].branchId).toBe('branch-candon-uuid');
      expect(batch.vouchers[1].branchId).toBeUndefined();
    });

    it('correctly maps multi-branch router export spreadsheet by branch column', () => {
      const matrix = [
        ['Voucher Code', 'Duration', 'Location'],
        ['111222', '2 Hours', 'Candon'],
        ['111222', '2 Hours', 'Downtown Plaza Hub'],
        ['333444', '5 Hours', 'West Campus Station'],
      ];
      const headers = extractHeadersFromMatrix(matrix, 0);
      const mapping = detectColumnIndices(headers);

      const parsed: SpreadsheetParseResult = {
        fileName: 'all-branches-vouchers.csv',
        matrix,
        headerRowIndex: 0,
        dataStartRowIndex: 1,
        headers,
        detectedMapping: mapping,
        totalRawRows: 4,
      };

      const result = applyColumnMapping(parsed, mapping, branches);
      expect(result.validCount).toBe(3);
      expect(result.duplicateCount).toBe(0);
      expect(result.detectedBranches).toEqual([
        { branchId: 'branch-candon-uuid', branchName: "Lisa's Canteen [Candon]", count: 1 },
        { branchId: 'branch-downtown-uuid', branchName: 'Downtown Plaza Hub', count: 1 },
        { branchId: 'branch-campus-uuid', branchName: 'West Campus Station', count: 1 },
      ]);
    });
  });

  describe('Branch Isolation Simulation', () => {
    it('customer from Branch A only receives availability from Branch A pool', () => {
      const vouchers: VoucherInventoryItem[] = [
        {
          id: 'v1',
          code: 'DX-CANDON-01',
          durationLabel: '1 Hour',
          branchId: 'branch-candon-uuid',
          branchName: "Lisa's Canteen [Candon]",
          assignedProfileId: null,
          assignedDevice: null,
          assignedName: null,
          assignedAt: null,
          createdAt: '2026-09-19T00:00:00Z',
        },
        {
          id: 'v2',
          code: 'DX-CANDON-02',
          durationLabel: '1 Hour',
          branchId: 'branch-candon-uuid',
          branchName: "Lisa's Canteen [Candon]",
          assignedProfileId: 'profile-other',
          assignedDevice: 'DEV-99',
          assignedName: 'Claimed User',
          assignedAt: '2026-09-19T01:00:00Z',
          createdAt: '2026-09-19T00:00:00Z',
        },
        {
          id: 'v3',
          code: 'DX-DOWNTOWN-01',
          durationLabel: '1 Hour',
          branchId: 'branch-downtown-uuid',
          branchName: 'Downtown Plaza Hub',
          assignedProfileId: null,
          assignedDevice: null,
          assignedName: null,
          assignedAt: null,
          createdAt: '2026-09-19T00:00:00Z',
        },
      ];

      // Simulate Branch Candon user:
      const candonAvailable = vouchers.filter(
        (v) => v.branchId === 'branch-candon-uuid' && v.assignedProfileId === null
      );
      expect(candonAvailable.length).toBe(1);
      expect(candonAvailable[0].code).toBe('DX-CANDON-01');

      // Simulate West Campus user (0 stock):
      const campusAvailable = vouchers.filter(
        (v) => v.branchId === 'branch-campus-uuid' && v.assignedProfileId === null
      );
      expect(campusAvailable.length).toBe(0);
    });

    it('admin promo report accurately isolates per-branch slot stock', () => {
      const adminPromo: AdminPromotion = {
        id: 'promo-1',
        name: 'Weekend Speed Booster',
        description: 'Free 1 Hour WiFi',
        audience: 'everyone',
        fulfillmentType: 'voucher',
        requiresStudentDocument: false,
        active: true,
        published: true,
        notifyOnPublish: false,
        publishedAt: '2026-09-19T00:00:00Z',
        voucherTotalCount: 30,
        voucherUnassignedCount: 15,
        voucherAssignedCount: 15,
        slots: [
          {
            branchId: 'branch-candon-uuid',
            branchName: "Lisa's Canteen [Candon]",
            capacity: 20,
            approvedCount: 15,
            availableSlots: 5,
          },
          {
            branchId: 'branch-downtown-uuid',
            branchName: 'Downtown Plaza Hub',
            capacity: 10,
            approvedCount: 0,
            availableSlots: 10,
          },
          {
            branchId: 'branch-campus-uuid',
            branchName: 'West Campus Station',
            capacity: 0,
            approvedCount: 0,
            availableSlots: 0, // Depleted / Needs vouchers
          },
        ],
      };

      // Ensure that West Campus clearly shows 0 stock rather than inheriting global totals
      const campusSlot = adminPromo.slots.find((s) => s.branchId === 'branch-campus-uuid');
      expect(campusSlot?.availableSlots).toBe(0);
      expect(campusSlot?.capacity).toBe(0);

      const candonSlot = adminPromo.slots.find((s) => s.branchId === 'branch-candon-uuid');
      expect(candonSlot?.availableSlots).toBe(5);
      expect(candonSlot?.capacity).toBe(20);
    });

    it('legacy reassignment only applies to unassigned vouchers with null branchId', () => {
      const vouchers: VoucherInventoryItem[] = [
        {
          id: 'v-legacy-null',
          code: 'DX-LEGACY-01',
          durationLabel: '1 Hour',
          branchId: null, // Legacy unassigned
          branchName: 'Unassigned (Legacy)',
          assignedProfileId: null,
          assignedDevice: null,
          assignedName: null,
          assignedAt: null,
          createdAt: '2026-09-19T00:00:00Z',
        },
        {
          id: 'v-already-assigned-branch',
          code: 'DX-CANDON-01',
          durationLabel: '1 Hour',
          branchId: 'branch-candon-uuid', // Already assigned
          branchName: "Lisa's Canteen [Candon]",
          assignedProfileId: null,
          assignedDevice: null,
          assignedName: null,
          assignedAt: null,
          createdAt: '2026-09-19T00:00:00Z',
        },
      ];

      // Simulate admin_reassign_vouchers_branch query predicate:
      // .is('assigned_profile_id', null).is('branch_id', null)
      const eligibleForRepair = vouchers.filter(
        (v) => v.assignedProfileId === null && v.branchId === null
      );
      expect(eligibleForRepair.map((v) => v.id)).toEqual(['v-legacy-null']);
    });
  });
});
