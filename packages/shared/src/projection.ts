import { contractDays } from "./metrics";
import type { DatasetColumn, DatasetGroup, DatasetSchema } from "./datasetSchema";
import { canViewGroup, type Permissions } from "./permissions";

export type StoredCell = string | number | boolean | null;

export type RowProjection = {
  id: string;
  position: number;
  version: number;
  updatedAt: string;
  updatedByName: string;
  values: Record<string, StoredCell>;
  derived: { days: number | null };
};

export type RecentEdit = {
  rowId: string;
  columnKey: string;
  byName: string;
  at: string;
  from: StoredCell;
};

export type CellHistoryEntry = {
  who: string;
  when: string;
  from: StoredCell;
  to: StoredCell;
};

export type DatasetDetail = {
  id: string;
  name: string;
  sourceFileName: string;
  rowCount: number;
  schema: DatasetSchema;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function projectSchema(schema: DatasetSchema, groupAccess: Permissions["groupAccess"]): DatasetSchema {
  const groups = schema.groups
    .filter((group) => group.deletedAt == null && canViewGroup(groupAccess, group.groupKey))
    .sort((left, right) => left.order - right.order);
  const visible = new Set(groups.map((group) => group.id));
  const columns = schema.columns
    .filter((column) => column.deletedAt == null && visible.has(column.groupId))
    .sort((left, right) => left.order - right.order);
  return { version: 1, groups, columns };
}

export function projectValues(
  data: Record<string, unknown>,
  columns: readonly DatasetColumn[],
): Record<string, StoredCell> {
  const values: Record<string, StoredCell> = {};
  for (const column of columns) values[column.key] = storedCell(data[column.key]);
  return values;
}

export function derivedDays(data: Record<string, unknown>, columns: readonly DatasetColumn[]): number | null {
  return contractDays(isoField(data, columns, "start_date"), isoField(data, columns, "end_date"));
}

export function liveColumn(schema: DatasetSchema, key: string): DatasetColumn | undefined {
  const column = schema.columns.find((item) => item.key === key && item.deletedAt == null);
  if (!column) return undefined;
  const group = schema.groups.find((item) => item.id === column.groupId && item.deletedAt == null);
  if (!group) return undefined;
  return column;
}

export function groupForColumn(groups: readonly DatasetGroup[], column: DatasetColumn): DatasetGroup | undefined {
  return groups.find((group) => group.id === column.groupId && group.deletedAt == null);
}

export function readField(data: Record<string, unknown>, columns: readonly DatasetColumn[], semantic: string): unknown {
  const column = columns.find((item) => item.deletedAt == null && (item.semantic === semantic || item.key === semantic));
  if (!column) return undefined;
  return data[column.key];
}

function isoField(data: Record<string, unknown>, columns: readonly DatasetColumn[], semantic: string): string | null {
  const value = readField(data, columns, semantic);
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

export function storedCell(value: unknown): StoredCell {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}
