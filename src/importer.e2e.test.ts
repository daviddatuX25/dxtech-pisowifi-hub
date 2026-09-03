import { describe, expect, it } from 'vitest';
import {
  applyColumnMapping,
  detectColumnIndices,
  extractHeadersFromMatrix,
  normalizeVoucherCode,
  parseRawVoucherText,
  resolveBranchIdentifier,
  type SpreadsheetParseResult,
} from './importer';

describe('Voucher Importer End-to-End Suite', () => {
  const branches = [
    { id: 'b1-uuid', name: "Lisa's Canteen [Candon]" },
    { id: 'b2-uuid', name: 'Downtown Plaza Hub' },
    { id: 'b3-uuid', name: 'West Campus Station' },
  ];

  it('handles irregular CSB exports without headers (starts row 1)', () => {
    const rawMatrix = [
      ['DX-NOHEAD-01', '1hr', 'Lisa Canteen'],
      ['DX-NOHEAD-02', '2hr', 'Downtown Plaza'],
      ['DX-NOHEAD-03', '3hr', ''],
    ];

    const mockParsed: SpreadsheetParseResult = {
      fileName: 'no-headers.csv',
      matrix: rawMatrix,
      headerRowIndex: -1, // No header
      dataStartRowIndex: 0,
      headers: ['Column 1', 'Column 2', 'Column 3'],
      detectedMapping: { codeColIndex: 0, timeColIndex: 1, labelColIndex: -1, branchColIndex: 2 },
      totalRawRows: 3,
    };

    const result = applyColumnMapping(
      mockParsed,
      mockParsed.detectedMapping,
      branches,
      'b3-uuid' // Fallback to West Campus Station
    );

    expect(result.validCount).toBe(3);
    expect(result.vouchers[0].branchId).toBe('b1-uuid');
    expect(result.vouchers[1].branchId).toBe('b2-uuid');
    expect(result.vouchers[2].branchId).toBe('b3-uuid'); // used fallback
    expect(result.detectedBranches.length).toBe(3);
  });

  it('handles CSB export completely lacking branch column with manual fallback', () => {
    const rawMatrix = [
      ['Router Batch #441 Export'],
      ['Operator: John Doe | Station: 04'],
      ['CODE', 'DURATION', 'PLAN'],
      ['DX-GEN-101', '10 Hours', 'VIP'],
      ['DX-GEN-102', '10 Hours', 'VIP'],
    ];

    const headerRowIndex = 2; // Row 3
    const headers = extractHeadersFromMatrix(rawMatrix, headerRowIndex);

    const mockParsed: SpreadsheetParseResult = {
      fileName: 'single-branch-router.csv',
      matrix: rawMatrix,
      headerRowIndex,
      dataStartRowIndex: 3,
      headers,
      detectedMapping: { codeColIndex: 0, timeColIndex: 1, labelColIndex: 2, branchColIndex: -1 }, // No branch col
      totalRawRows: 5,
    };

    const result = applyColumnMapping(
      mockParsed,
      mockParsed.detectedMapping,
      branches,
      'b2-uuid' // All assigned to Downtown Plaza Hub
    );

    expect(result.validCount).toBe(2);
    expect(result.vouchers[0].branchId).toBe('b2-uuid');
    expect(result.vouchers[1].branchId).toBe('b2-uuid');
    expect(result.detectedBranches).toEqual([
      { branchId: 'b2-uuid', branchName: 'Downtown Plaza Hub', count: 2 },
    ]);
  });
});
