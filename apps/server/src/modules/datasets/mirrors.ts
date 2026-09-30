import type { DatasetColumn, DatasetSchema } from "@app/shared";
import { nextDuePmsDate, readField } from "@app/shared";
import { contractDays } from "@app/shared";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MirrorFields = {
  data: Record<string, string | number | boolean>;
  validated: string | null;
  validationDue: Date | null;
  verified: string | null;
  endDate: Date | null;
  amcStatus: string | null;
  nextFollowUp: Date | null;
  nextDuePms: Date | null;
};

export function syncMirrorFields(data: Record<string, unknown>, schema: DatasetSchema): MirrorFields {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") next[key] = value;
  }
  const days = contractDays(isoField(next, schema.columns, "start_date"), isoField(next, schema.columns, "end_date"));
  writeDerived(next, schema.columns, "days", days);
  const dueSource: Record<string, unknown> = { ...next };
  for (const [key, value] of Object.entries(dueSource)) {
    if (key.startsWith("pm_date:") && value === "NA") delete dueSource[key];
  }
  writeDerived(next, schema.columns, "next_due_pms", nextDuePmsDate(dueSource));
  return {
    data: next,
    validated: textOrNull(readField(next, schema.columns, "validated")),
    validationDue: dateOrNull(readField(next, schema.columns, "validation_due")),
    verified: textOrNull(readField(next, schema.columns, "verified")),
    endDate: dateOrNull(readField(next, schema.columns, "end_date")),
    amcStatus: textOrNull(readField(next, schema.columns, "amc_status")),
    nextFollowUp: dateOrNull(readField(next, schema.columns, "next_follow_up")),
    nextDuePms: dateOrNull(readField(next, schema.columns, "next_due_pms")),
  };
}

function writeDerived(
  data: Record<string, string | number | boolean>,
  columns: readonly DatasetColumn[],
  semantic: string,
  value: string | number | null,
): void {
  const column = columns.find((item) => item.deletedAt == null && (item.semantic === semantic || item.key === semantic));
  if (!column) return;
  if (value == null) delete data[column.key];
  else data[column.key] = value;
}

function isoField(data: Record<string, unknown>, columns: readonly DatasetColumn[], semantic: string): string | null {
  const value = readField(data, columns, semantic);
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}
