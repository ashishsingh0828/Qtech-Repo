import { randomUUID } from "node:crypto";
import {
  GROUP_TINTS,
  MAX_ROWS,
  autoNamePrefix,
  cleanLabel,
  excelDateToISO,
  groupKeyFromLabel,
  isServerManagedField,
  normalizeGroupKey,
  type ColumnType,
  type DatasetColumn,
  type DatasetGroup,
  type DatasetSchema,
} from "@app/shared";
import { ValueType, Workbook, type Cell, type Worksheet } from "exceljs";
import { AppError } from "../../lib/errors";

const MAX_COLUMNS = 512;

type RawValue = string | number | boolean;

type Grid = Map<number, Map<number, RawValue>>;

type ColumnDraft = {
  col: number;
  groupIndex: number;
  header: string;
  label: string;
  originalLabel: string;
  autoNamed: boolean;
  key: string;
  type: ColumnType;
  semantic: string | null;
};

export type ParsedWorkbook = {
  schema: DatasetSchema;
  rows: Array<Record<string, string | number | boolean>>;
};

const LABEL_RULES: Array<{ pattern: RegExp; key: string; type: ColumnType }> = [
  { pattern: /^(mobile|mobile no\.?|phone|phone no\.?|contact no\.?|contact number)$/i, key: "mobile", type: "phone" },
  { pattern: /^(serial no\.?|serial number)$/i, key: "serial", type: "text" },
  { pattern: /^(e-?mail|email id)$/i, key: "email", type: "email" },
  { pattern: /^month$/i, key: "month", type: "integer" },
  { pattern: /^year$/i, key: "year", type: "integer" },
  { pattern: /^sr\.?\s*no\.?$/i, key: "sr_no", type: "integer" },
  { pattern: /^days$/i, key: "days", type: "integer" },
  { pattern: /^total pms$/i, key: "total_pms", type: "decimal" },
  { pattern: /^validated$/i, key: "validated", type: "yesno" },
  { pattern: /^validated by$/i, key: "validated_by", type: "text" },
  { pattern: /^validated at$/i, key: "validated_at", type: "date" },
  { pattern: /^(validation due|by when data will be validated)$/i, key: "validation_due", type: "date" },
  { pattern: /^rejection reason$/i, key: "rejection_reason", type: "text" },
  { pattern: /^proposal sent(?: at)?$/i, key: "proposal_sent_at", type: "date" },
  { pattern: /^ack(?:nowledge(?:d)?)? note$/i, key: "ack_note", type: "text" },
  { pattern: /^ack(?:nowledge(?:d)?)? response$/i, key: "ack_response", type: "status" },
  { pattern: /^verified$/i, key: "verified", type: "status" },
  { pattern: /^verified by$/i, key: "verified_by", type: "text" },
  { pattern: /^verified at$/i, key: "verified_at", type: "date" },
  { pattern: /^amc status$/i, key: "amc_status", type: "status" },
  { pattern: /^amc$/i, key: "amc_status", type: "status" },
  { pattern: /^ack(?:nowledged)? at$/i, key: "ack_at", type: "date" },
  { pattern: /^warranty live$/i, key: "warranty_live", type: "yesno" },
  { pattern: /^(start date|warranty start)$/i, key: "start_date", type: "date" },
  { pattern: /^(end date|warranty end|warranty end date)$/i, key: "end_date", type: "date" },
  { pattern: /^(follow up|follow-up|next follow up|next follow-up)$/i, key: "next_follow_up", type: "date" },
  { pattern: /^open calls$/i, key: "open_calls", type: "integer" },
  { pattern: /^last call date$/i, key: "last_call_date", type: "date" },
];

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
  let best: { count: number; worksheet: Worksheet; grid: Grid } | null = null;
  for (const worksheet of workbook.worksheets) {
    const grid = readGrid(worksheet);
    const count = countCells(grid);
    if (count === 0) continue;
    if (!best || count > best.count) best = { count, worksheet, grid };
  }
  if (!best) {
    throw new AppError("VALIDATION", 400, "The workbook has no data.");
  }
  return buildWorkbook(best.grid, best.worksheet);
}

function readGrid(worksheet: Worksheet): Grid {
  const grid: Grid = new Map();
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = readCell(cell);
      if (value === null) return;
      let columns = grid.get(rowNumber);
      if (!columns) {
        columns = new Map();
        grid.set(rowNumber, columns);
      }
      columns.set(colNumber, value);
    });
  });
  return grid;
}

function countCells(grid: Grid): number {
  let count = 0;
  for (const columns of grid.values()) count += columns.size;
  return count;
}

function buildWorkbook(grid: Grid, worksheet: Worksheet): ParsedWorkbook {
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = 0;
  for (const [rowNumber, columns] of grid) {
    minRow = Math.min(minRow, rowNumber);
    maxRow = Math.max(maxRow, rowNumber);
    for (const colNumber of columns.keys()) {
      minCol = Math.min(minCol, colNumber);
      maxCol = Math.max(maxCol, colNumber);
    }
  }
  const width = maxCol - minCol + 1;
  if (!Number.isFinite(minRow) || width < 1) {
    throw new AppError("VALIDATION", 400, "The workbook has no data.");
  }
  if (width > MAX_COLUMNS) {
    throw new AppError("VALIDATION", 400, "This sheet has too many columns to import.");
  }

  const bannerCount = countRow(grid, minRow, minCol, maxCol);
  const nextCount = countRow(grid, minRow + 1, minCol, maxCol);
  const isBanner = mergesTouchRow(worksheet, minRow) || (grid.has(minRow + 1) && bannerCount < nextCount);
  const headerRow = isBanner ? minRow + 1 : minRow;
  const dataStart = headerRow + 1;
  const spans = bannerSpans(grid, minRow, minCol, maxCol, isBanner);
  const groups = spans.map((span, index) => ({
    id: randomUUID(),
    label: span.label,
    groupKey: span.groupKey,
    order: index,
    tint: GROUP_TINTS[index % GROUP_TINTS.length] ?? GROUP_TINTS[0],
    deletedAt: null,
  }));

  const drafts: ColumnDraft[] = [];
  for (let col = minCol; col <= maxCol; col += 1) {
    const groupIndex = groupIndexFor(spans, col);
    const header = cellText(grid.get(headerRow)?.get(col) ?? null);
    drafts.push({
      col,
      groupIndex,
      header,
      label: header,
      originalLabel: header,
      autoNamed: false,
      key: "",
      type: "text",
      semantic: null,
    });
  }
  applyAutoNames(drafts, groups);
  const usedKeys = new Set<string>();
  for (const draft of drafts) {
    const rule = matchLabel(draft.label);
    const samples = columnSamples(grid, draft.col, dataStart, maxRow);
    draft.type = rule?.type ?? inferType(samples);
    draft.semantic = rule?.key ?? null;
    const base = rule?.key ?? normalizeGroupKey(draft.label);
    draft.key = uniqueKey(base || "column", usedKeys);
    if (rule && draft.key !== rule.key) draft.semantic = rule.key;
  }

  const columns: DatasetColumn[] = drafts.map((draft, index) => ({
    key: draft.key,
    label: draft.label,
    originalLabel: draft.originalLabel,
    autoNamed: draft.autoNamed,
    groupId: groups[draft.groupIndex]?.id ?? groups[0]?.id ?? "",
    order: index,
    type: draft.type,
    semantic: draft.semantic,
    system: isServerManagedField(draft.key),
    width: 120,
    hidden: false,
    options: [],
    deletedAt: null,
  }));

  const rows: Array<Record<string, string | number | boolean>> = [];
  for (let rowNumber = dataStart; rowNumber <= maxRow; rowNumber += 1) {
    const source = grid.get(rowNumber);
    if (!source) continue;
    const record: Record<string, string | number | boolean> = {};
    for (const draft of drafts) {
      const raw = source.get(draft.col);
      if (raw === undefined) continue;
      const value = castValue(raw, draft.type);
      if (value === null) continue;
      record[draft.key] = value;
    }
    if (Object.keys(record).length === 0) continue;
    rows.push(record);
    if (rows.length > MAX_ROWS) {
      throw new AppError("VALIDATION", 400, `This file has more than ${MAX_ROWS} rows.`);
    }
  }

  fillOptions(columns, drafts, rows);
  const schema: DatasetSchema = { version: 1, groups, columns };
  return { schema, rows };
}

function fillOptions(
  columns: DatasetColumn[],
  drafts: ColumnDraft[],
  rows: Array<Record<string, string | number | boolean>>,
): void {
  columns.forEach((column, index) => {
    const draft = drafts[index];
    if (!draft) return;
    if (column.type === "yesno") {
      column.options = ["Yes", "No"];
      return;
    }
    if (column.type !== "status" && column.type !== "category") return;
    const values = new Set<string>();
    for (const row of rows) {
      const value = row[column.key];
      if (typeof value === "string" && value) values.add(value);
      if (values.size > 30) {
        column.options = [];
        return;
      }
    }
    column.options = [...values].sort((left, right) => left.localeCompare(right));
  });
}

type Span = { start: number; label: string; groupKey: string };

function bannerSpans(grid: Grid, bannerRow: number, minCol: number, maxCol: number, isBanner: boolean): Span[] {
  if (!isBanner) return [{ start: minCol, label: "General", groupKey: "general" }];
  const found: Span[] = [];
  const used = new Set<string>();
  for (let col = minCol; col <= maxCol; col += 1) {
    const label = cellText(grid.get(bannerRow)?.get(col) ?? null);
    if (!label) continue;
    found.push({ start: col, label, groupKey: uniqueKey(groupKeyFromLabel(label), used) });
  }
  if (found.length === 0) return [{ start: minCol, label: "General", groupKey: "general" }];
  if (found[0] && found[0].start > minCol) {
    found.unshift({ start: minCol, label: "General", groupKey: uniqueKey("general", used) });
  }
  return found;
}

function groupIndexFor(spans: Span[], col: number): number {
  let index = 0;
  for (let cursor = 0; cursor < spans.length; cursor += 1) {
    const span = spans[cursor];
    if (span && span.start <= col) index = cursor;
  }
  return index;
}

function applyAutoNames(drafts: ColumnDraft[], groups: DatasetGroup[]): void {
  const byGroup = new Map<number, ColumnDraft[]>();
  for (const draft of drafts) {
    const list = byGroup.get(draft.groupIndex) ?? [];
    list.push(draft);
    byGroup.set(draft.groupIndex, list);
  }
  for (const [index, columns] of byGroup) {
    const unnamed = columns.filter((column) => column.header === "");
    const groupLabel = groups[index]?.label ?? "General";
    if (unnamed.length === 1) {
      const column = unnamed[0];
      if (!column) continue;
      column.label = groupLabel;
      column.originalLabel = "";
      column.autoNamed = true;
      continue;
    }
    if (unnamed.length > 1) {
      const prefix = autoNamePrefix(groupLabel) || groupLabel;
      unnamed.forEach((column, offset) => {
        column.label = `${prefix} ${offset + 1}`;
        column.originalLabel = "";
        column.autoNamed = true;
      });
    }
  }
}

function matchLabel(label: string): { key: string; type: ColumnType } | null {
  const pms = /^pms\s*[-:]?\s*(\d+)$/i.exec(label);
  if (pms?.[1]) return { key: `pms:${pms[1]}`, type: "date" };
  const done = /^pm\s*date\s*[-:]?\s*(\d+)$/i.exec(label);
  if (done?.[1]) return { key: `pm_date:${done[1]}`, type: "date" };
  for (const rule of LABEL_RULES) {
    if (rule.pattern.test(label)) return { key: rule.key, type: rule.type };
  }
  return null;
}

function columnSamples(grid: Grid, col: number, dataStart: number, maxRow: number): RawValue[] {
  const samples: RawValue[] = [];
  for (let rowNumber = dataStart; rowNumber <= maxRow; rowNumber += 1) {
    const value = grid.get(rowNumber)?.get(col);
    if (value !== undefined) samples.push(value);
  }
  return samples;
}

function inferType(samples: RawValue[]): ColumnType {
  if (samples.length === 0) return "text";
  if (samples.every(isYesNoValue)) return "yesno";
  if (samples.every((value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return "email";
  if (samples.every(isDateLike)) return "date";
  const numbers = samples.map(parseLooseNumber);
  if (numbers.every((value) => value !== null)) {
    return numbers.every((value) => value !== null && Number.isInteger(value)) ? "integer" : "decimal";
  }
  if (samples.every((value) => typeof value === "string") && isCategory(samples)) return "category";
  return "text";
}

function isCategory(samples: RawValue[]): boolean {
  if (samples.length < 4) return false;
  const values = new Set(samples.map((value) => String(value)));
  if (values.size > 8) return false;
  for (const value of values) {
    if (value.length > 24) return false;
  }
  return true;
}

function isYesNoValue(value: RawValue): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return value === 0 || value === 1;
  if (typeof value !== "string") return false;
  return ["yes", "no", "y", "n", "true", "false"].includes(value.trim().toLowerCase());
}

function isDateLike(value: RawValue): boolean {
  if (typeof value === "string") {
    if (/^na$/i.test(value.trim())) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }
  return typeof value === "number" && excelSerialToISO(value) !== null;
}

function castValue(raw: RawValue, type: ColumnType): string | number | boolean | null {
  if (type === "phone") return cleanPhone(raw);
  if (type === "integer") return castInteger(raw);
  if (type === "decimal") return parseLooseNumber(raw);
  if (type === "date") return castDate(raw);
  if (type === "email") {
    const text = textFromRaw(raw);
    return text ? text.toLowerCase() : null;
  }
  if (type === "yesno") return castYesNo(raw);
  return textFromRaw(raw);
}

function castInteger(raw: RawValue): number | null {
  const value = parseLooseNumber(raw);
  if (value === null) return null;
  return Math.round(value);
}

function castDate(raw: RawValue): string | null {
  if (typeof raw === "number") return excelSerialToISO(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^na$/i.test(trimmed)) return "NA";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return cleanLabel(trimmed);
  const date = new Date(parsed);
  const zoned = trimmed.includes("T") || /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (zoned) return excelDateToISO(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function castYesNo(raw: RawValue): string | null {
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") {
    if (raw === 1) return "Yes";
    if (raw === 0) return "No";
  }
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (["yes", "y", "true"].includes(lower)) return "Yes";
  if (["no", "n", "false"].includes(lower)) return "No";
  return textFromRaw(raw);
}

function cleanPhone(raw: RawValue): string | null {
  if (typeof raw === "number") {
    const text = plainIntegerString(raw);
    return text || null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[,\s]/g, "");
  if (/^[+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(compact)) {
    const numeric = Number(compact.replace(/^\+/, ""));
    if (Number.isFinite(numeric)) {
      const digits = plainIntegerString(Math.abs(numeric));
      if (!digits) return null;
      return compact.startsWith("+") ? `+${digits}` : digits;
    }
  }
  return compact;
}

function textFromRaw(raw: RawValue): string | null {
  if (typeof raw === "number") {
    if (Number.isInteger(raw)) {
      const text = plainIntegerString(raw);
      return text || null;
    }
    const text = plainDecimalString(raw);
    return text || null;
  }
  if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const numeric = trimmed.replace(/,/g, "");
  if (/^[+]?\d+\.0+$/.test(numeric)) return numeric.replace(/\.0+$/, "").replace(/^\+/, "");
  if (/^[+]?\d{1,3}(,\d{3})+$/.test(trimmed)) return trimmed.replace(/,/g, "").replace(/^\+/, "");
  return trimmed;
}

function parseLooseNumber(raw: RawValue): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return null;
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function plainIntegerString(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Math.round(value).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}

function plainDecimalString(value: number): string {
  if (!Number.isFinite(value)) return "";
  const text = value.toString();
  if (!/[eE]/.test(text)) return text;
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < 20000 || whole > 80000) return null;
  return excelDateToISO(new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000));
}

function cellText(value: RawValue | null): string {
  if (value === null) return "";
  if (typeof value === "string") return cleanLabel(value);
  if (typeof value === "number") return cleanLabel(plainDecimalString(value));
  return value ? "TRUE" : "FALSE";
}

function countRow(grid: Grid, rowNumber: number, minCol: number, maxCol: number): number {
  const columns = grid.get(rowNumber);
  if (!columns) return 0;
  let count = 0;
  for (const col of columns.keys()) {
    if (col >= minCol && col <= maxCol) count += 1;
  }
  return count;
}

function mergesTouchRow(worksheet: Worksheet, rowNumber: number): boolean {
  const merges = worksheet.model.merges;
  if (!Array.isArray(merges)) return false;
  for (const range of merges) {
    const parsed = /^[A-Z]+(\d+):[A-Z]+(\d+)$/i.exec(range);
    if (!parsed?.[1] || !parsed[2]) continue;
    const top = Number(parsed[1]);
    const bottom = Number(parsed[2]);
    if (top <= rowNumber && rowNumber <= bottom) return true;
  }
  return false;
}

function uniqueKey(base: string, used: Set<string>): string {
  const root = base || "column";
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  let index = 2;
  while (used.has(`${root}_${index}`)) index += 1;
  const key = `${root}_${index}`;
  used.add(key);
  return key;
}

function readCell(cell: Cell): RawValue | null {
  if (cell.type === ValueType.Null || cell.type === ValueType.Merge || cell.type === ValueType.Error) return null;
  if (cell.type === ValueType.Date) {
    return cell.value instanceof Date && !Number.isNaN(cell.value.getTime()) ? excelDateToISO(cell.value) : null;
  }
  if (cell.type === ValueType.Formula) return fromUnknown(formulaResult(cell.value));
  if (cell.type === ValueType.RichText || cell.type === ValueType.Hyperlink || cell.type === ValueType.String || cell.type === ValueType.SharedString) {
    const text = cell.text.trim();
    return text || null;
  }
  if (cell.type === ValueType.Boolean) return typeof cell.value === "boolean" ? cell.value : null;
  if (cell.type === ValueType.Number && typeof cell.value === "number") {
    if (isDateNumFmt(cell.numFmt)) return excelSerialToISO(cell.value) ?? cell.value;
    return cell.value;
  }
  return fromUnknown(cell.value);
}

function formulaResult(value: Cell["value"]): unknown {
  if (!isRecord(value)) return value;
  if ("result" in value) return value.result;
  return null;
}

function fromUnknown(value: unknown): RawValue | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : excelDateToISO(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (isRecord(value)) {
    if ("error" in value) return null;
    if (Array.isArray(value.richText)) {
      const text = value.richText
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
      return text || null;
    }
    if (typeof value.hyperlink === "string") {
      if (typeof value.text === "string") {
        const trimmed = value.text.trim();
        return trimmed || null;
      }
      return fromUnknown(value.text);
    }
    if ("result" in value) return fromUnknown(value.result);
  }
  return null;
}

function isDateNumFmt(fmt: unknown): boolean {
  if (typeof fmt !== "string") return false;
  const lower = fmt.toLowerCase();
  if (lower.includes("general") || lower === "@") return false;
  return /[dy]/.test(lower) || /m{1,4}/.test(lower);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
