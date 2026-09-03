import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/universal';

export interface ParsedVoucherItem {
  code: string;
  durationLabel?: string;
  branchId?: string;
  branchName?: string;
  rawRowIndex?: number;
}

export interface SpreadsheetParseResult {
  fileName: string;
  matrix: string[][];
  headerRowIndex: number; // 0-based index into matrix, or -1 if no header
  dataStartRowIndex: number; // 0-based index into matrix where records begin
  headers: string[];
  detectedMapping: ColumnMapping;
  totalRawRows: number;
}

export interface ColumnMapping {
  codeColIndex: number;
  timeColIndex: number;
  labelColIndex: number;
  branchColIndex: number;
}

export interface ProcessedVoucherBatch {
  vouchers: ParsedVoucherItem[];
  validCount: number;
  duplicateCount: number;
  blankCount: number;
  unresolvedBranchCount: number;
  detectedBranches: Array<{ branchId: string; branchName: string; count: number }>;
}

export interface BranchLookupTarget {
  id: string;
  name: string;
}

export function normalizeVoucherCode(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim().toUpperCase();
  // Keep alphanumeric and single hyphens/underscores, discard spaces and punctuation
  return raw.replace(/[^A-Z0-9_-]/g, '');
}

export function normalizeBranchToken(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveBranchIdentifier(
  rawIdentifier: string | undefined | null,
  branches: BranchLookupTarget[],
  fallbackBranchId?: string
): { branchId?: string; branchName?: string; isFallback: boolean } {
  const clean = String(rawIdentifier ?? '').trim();
  if (clean && branches.length > 0) {
    // 1. Direct UUID match
    const exactId = branches.find((b) => b.id.toLowerCase() === clean.toLowerCase());
    if (exactId) return { branchId: exactId.id, branchName: exactId.name, isFallback: false };

    // 2. Exact name match (case-insensitive)
    const exactName = branches.find((b) => b.name.trim().toLowerCase() === clean.toLowerCase());
    if (exactName) return { branchId: exactName.id, branchName: exactName.name, isFallback: false };
    // 3. Normalized alphanumeric tokens matching
    const token = normalizeBranchToken(clean);
    if (token) {
      const tokenMatch = branches.find((b) => {
        const bToken = normalizeBranchToken(b.name);
        return bToken === token || bToken.includes(token) || token.includes(bToken);
      });
      if (tokenMatch) return { branchId: tokenMatch.id, branchName: tokenMatch.name, isFallback: false };

      // Word-level match (e.g. "Lisa" or "Candon" in "Lisa's Canteen [Candon]")
      const cleanWords = clean.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const wordMatch = branches.find((b) => {
        const bWords = b.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        return cleanWords.some((cw) => bWords.includes(cw));
      });
      if (wordMatch) return { branchId: wordMatch.id, branchName: wordMatch.name, isFallback: false };
    }
  }

  // Fallback branch if provided and valid
  if (fallbackBranchId && fallbackBranchId !== 'all') {
    const fallback = branches.find((b) => b.id === fallbackBranchId);
    if (fallback) {
      return { branchId: fallback.id, branchName: fallback.name, isFallback: true };
    }
  }

  return { branchId: undefined, branchName: undefined, isFallback: false };
}

export function detectColumnIndices(headers: string[]): ColumnMapping {
  let codeColIndex = -1;
  let timeColIndex = -1;
  let labelColIndex = -1;
  let branchColIndex = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (codeColIndex === -1 && /^(code|voucher|voucher_code|voucher-code|voucher code|pin|ticket|token)$/i.test(h)) {
      codeColIndex = i;
    } else if (codeColIndex === -1 && /(code|voucher|pin|ticket)/i.test(h)) {
      codeColIndex = i;
    }

    if (timeColIndex === -1 && /^(time|duration|validity|hours|mins|minutes|exp|expiry)$/i.test(h)) {
      timeColIndex = i;
    } else if (timeColIndex === -1 && /(time|duration|validity|hours|mins)/i.test(h)) {
      timeColIndex = i;
    }
    if (branchColIndex === -1 && /^(branch|location|site|store|router|machine|branch_name|branch-name|branch name|branch_id|branch-id)$/i.test(h)) {
      branchColIndex = i;
    } else if (branchColIndex === -1 && /(branch|location|site|router)/i.test(h)) {
      branchColIndex = i;
    }

    if (labelColIndex === -1 && /^(name|label|profile|type|plan|package|comment|memo)$/i.test(h)) {
      labelColIndex = i;
    } else if (labelColIndex === -1 && /(name|label|profile|plan|type)/i.test(h) && i !== branchColIndex) {
      labelColIndex = i;
    }
  }

  // Fallback: if no code header matched, default to the first column (index 0)
  if (codeColIndex === -1 && headers.length > 0) {
    codeColIndex = 0;
  }

  return { codeColIndex, timeColIndex, labelColIndex, branchColIndex };
}

function looksLikeDuration(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i.test(value.trim());
}

function parseRawVoucherFields(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : line.includes(',') ? ',' : line.includes(';') ? ';' : '';
  if (delimiter) {
    const parsed = Papa.parse<string[]>(line, { delimiter, skipEmptyLines: false });
    const row = parsed.data[0];
    if (row) return row.map((field) => field.trim());
  }
  return line.split(/\t+|\s{2,}/).map((field) => field.trim());
}

export function parseRawVoucherText(
  text: string,
  defaultDuration?: string,
  defaultBranchId?: string,
  branches: BranchLookupTarget[] = []
): ProcessedVoucherBatch {
  if (!text || !text.trim()) {
    return {
      vouchers: [],
      validCount: 0,
      duplicateCount: 0,
      blankCount: 0,
      unresolvedBranchCount: 0,
      detectedBranches: [],
    };
  }

  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const vouchers: ParsedVoucherItem[] = [];
  let blankCount = 0;
  let duplicateCount = 0;
  let unresolvedBranchCount = 0;
  const branchCounts = new Map<string, { branchName: string; count: number }>();

  for (let i = 0; i < lines.length; i++) {
    const fields = parseRawVoucherFields(lines[i]).filter(Boolean);
    if (!fields.length) {
      blankCount++;
      continue;
    }

    const isCodeList = fields.length > 1
      && fields.every((field) => /^[A-Za-z0-9_-]+$/.test(field))
      && !looksLikeDuration(fields[1]);
    
    // If not a pure code-list, check fields: [0] = code, [1] = duration, [2] = branch
    const records = isCodeList
      ? fields.map((code) => ({ code, duration: undefined, branchStr: undefined }))
      : [{ code: fields[0], duration: fields[1], branchStr: fields[2] }];

    for (const record of records) {
      const code = normalizeVoucherCode(record.code);
      const duration = record.duration?.trim() || defaultDuration || undefined;
      if (!code) {
        blankCount++;
        continue;
      }
      if (seen.has(code)) {
        duplicateCount++;
        continue;
      }

      const branchRes = resolveBranchIdentifier(record.branchStr, branches, defaultBranchId);
      if (!branchRes.branchId && defaultBranchId && defaultBranchId !== 'all') {
        unresolvedBranchCount++;
      }

      if (branchRes.branchId) {
        const current = branchCounts.get(branchRes.branchId) || { branchName: branchRes.branchName || 'Branch', count: 0 };
        current.count++;
        branchCounts.set(branchRes.branchId, current);
      }

      seen.add(code);
      vouchers.push({
        code,
        durationLabel: duration,
        branchId: branchRes.branchId,
        branchName: branchRes.branchName,
        rawRowIndex: i + 1,
      });
    }
  }

  const detectedBranches = Array.from(branchCounts.entries()).map(([branchId, info]) => ({
    branchId,
    branchName: info.branchName,
    count: info.count,
  }));

  return {
    vouchers,
    validCount: vouchers.length,
    duplicateCount,
    blankCount,
    unresolvedBranchCount,
    detectedBranches,
  };
}

export function extractHeadersFromMatrix(
  matrix: string[][],
  headerRowIndex: number
): string[] {
  if (headerRowIndex < 0 || headerRowIndex >= matrix.length) {
    const maxCols = matrix.reduce((max, r) => Math.max(max, r.length), 0);
    return Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  }
  const row = matrix[headerRowIndex];
  return row.map((cell, i) => cell.trim() || `Column ${i + 1}`);
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetParseResult> {
  const name = file.name.toLowerCase();
  let rawMatrix: string[][] = [];

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const excelRows = (await readXlsxFile(file)) as unknown as unknown[][];
    rawMatrix = excelRows.map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
    );
  } else {
    // CSV, TSV, TXT
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: false,
    });
    rawMatrix = (parsed.data || []).map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
    );
  }

  // Remove completely empty rows from the very bottom
  while (rawMatrix.length > 0 && rawMatrix[rawMatrix.length - 1].every((c) => !c)) {
    rawMatrix.pop();
  }

  if (!rawMatrix.length) {
    return {
      fileName: file.name,
      matrix: [],
      headerRowIndex: -1,
      dataStartRowIndex: 0,
      headers: [],
      detectedMapping: { codeColIndex: -1, timeColIndex: -1, labelColIndex: -1, branchColIndex: -1 },
      totalRawRows: 0,
    };
  }

  // Find first row with at least one non-empty string as candidate header
  let headerRowIndex = 0;
  for (let i = 0; i < rawMatrix.length; i++) {
    if (rawMatrix[i].some((c) => Boolean(c && c.trim()))) {
      headerRowIndex = i;
      break;
    }
  }

  const dataStartRowIndex = Math.min(rawMatrix.length, headerRowIndex + 1);
  const headers = extractHeadersFromMatrix(rawMatrix, headerRowIndex);
  const detectedMapping = detectColumnIndices(headers);

  return {
    fileName: file.name,
    matrix: rawMatrix,
    headerRowIndex,
    dataStartRowIndex,
    headers,
    detectedMapping,
    totalRawRows: rawMatrix.length,
  };
}

export function applyColumnMapping(
  parsed: SpreadsheetParseResult,
  mapping: ColumnMapping,
  branches: BranchLookupTarget[] = [],
  fallbackBranchId?: string,
  fallbackDuration?: string,
  overrideDataStartRow?: number
): ProcessedVoucherBatch {
  const seen = new Set<string>();
  const vouchers: ParsedVoucherItem[] = [];
  let blankCount = 0;
  let duplicateCount = 0;
  let unresolvedBranchCount = 0;
  const branchCounts = new Map<string, { branchName: string; count: number }>();

  const startRow = typeof overrideDataStartRow === 'number'
    ? Math.max(0, overrideDataStartRow)
    : parsed.dataStartRowIndex;

  for (let i = startRow; i < parsed.matrix.length; i++) {
    const row = parsed.matrix[i];
    if (!row || row.every((c) => !c || !c.trim())) {
      blankCount++;
      continue;
    }

    const rawCode = mapping.codeColIndex >= 0 && mapping.codeColIndex < row.length ? row[mapping.codeColIndex] : '';
    const code = normalizeVoucherCode(rawCode);

    if (!code) {
      blankCount++;
      continue;
    }

    if (seen.has(code)) {
      duplicateCount++;
      continue;
    }

    seen.add(code);

    let duration: string | undefined = undefined;
    if (mapping.timeColIndex >= 0 && mapping.timeColIndex < row.length && row[mapping.timeColIndex]) {
      duration = row[mapping.timeColIndex].trim();
    } else if (fallbackDuration) {
      duration = fallbackDuration.trim();
    }

    const rawBranch = mapping.branchColIndex >= 0 && mapping.branchColIndex < row.length ? row[mapping.branchColIndex] : undefined;
    const branchRes = resolveBranchIdentifier(rawBranch, branches, fallbackBranchId);
    if (!branchRes.branchId && fallbackBranchId && fallbackBranchId !== 'all') {
      unresolvedBranchCount++;
    }

    if (branchRes.branchId) {
      const current = branchCounts.get(branchRes.branchId) || { branchName: branchRes.branchName || 'Branch', count: 0 };
      current.count++;
      branchCounts.set(branchRes.branchId, current);
    }

    vouchers.push({
      code,
      durationLabel: duration,
      branchId: branchRes.branchId,
      branchName: branchRes.branchName,
      rawRowIndex: i + 1, // 1-based source row
    });
  }

  const detectedBranches = Array.from(branchCounts.entries()).map(([branchId, info]) => ({
    branchId,
    branchName: info.branchName,
    count: info.count,
  }));

  return {
    vouchers,
    validCount: vouchers.length,
    duplicateCount,
    blankCount,
    unresolvedBranchCount,
    detectedBranches,
  };
}
