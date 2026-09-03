import { describe, expect, it } from 'vitest';
import {
  applyColumnMapping,
  detectColumnIndices,
  extractHeadersFromMatrix,
  normalizeBranchToken,
  normalizeVoucherCode,
  parseRawVoucherText,
  resolveBranchIdentifier,
  type SpreadsheetParseResult,
} from './importer';

describe('Voucher Importer', () => {
  const branches = [
    { id: 'b1-uuid', name: "Lisa's Canteen [Candon]" },
    { id: 'b2-uuid', name: 'Downtown Plaza Hub' },
  ];

  describe('normalizeVoucherCode', () => {
    it('normalizes uppercase and removes invalid characters', () => {
      expect(normalizeVoucherCode('  dx-8834  ')).toBe('DX-8834');
      expect(normalizeVoucherCode('wifi_100_pass')).toBe('WIFI_100_PASS');
      expect(normalizeVoucherCode('code@#123!')).toBe('CODE123');
      expect(normalizeVoucherCode(null)).toBe('');
      expect(normalizeVoucherCode('')).toBe('');
    });
  });

  describe('resolveBranchIdentifier', () => {
    it('matches branch by direct UUID', () => {
      const match = resolveBranchIdentifier('b1-uuid', branches);
      expect(match.branchId).toBe('b1-uuid');
      expect(match.branchName).toBe("Lisa's Canteen [Candon]");
      expect(match.isFallback).toBe(false);
    });

    it('matches branch by exact or clean name', () => {
      const match = resolveBranchIdentifier("Lisa's Canteen", branches);
      expect(match.branchId).toBe('b1-uuid');
    });

    it('matches branch by fuzzy token', () => {
      const match = resolveBranchIdentifier('candon', branches);
      expect(match.branchId).toBe('b1-uuid');
    });

    it('falls back to provided fallback branch if identifier is missing', () => {
      const match = resolveBranchIdentifier('', branches, 'b2-uuid');
      expect(match.branchId).toBe('b2-uuid');
      expect(match.isFallback).toBe(true);
    });

    it('returns empty when unmapped and no fallback provided', () => {
      const match = resolveBranchIdentifier('Unknown Branch', branches);
      expect(match.branchId).toBeUndefined();
      expect(match.isFallback).toBe(false);
    });
  });

  describe('detectColumnIndices', () => {
    it('detects standard PisoWiFi router export headers including branch', () => {
      const headers = ['Voucher Code', 'Duration / Time', 'Branch Name', 'Profile Name'];
      const mapping = detectColumnIndices(headers);
      expect(mapping.codeColIndex).toBe(0);
      expect(mapping.timeColIndex).toBe(1);
      expect(mapping.branchColIndex).toBe(2);
      expect(mapping.labelColIndex).toBe(3);
    });

    it('detects abbreviated headers (Code, Time, Location)', () => {
      const headers = ['PIN', 'Hours', 'Location'];
      const mapping = detectColumnIndices(headers);
      expect(mapping.codeColIndex).toBe(0);
      expect(mapping.timeColIndex).toBe(1);
      expect(mapping.branchColIndex).toBe(2);
    });

    it('defaults to index 0 if code header is not recognized', () => {
      const headers = ['SecretKey', 'ExpiryDate'];
      const mapping = detectColumnIndices(headers);
      expect(mapping.codeColIndex).toBe(0);
    });
  });

  describe('parseRawVoucherText', () => {
    it('parses newline-separated codes and assigns fallback branch', () => {
      const text = `
        DX-1001
        DX-1002
        DX-1003
      `;
      const result = parseRawVoucherText(text, '1 Hour', 'b1-uuid', branches);
      expect(result.validCount).toBe(3);
      expect(result.duplicateCount).toBe(0);
      expect(result.vouchers.map((v) => v.code)).toEqual(['DX-1001', 'DX-1002', 'DX-1003']);
      expect(result.vouchers[0].durationLabel).toBe('1 Hour');
      expect(result.vouchers[0].branchId).toBe('b1-uuid');
    });

    it('deduplicates identical codes within batch and counts duplicates', () => {
      const text = 'DX-1001, DX-1002, dx-1001, DX-1003, DX-1002';
      const result = parseRawVoucherText(text);
      expect(result.validCount).toBe(3);
      expect(result.duplicateCount).toBe(2);
      expect(result.vouchers.map((v) => v.code)).toEqual(['DX-1001', 'DX-1002', 'DX-1003']);
    });

    it('parses tab-separated codes with inline durations', () => {
      const text = 'DX-1001\t2 Hours\nDX-1002\t5 Hours';
      const result = parseRawVoucherText(text);
      expect(result.validCount).toBe(2);
      expect(result.vouchers[0].code).toBe('DX-1001');
      expect(result.vouchers[0].durationLabel).toBe('2 Hours');
      expect(result.vouchers[1].code).toBe('DX-1002');
      expect(result.vouchers[1].durationLabel).toBe('5 Hours');
    });

    it('keeps comma-separated durations attached to their voucher code', () => {
      const result = parseRawVoucherText('DX-1001, 2 Hours, Lisa Canteen\nDX-1002, 5 Hours, Downtown Plaza', undefined, undefined, branches);
      expect(result.vouchers.map((voucher) => voucher.code)).toEqual(['DX-1001', 'DX-1002']);
      expect(result.vouchers[0].durationLabel).toBe('2 Hours');
      expect(result.vouchers[0].branchId).toBe('b1-uuid');
      expect(result.vouchers[1].durationLabel).toBe('5 Hours');
      expect(result.vouchers[1].branchId).toBe('b2-uuid');
    });
  });

  describe('applyColumnMapping with irregular CSB header and data start row', () => {
    it('extracts rows starting at row offset and resolves row-level branch', () => {
      // Simulating a CSB file where:
      // Row 1: System Title Block
      // Row 2: Export Metadata
      // Row 3: Table Headers
      // Row 4+: Data Records
      const rawMatrix = [
        ['DXTECH ROUTER EXPORT SYSTEM', '', '', ''],
        ['Generated on 2026-09-03', '', '', ''],
        ['ID', 'Voucher_Pin', 'Validity', 'Branch_Name'],
        ['1', 'DX-9001', '3 Hours', 'Candon'],
        ['2', 'DX-9002', '3 Hours', 'Downtown Plaza Hub'],
        ['3', 'DX-9003', '3 Hours', ''], // Missing branch in row -> test manual fallback
        ['4', 'DX-9001', '3 Hours', 'Duplicate'],
      ];

      const headerRowIndex = 2; // Row 3
      const headers = extractHeadersFromMatrix(rawMatrix, headerRowIndex);
      expect(headers).toEqual(['ID', 'Voucher_Pin', 'Validity', 'Branch_Name']);

      const mockParsed: SpreadsheetParseResult = {
        fileName: 'export.csv',
        matrix: rawMatrix,
        headerRowIndex,
        dataStartRowIndex: 3, // Row 4
        headers,
        detectedMapping: { codeColIndex: 1, timeColIndex: 2, labelColIndex: -1, branchColIndex: 3 },
        totalRawRows: 7,
      };

      const result = applyColumnMapping(
        mockParsed,
        mockParsed.detectedMapping,
        branches,
        'b1-uuid', // manual fallback branch
        '1 Hour',
        3 // override start row index (Row 4)
      );

      expect(result.validCount).toBe(3); // 9001, 9002, 9003 (9001 dupe skipped)
      expect(result.duplicateCount).toBe(1);
      expect(result.vouchers[0].code).toBe('DX-9001');
      expect(result.vouchers[0].branchId).toBe('b1-uuid'); // matched Candon
      expect(result.vouchers[1].code).toBe('DX-9002');
      expect(result.vouchers[1].branchId).toBe('b2-uuid'); // matched Downtown
      expect(result.vouchers[2].code).toBe('DX-9003');
      expect(result.vouchers[2].branchId).toBe('b1-uuid'); // resolved via fallback
      expect(result.detectedBranches.length).toBe(2);
    });
  });
});
