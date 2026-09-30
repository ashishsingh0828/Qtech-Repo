import { randomBytes, randomUUID } from "node:crypto";
import type { DatasetColumn, DatasetSchema, PublicUser, StoredCell } from "@app/shared";
import { cleanLabel, isServerManagedField, normalizeGroupKey, parseDatasetSchema } from "@app/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { syncMirrorFields } from "./mirrors";
import { parseWorkbook } from "./parse";
import { lockDataset } from "./structure";
import { applySystemColumns } from "./systemColumns";

const PREVIEW_TTL_MS = 15 * 60 * 1000;

export type MergeChange = {
  rowIdentifier: string;
  columnLabel: string;
  from: StoredCell;
  to: StoredCell;
};

export type MergePreview = {
  token: string;
  newRows: number;
  updatedRows: number;
  skippedRows: number;
  changes: MergeChange[];
  duplicates: string[];
  ignoredColumns: string[];
  blankSerials: number;
};

type Plan = {
  datasetId: string;
  expiresAt: number;
  updates: Array<{ rowId: string; changes: Record<string, string | number | boolean | null> }>;
  inserts: Array<Record<string, string | number | boolean | null>>;
  preview: MergePreview;
};

const cache = new Map<string, Plan>();

export async function previewMerge(
  actor: PublicUser,
  datasetId: string,
  file: { originalname: string; buffer: Buffer },
): Promise<MergePreview> {
  void actor;
  if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
    throw new AppError("VALIDATION", 400, "Please save the file as .xlsx");
  }
  sweep();
  const dataset = await prisma.dataset.findFirst({ where: { id: datasetId, deletedAt: null } });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  let parsed: Awaited<ReturnType<typeof parseWorkbook>>;
  try {
    parsed = await parseWorkbook(file.buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ err: error }, "Failed to read merge workbook");
    throw new AppError("VALIDATION", 400, "The file could not be read. Please save it as .xlsx.");
  }

  const rows = await prisma.row.findMany({
    where: { datasetId, deletedAt: null },
    select: { id: true, data: true },
  });
  const plan = buildPlan(datasetId, schema, rows, parsed.schema, parsed.rows);
  cache.set(plan.preview.token, plan);
  return plan.preview;
}

export async function confirmMerge(actor: PublicUser, datasetId: string, token: string): Promise<MergePreview> {
  sweep();
  const plan = cache.get(token);
  if (!plan || plan.expiresAt <= Date.now() || plan.datasetId !== datasetId) {
    cache.delete(token);
    throw new AppError("VALIDATION", 400, "This preview expired. Upload the file again.");
  }
  const actionId = randomUUID();
  await prisma.$transaction(
    async (tx) => {
      await lockDataset(tx, datasetId);
      const dataset = await tx.dataset.findUnique({ where: { id: datasetId }, select: { schema: true } });
      const parsedSchema = parseDatasetSchema(dataset?.schema);
      if (!parsedSchema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
      const schema = applySystemColumns(parsedSchema);
      await tx.dataset.update({
        where: { id: datasetId },
        data: { schema: schema as unknown as Prisma.InputJsonValue },
      });
      for (const update of plan.updates) {
        const row = await tx.row.findFirst({ where: { id: update.rowId, datasetId, deletedAt: null } });
        if (!row) continue;
        const data = jsonRecord(row.data);
        let changed = false;
        for (const [key, value] of Object.entries(update.changes)) {
          if (isServerManagedField(key)) continue;
          const column = schema.columns.find((item) => item.key === key && item.deletedAt == null);
          if (!column || column.system || (column.semantic != null && isServerManagedField(column.semantic))) continue;
          if (sameValue(data[key], value)) continue;
          if (value == null) delete data[key];
          else data[key] = value;
          changed = true;
          await tx.activityLog.create({
            data: {
              datasetId,
              rowId: row.id,
              actorId: actor.id,
              actorName: actor.name,
              action: "cell.updated",
              actionId,
              columnKey: key,
              groupKey: schema.groups.find((group) => group.id === column.groupId)?.groupKey ?? "",
              fromValue: jsonInput(rowValue(row.data, key)),
              toValue: jsonInput(value),
            },
          });
        }
        if (!changed) continue;
        const synced = syncMirrorFields(data, schema);
        await tx.row.update({
          where: { id: row.id },
          data: {
            data: synced.data as Prisma.InputJsonValue,
            version: { increment: 1 },
            updatedById: actor.id,
            updatedByName: actor.name,
            validated: synced.validated,
            validationDue: synced.validationDue,
            verified: synced.verified,
            endDate: synced.endDate,
            amcStatus: synced.amcStatus,
            nextFollowUp: synced.nextFollowUp,
            nextDuePms: synced.nextDuePms,
          },
        });
      }
      const last = await tx.row.findFirst({
        where: { datasetId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      let position = (last?.position ?? 0) + 1;
      for (const data of plan.inserts) {
        const synced = syncMirrorFields(data, schema);
        const created = await tx.row.create({
          data: {
            datasetId,
            position,
            data: synced.data as Prisma.InputJsonValue,
            updatedById: actor.id,
            updatedByName: actor.name,
            validated: synced.validated,
            validationDue: synced.validationDue,
            verified: synced.verified,
            endDate: synced.endDate,
            amcStatus: synced.amcStatus,
            nextFollowUp: synced.nextFollowUp,
            nextDuePms: synced.nextDuePms,
          },
        });
        position += 1;
        await tx.activityLog.create({
          data: {
            datasetId,
            rowId: created.id,
            actorId: actor.id,
            actorName: actor.name,
            action: "row.created",
            actionId,
            meta: { source: "merge" },
          },
        });
      }
      const rowCount = await tx.row.count({ where: { datasetId, deletedAt: null } });
      await tx.dataset.update({ where: { id: datasetId }, data: { rowCount } });
      await tx.activityLog.create({
        data: {
          datasetId,
          actorId: actor.id,
          actorName: actor.name,
          action: "dataset.merged",
          actionId,
          meta: {
            newRows: plan.preview.newRows,
            updatedRows: plan.preview.updatedRows,
          },
        },
      });
    },
    { timeout: 120_000 },
  );
  cache.delete(token);
  try {
    publishEvent({ type: "dataset.merged", datasetId, actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, "Failed to publish dataset.merged");
  }
  return plan.preview;
}

function buildPlan(
  datasetId: string,
  schema: DatasetSchema,
  storedRows: Array<{ id: string; data: Prisma.JsonValue }>,
  fileSchema: DatasetSchema,
  fileRows: Array<Record<string, string | number | boolean>>,
): Plan {
  const schemaByMatch = new Map<string, DatasetColumn>();
  for (const column of schema.columns) {
    if (column.deletedAt || protectedColumn(column)) continue;
    const group = schema.groups.find((item) => item.id === column.groupId && item.deletedAt == null);
    if (!group) continue;
    schemaByMatch.set(matchKey(group.groupKey, column.label), column);
  }
  const fileToSchema = new Map<string, DatasetColumn>();
  const ignored: string[] = [];
  for (const column of fileSchema.columns) {
    const group = fileSchema.groups.find((item) => item.id === column.groupId);
    const target = group ? schemaByMatch.get(matchKey(group.groupKey, column.label)) : undefined;
    if (!target) ignored.push(column.label);
    else fileToSchema.set(column.key, target);
  }
  const serialFile = fileSchema.columns.find((column) => isSerial(column));
  const customerFile = fileSchema.columns.find((column) => isCustomer(column));
  const serialSchema = schema.columns.find((column) => column.deletedAt == null && isSerial(column));
  const customerSchema = schema.columns.find((column) => column.deletedAt == null && isCustomer(column));
  const dbBuckets = new Map<string, string[]>();
  for (const row of storedRows) {
    const data = jsonRecord(row.data);
    const key = identity(textValue(data[serialSchema?.key ?? ""]), textValue(data[customerSchema?.key ?? ""]));
    const list = dbBuckets.get(key) ?? [];
    list.push(row.id);
    dbBuckets.set(key, list);
  }
  const fileBuckets = new Map<string, number>();
  const fileKeys = fileRows.map((row) => {
    const serial = serialFile ? textValue(row[serialFile.key]) : "";
    const customer = customerFile ? textValue(row[customerFile.key]) : "";
    const key = serial ? identity(serial, customer) : "";
    if (key) fileBuckets.set(key, (fileBuckets.get(key) ?? 0) + 1);
    return key;
  });

  const updates: Plan["updates"] = [];
  const inserts: Plan["inserts"] = [];
  const changes: MergeChange[] = [];
  const duplicates = new Set<string>();
  let newRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  let blankSerials = 0;

  fileRows.forEach((row, index) => {
    const serial = serialFile ? textValue(row[serialFile.key]) : "";
    const customer = customerFile ? textValue(row[customerFile.key]) : "";
    const identifier = serial ? `${serial} · ${customer || "Unknown customer"}` : `Blank serial · ${customer || `row ${index + 1}`}`;
    if (!serial) {
      blankSerials += 1;
      newRows += 1;
      inserts.push(mappedData(row, fileToSchema));
      return;
    }
    const dbIds = dbBuckets.get(fileKeys[index] ?? "") ?? [];
    const fileCount = fileBuckets.get(fileKeys[index] ?? "") ?? 0;
    if (dbIds.length !== 1 || fileCount > 1) {
      if (dbIds.length > 0) {
        skippedRows += 1;
        duplicates.add(identifier);
        return;
      }
      newRows += 1;
      inserts.push(mappedData(row, fileToSchema));
      return;
    }
    const dbId = dbIds[0];
    if (!dbId) return;
    const stored = storedRows.find((item) => item.id === dbId);
    const data = jsonRecord(stored?.data);
    const changesForRow: Record<string, string | number | boolean | null> = {};
    for (const [fileKey, column] of fileToSchema) {
      const next = row[fileKey];
      if (next == null) continue;
      if (sameValue(data[column.key], next)) continue;
      changesForRow[column.key] = next;
      if (changes.length < 10) {
        changes.push({
          rowIdentifier: identifier,
          columnLabel: column.label,
          from: storedCell(data[column.key]),
          to: storedCell(next),
        });
      }
    }
    if (Object.keys(changesForRow).length === 0) return;
    updatedRows += 1;
    updates.push({ rowId: dbId, changes: changesForRow });
  });

  return {
    datasetId,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    updates,
    inserts,
    preview: {
      token: randomBytes(24).toString("hex"),
      newRows,
      updatedRows,
      skippedRows,
      changes,
      duplicates: [...duplicates],
      ignoredColumns: [...new Set(ignored)],
      blankSerials,
    },
  };
}

function mappedData(
  row: Record<string, string | number | boolean>,
  fileToSchema: Map<string, DatasetColumn>,
): Record<string, string | number | boolean | null> {
  const data: Record<string, string | number | boolean | null> = {};
  for (const [fileKey, column] of fileToSchema) {
    const value = row[fileKey];
    if (value == null) continue;
    data[column.key] = value;
  }
  return data;
}

function matchKey(groupKey: string, label: string): string {
  return `${groupKey}\u0000${normalizeGroupKey(cleanLabel(label))}`;
}

function identity(serial: string, customer: string): string {
  return `${normalizeMatch(serial)}\u0000${normalizeMatch(customer)}`;
}

function normalizeMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isSerial(column: { key: string; semantic: string | null; label: string }): boolean {
  if (column.semantic === "serial" || column.key === "serial") return true;
  const normalized = normalizeGroupKey(column.label);
  return normalized === "serial" || normalized === "serial_no" || normalized === "serial_number";
}

function isCustomer(column: { key: string; semantic: string | null; label: string }): boolean {
  if (column.semantic === "customer_name" || column.key === "customer_name") return true;
  return normalizeGroupKey(column.label) === "customer_name";
}

function protectedColumn(column: DatasetColumn): boolean {
  return column.system || isServerManagedField(column.key) || (column.semantic != null && isServerManagedField(column.semantic));
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left == null || left === "") return right == null || right === "";
  if (typeof left === "number" && typeof right === "number") return left === right;
  return String(left) === String(right);
}

function storedCell(value: unknown): StoredCell {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function rowValue(data: Prisma.JsonValue, key: string): StoredCell {
  return storedCell(jsonRecord(data)[key]);
}

function jsonInput(value: StoredCell): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sweep(): void {
  const now = Date.now();
  for (const [token, plan] of cache) {
    if (plan.expiresAt <= now) cache.delete(token);
  }
}
