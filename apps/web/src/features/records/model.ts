import type { DatasetColumn, DatasetGroup, DatasetSchema, RowProjection, StoredCell } from "@app/shared";
import { normalizeGroupKey } from "@app/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type ColumnFilter =
  | { kind: "contains"; text: string }
  | { kind: "dates"; from: string; to: string }
  | { kind: "values"; selected: string[] };

export type SortState = { key: string; direction: "asc" | "desc" } | null;

export function formatGridDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return value;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${match[3]}-${month}-${match[1]}`;
}

export function displayText(column: DatasetColumn, value: StoredCell | undefined): string {
  if (value == null || value === "") return "";
  if (column.type === "date" && typeof value === "string") {
    if (/^na$/i.test(value)) return "NA";
    return formatGridDate(value);
  }
  if ((column.type === "integer" || column.key === "days" || column.semantic === "days") && typeof value === "number") {
    return String(Math.trunc(value));
  }
  if ((column.type === "decimal" || column.semantic === "total_pms") && typeof value === "number") {
    return value.toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

export function editText(column: DatasetColumn, value: StoredCell | undefined): string {
  if (value == null) return "";
  if ((column.type === "integer" || column.type === "decimal") && typeof value === "number") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

export function statusTone(value: string): "ruby" | "emerald" | "amber" | "sapphire" | "stone" {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const has = (words: string[]) => words.some((word) => tokens.includes(word));
  if (has(["expired", "overdue", "rejected", "no"])) return "ruby";
  if (has(["active", "ok", "yes", "verified"])) return "emerald";
  if (has(["pending", "due"])) return "amber";
  if (has(["warranty", "info"])) return "sapphire";
  return "stone";
}

export function isCustomerName(column: DatasetColumn): boolean {
  return (
    column.key === "customer_name" ||
    column.semantic === "customer_name" ||
    normalizeGroupKey(column.label) === "customer_name"
  );
}

export function defaultHidden(schema: DatasetSchema): string[] {
  return schema.columns.filter((column) => column.hidden).map((column) => column.key);
}

export function layoutColumns(
  schema: DatasetSchema,
  activeGroupId: string,
  advanced: boolean,
  hidden: ReadonlySet<string>,
): { pinned: DatasetColumn[]; scroll: DatasetColumn[] } {
  const shown = schema.columns.filter((column) => !hidden.has(column.key));
  const customer = shown.find(isCustomerName);
  const pinned = customer ? shown.slice(0, shown.findIndex((column) => column.key === customer.key) + 1) : [];
  const pinnedKeys = new Set(pinned.map((column) => column.key));
  const pool = advanced ? shown : shown.filter((column) => column.groupId === activeGroupId);
  return { pinned, scroll: pool.filter((column) => !pinnedKeys.has(column.key)) };
}

export function applyView(
  rows: RowProjection[],
  columns: DatasetColumn[],
  filters: Record<string, ColumnFilter>,
  sort: SortState,
  search: string,
  recentOnly: boolean,
  recentSince: number,
): RowProjection[] {
  const needle = search.trim().toLowerCase();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  let next = rows.filter((row) => {
    if (recentOnly && new Date(row.updatedAt).getTime() < recentSince) return false;
    if (needle && !columns.some((column) => displayText(column, row.values[column.key]).toLowerCase().includes(needle))) {
      return false;
    }
    return Object.entries(filters).every(([key, filter]) => {
      const column = byKey.get(key);
      if (!column) return true;
      return matchesFilter(column, row.values[key], filter);
    });
  });
  if (sort) {
    const column = byKey.get(sort.key);
    if (column) {
      const direction = sort.direction === "asc" ? 1 : -1;
      next = [...next].sort((left, right) => direction * compareCells(left.values[sort.key], right.values[sort.key], column));
    }
  }
  return next;
}

export function distinctCounts(rows: RowProjection[], column: DatasetColumn): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = displayText(column, row.values[column.key]) || "(Blank)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

export function bannerSegments(columns: DatasetColumn[], groups: DatasetGroup[]): Array<{ label: string; tint: string; span: number }> {
  const segments: Array<{ label: string; tint: string; span: number; id: string }> = [];
  for (const column of columns) {
    const group = groups.find((item) => item.id === column.groupId);
    const last = segments[segments.length - 1];
    if (last && last.id === column.groupId) last.span += 1;
    else segments.push({ id: column.groupId, label: group?.label ?? "General", tint: group?.tint ?? "#F1EEE8", span: 1 });
  }
  return segments.map(({ label, tint, span }) => ({ label, tint, span }));
}

function matchesFilter(column: DatasetColumn, value: StoredCell | undefined, filter: ColumnFilter): boolean {
  if (filter.kind === "contains") {
    const needle = filter.text.trim().toLowerCase();
    if (!needle) return true;
    return displayText(column, value).toLowerCase().includes(needle);
  }
  if (filter.kind === "dates") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (filter.from && value < filter.from) return false;
    if (filter.to && value > filter.to) return false;
    return true;
  }
  const label = displayText(column, value) || "(Blank)";
  return filter.selected.includes(label);
}

function compareCells(left: StoredCell | undefined, right: StoredCell | undefined, column: DatasetColumn): number {
  if (column.type === "integer" || column.type === "decimal") {
    const a = typeof left === "number" ? left : null;
    const b = typeof right === "number" ? right : null;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  }
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}
