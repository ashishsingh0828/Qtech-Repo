import type { ColumnType, DatasetColumn } from "./datasetSchema";

const TEXT_CAP = 2000;
const SHORT_CAP = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const TEXT_SEARCH_TYPES = new Set<ColumnType>(["text", "email", "phone", "status", "category"]);

export type NormalizedCell = string | number | null;

export type NormalizeResult = { ok: true; value: NormalizedCell } | { ok: false; message: string };

export function normalizeCellValue(
  column: Pick<DatasetColumn, "label" | "type">,
  input: unknown,
): NormalizeResult {
  if (input == null) return { ok: true, value: null };
  if (typeof input === "string" && input.trim() === "") return { ok: true, value: null };
  const label = column.label || "column";
  switch (column.type) {
    case "integer":
      return parseInteger(input, label);
    case "decimal":
      return parseDecimal(input, label);
    case "date":
      return parseDate(input, label);
    case "phone":
      return parsePhone(input, label);
    case "email":
      return parseEmail(input, label);
    case "yesno":
      return parseYesNo(input, label);
    case "status":
    case "category":
      return parseCappedText(input, label, SHORT_CAP);
    case "text":
      return parseCappedText(input, label, TEXT_CAP);
    default:
      return parseCappedText(input, label, TEXT_CAP);
  }
}

function invalid(label: string): NormalizeResult {
  return { ok: false, message: `Invalid value for ${label}.` };
}

function asText(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  if (typeof input === "boolean") return input ? "true" : "false";
  return null;
}

function parseLoose(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/,/g, "");
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseInteger(input: unknown, label: string): NormalizeResult {
  const value = parseLoose(input);
  if (value === null || !Number.isInteger(value)) return invalid(label);
  return { ok: true, value };
}

function parseDecimal(input: unknown, label: string): NormalizeResult {
  const value = parseLoose(input);
  if (value === null) return invalid(label);
  return { ok: true, value };
}

function parseDate(input: unknown, label: string): NormalizeResult {
  if (typeof input !== "string" && typeof input !== "number") return invalid(label);
  const trimmed = String(input).trim();
  if (!trimmed) return { ok: true, value: null };
  if (/^na$/i.test(trimmed)) return { ok: true, value: "NA" };
  if (ISO_DATE.test(trimmed)) return { ok: true, value: trimmed };
  return invalid(label);
}

function parsePhone(input: unknown, label: string): NormalizeResult {
  const text = asText(input);
  if (text == null) return invalid(label);
  const digits = text.replace(/\D/g, "");
  if (!digits) return invalid(label);
  return { ok: true, value: digits };
}

function parseEmail(input: unknown, label: string): NormalizeResult {
  const text = asText(input);
  if (text == null) return invalid(label);
  const trimmed = text.trim();
  if (!EMAIL.test(trimmed)) return invalid(label);
  return { ok: true, value: trimmed };
}

function parseYesNo(input: unknown, label: string): NormalizeResult {
  if (typeof input === "boolean") return { ok: true, value: input ? "Yes" : "No" };
  if (typeof input === "number") {
    if (input === 1) return { ok: true, value: "Yes" };
    if (input === 0) return { ok: true, value: "No" };
    return invalid(label);
  }
  if (typeof input !== "string") return invalid(label);
  const lower = input.trim().toLowerCase();
  if (["yes", "y", "true"].includes(lower)) return { ok: true, value: "Yes" };
  if (["no", "n", "false"].includes(lower)) return { ok: true, value: "No" };
  return invalid(label);
}

function parseCappedText(input: unknown, label: string, cap: number): NormalizeResult {
  const text = asText(input);
  if (text == null) return invalid(label);
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > cap) return invalid(label);
  return { ok: true, value: trimmed };
}
