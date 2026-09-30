import { z } from "zod";

export const COLUMN_TYPES = [
  "text",
  "integer",
  "decimal",
  "date",
  "phone",
  "email",
  "status",
  "yesno",
  "category",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export const GROUP_TINTS = [
  "#F1EEE8",
  "#E9EFEA",
  "#E8EDF3",
  "#F3ECE3",
  "#EFE9EF",
  "#E6EFEE",
  "#F1EBE6",
  "#ECEBF3",
] as const;

export const datasetGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  groupKey: z.string().min(1),
  order: z.number().int(),
  tint: z.string().min(1),
  deletedAt: z.string().nullable(),
  deletedByName: z.string().nullable().optional(),
});

export const datasetColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  originalLabel: z.string(),
  autoNamed: z.boolean(),
  groupId: z.string().min(1),
  order: z.number().int(),
  type: z.enum(COLUMN_TYPES),
  semantic: z.string().nullable(),
  system: z.boolean(),
  width: z.number(),
  hidden: z.boolean(),
  options: z.array(z.string()),
  deletedAt: z.string().nullable(),
  deletedByName: z.string().nullable().optional(),
});

export const datasetSchemaSchema = z.object({
  version: z.literal(1),
  groups: z.array(datasetGroupSchema),
  columns: z.array(datasetColumnSchema),
});

export type DatasetGroup = z.infer<typeof datasetGroupSchema>;
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;
export type DatasetSchema = z.infer<typeof datasetSchemaSchema>;

export type DatasetSummary = {
  id: string;
  name: string;
  sourceFileName: string;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
  uploadedByName: string;
};

export function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/:+$/, "").trim();
}

export function autoNamePrefix(groupLabel: string): string {
  const cleaned = cleanLabel(groupLabel);
  const cut = cleaned.split(/[/(]/)[0] ?? cleaned;
  return cleanLabel(cut);
}

export function parseDatasetSchema(value: unknown): DatasetSchema | null {
  const parsed = datasetSchemaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
