import { randomUUID } from "node:crypto";
import type { DatasetSchema, Permissions, PublicUser, RowProjection } from "@app/shared";
import {
  MAX_ROWS,
  RECENT_EDIT_HOURS,
  TEXT_SEARCH_TYPES,
  derivedDays,
  groupForColumn,
  isServerManagedField,
  liveColumn,
  normalizeCellValue,
  parseDatasetSchema,
  projectSchema,
  projectValues,
  storedCell,
  canEditGroup,
  type CellHistoryEntry,
  type DatasetDetail,
  type RecentEdit,
} from "@app/shared";
import { Prisma } from "@prisma/client";
import { permissionsFor } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { syncMirrorFields } from "./mirrors";

type RowRecord = {
  id: string;
  position: number;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
  data: Prisma.JsonValue;
};

export async function getDatasetDetail(actor: PublicUser, datasetId: string): Promise<DatasetDetail> {
  const { dataset, schema, permissions } = await loadContext(actor, datasetId);
  return {
    id: dataset.id,
    name: dataset.name,
    sourceFileName: dataset.sourceFileName,
    rowCount: dataset.rowCount,
    schema: projectSchema(schema, permissions.groupAccess),
  };
}

export async function listRows(
  actor: PublicUser,
  datasetId: string,
  query: { q?: string; limit?: number; offset?: number },
): Promise<{ total: number; rows: RowProjection[] }> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const projected = projectSchema(schema, permissions.groupAccess);
  const textKeys = projected.columns.filter((column) => TEXT_SEARCH_TYPES.has(column.type)).map((column) => column.key);
  const needle = query.q?.trim().toLowerCase() ?? "";
  const stored = await prisma.row.findMany({
    where: { datasetId, deletedAt: null },
    orderBy: { position: "asc" },
    take: MAX_ROWS,
    select: { id: true, position: true, version: true, updatedAt: true, updatedByName: true, data: true },
  });
  const matched = stored.filter((row) => (needle ? matchesText(jsonRecord(row.data), textKeys, needle) : true));
  const offset = query.offset ?? 0;
  const limit = query.limit ?? MAX_ROWS;
  const page = matched.slice(offset, offset + Math.min(limit, MAX_ROWS));
  return {
    total: matched.length,
    rows: page.map((row) => toProjection(row, projected.columns, schema)),
  };
}

export async function updateRow(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  version: number,
  changes: Record<string, unknown>,
): Promise<RowProjection> {
  if (Object.keys(changes).length === 0) {
    throw new AppError("VALIDATION", 400, "No changes.");
  }
  const { schema, permissions } = await loadContext(actor, datasetId);
  const prepared = prepareChanges(schema, permissions, changes);
  const actionId = randomUUID();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    const projected = projectSchema(schema, permissions.groupAccess);
    if (row.version !== version) {
      throw new AppError("CONFLICT", 409, "This row was updated by someone else.", undefined, {
        current: toProjection(row, projected.columns, schema),
      });
    }
    const current = jsonRecord(row.data);
    const changed = diffChanges(schema, current, prepared);
    if (changed.length === 0) return toProjection(row, projected.columns, schema);
    const next: Record<string, unknown> = { ...current };
    for (const change of changed) {
      if (change.to == null) delete next[change.key];
      else next[change.key] = change.to;
    }
    const synced = syncMirrorFields(next, schema);
    const saved = await tx.row.update({
      where: { id: row.id },
      data: {
        data: synced.data as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedById: actor.id,
        updatedByName: actor.name,
        ...mirrorData(synced),
      },
    });
    await tx.activityLog.createMany({
      data: changed.map((change) => ({
        datasetId,
        rowId: row.id,
        actorId: actor.id,
        actorName: actor.name,
        action: "cell.updated",
        actionId,
        columnKey: change.key,
        groupKey: change.groupKey,
        fromValue: jsonInput(change.from),
        toValue: jsonInput(change.to),
      })),
    });
    return { projection: toProjection(saved, projected.columns, schema), wrote: true };
  });
  if ("wrote" in updated && updated.wrote) {
    emit({ type: "row.updated", datasetId, rowId, actorId: actor.id, actionId });
    return updated.projection;
  }
  return updated as RowProjection;
}

export async function createRow(
  actor: PublicUser,
  datasetId: string,
  input: { afterRowId?: string; beforeRowId?: string; atEnd?: boolean; data?: Record<string, unknown> },
): Promise<{ row: RowProjection; rowCount: number }> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const prepared = input.data ? prepareChanges(schema, permissions, input.data) : {};
  const actionId = randomUUID();
  const created = await prisma.$transaction(
    async (tx) => {
      const position = await resolvePosition(tx, datasetId, input);
      await tx.row.updateMany({
        where: { datasetId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      const seeded = applyPrepared({}, prepared);
      const synced = syncMirrorFields(seeded, schema);
      const row = await tx.row.create({
        data: {
          datasetId,
          position,
          data: synced.data as Prisma.InputJsonValue,
          updatedById: actor.id,
          updatedByName: actor.name,
          ...mirrorData(synced),
        },
      });
      await tx.activityLog.create({
        data: {
          datasetId,
          rowId: row.id,
          actorId: actor.id,
          actorName: actor.name,
          action: "row.created",
          actionId,
        },
      });
      const rowCount = await tx.row.count({ where: { datasetId, deletedAt: null } });
      await tx.dataset.update({ where: { id: datasetId }, data: { rowCount } });
      return { row, rowCount };
    },
    { timeout: 30_000 },
  );
  emit({ type: "row.created", datasetId, rowId: created.row.id, actorId: actor.id, actionId });
  const projected = projectSchema(schema, permissions.groupAccess);
  return { row: toProjection(created.row, projected.columns, schema), rowCount: created.rowCount };
}

export async function duplicateRow(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
): Promise<{ row: RowProjection; rowCount: number }> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const actionId = randomUUID();
  const created = await prisma.$transaction(
    async (tx) => {
      const source = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
      if (!source) throw new AppError("NOT_FOUND", 404, "Row not found.");
      const position = source.position + 1;
      await tx.row.updateMany({
        where: { datasetId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      const synced = syncMirrorFields(jsonRecord(source.data), schema);
      const row = await tx.row.create({
        data: {
          datasetId,
          position,
          data: synced.data as Prisma.InputJsonValue,
          updatedById: actor.id,
          updatedByName: actor.name,
          ...mirrorData(synced),
        },
      });
      await tx.activityLog.create({
        data: {
          datasetId,
          rowId: row.id,
          actorId: actor.id,
          actorName: actor.name,
          action: "row.duplicated",
          actionId,
          meta: { sourceRowId: source.id },
        },
      });
      const rowCount = await tx.row.count({ where: { datasetId, deletedAt: null } });
      await tx.dataset.update({ where: { id: datasetId }, data: { rowCount } });
      return { row, rowCount };
    },
    { timeout: 30_000 },
  );
  emit({ type: "row.duplicated", datasetId, rowId: created.row.id, actorId: actor.id, actionId });
  const projected = projectSchema(schema, permissions.groupAccess);
  return { row: toProjection(created.row, projected.columns, schema), rowCount: created.rowCount };
}

export async function deleteRow(actor: PublicUser, datasetId: string, rowId: string): Promise<{ rowCount: number }> {
  await loadContext(actor, datasetId);
  const actionId = randomUUID();
  const rowCount = await prisma.$transaction(async (tx) => {
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    await tx.row.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.id },
    });
    await tx.activityLog.create({
      data: {
        datasetId,
        rowId: row.id,
        actorId: actor.id,
        actorName: actor.name,
        action: "row.deleted",
        actionId,
      },
    });
    const count = await tx.row.count({ where: { datasetId, deletedAt: null } });
    await tx.dataset.update({ where: { id: datasetId }, data: { rowCount: count } });
    return count;
  });
  emit({ type: "row.deleted", datasetId, rowId, actorId: actor.id, actionId });
  return { rowCount };
}

export async function restoreRow(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
): Promise<{ row: RowProjection; rowCount: number }> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const actionId = randomUUID();
  const restored = await prisma.$transaction(async (tx) => {
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    if (!row.deletedAt) throw new AppError("CONFLICT", 409, "This row is not in Trash.");
    const saved = await tx.row.update({
      where: { id: row.id },
      data: { deletedAt: null, deletedById: null, updatedById: actor.id, updatedByName: actor.name },
    });
    await tx.activityLog.create({
      data: {
        datasetId,
        rowId: row.id,
        actorId: actor.id,
        actorName: actor.name,
        action: "row.restored",
        actionId,
      },
    });
    const rowCount = await tx.row.count({ where: { datasetId, deletedAt: null } });
    await tx.dataset.update({ where: { id: datasetId }, data: { rowCount } });
    return { row: saved, rowCount };
  });
  emit({ type: "row.restored", datasetId, rowId, actorId: actor.id, actionId });
  const projected = projectSchema(schema, permissions.groupAccess);
  return { row: toProjection(restored.row, projected.columns, schema), rowCount: restored.rowCount };
}

export async function recentEdits(actor: PublicUser, datasetId: string): Promise<RecentEdit[]> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const projected = projectSchema(schema, permissions.groupAccess);
  const visible = new Set(projected.columns.map((column) => column.key));
  const since = new Date(Date.now() - RECENT_EDIT_HOURS * 60 * 60 * 1000);
  const logs = await prisma.activityLog.findMany({
    where: {
      datasetId,
      action: "cell.updated",
      columnKey: { not: null },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const edits: RecentEdit[] = [];
  for (const log of logs) {
    if (!log.rowId || !log.columnKey || !visible.has(log.columnKey)) continue;
    edits.push({
      rowId: log.rowId,
      columnKey: log.columnKey,
      byName: log.actorName,
      at: log.createdAt.toISOString(),
      from: storedCell(log.fromValue),
    });
  }
  return edits;
}

export async function cellHistory(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  columnKey: string,
): Promise<CellHistoryEntry[]> {
  const { schema, permissions } = await loadContext(actor, datasetId);
  const projected = projectSchema(schema, permissions.groupAccess);
  if (!projected.columns.some((column) => column.key === columnKey)) {
    throw new AppError("NOT_FOUND", 404, "Column not found.");
  }
  const row = await prisma.row.findFirst({ where: { id: rowId, datasetId }, select: { id: true } });
  if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
  const logs = await prisma.activityLog.findMany({
    where: { datasetId, rowId, columnKey, action: "cell.updated" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return logs.map((log) => ({
    who: log.actorName,
    when: log.createdAt.toISOString(),
    from: storedCell(log.fromValue),
    to: storedCell(log.toValue),
  }));
}

async function loadContext(actor: PublicUser, datasetId: string): Promise<{
  dataset: { id: string; name: string; sourceFileName: string; rowCount: number };
  schema: DatasetSchema;
  permissions: Permissions;
}> {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, deletedAt: null },
    select: { id: true, name: true, sourceFileName: true, rowCount: true, schema: true },
  });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  const permissions = await permissionsFor(actor.role);
  return { dataset, schema, permissions };
}

function prepareChanges(
  schema: DatasetSchema,
  permissions: Permissions,
  changes: Record<string, unknown>,
): Record<string, string | number | null> {
  const keys = Object.keys(changes);
  const unknown = keys.filter((key) => !liveColumn(schema, key));
  if (unknown.length > 0) {
    throw new AppError("VALIDATION", 400, `Unknown column ${unknown.map((key) => `"${key}"`).join(", ")}.`);
  }
  const blocked: string[] = [];
  let deniedEdit = false;
  for (const key of keys) {
    const column = liveColumn(schema, key);
    if (!column) continue;
    const group = groupForColumn(schema.groups, column);
    const managed =
      isServerManagedField(column.key) || (column.semantic != null && isServerManagedField(column.semantic));
    if (managed || !canEditGroup(permissions.groupAccess, group?.groupKey ?? "")) {
      blocked.push(key);
      if (!managed) deniedEdit = true;
    }
  }
  if (blocked.length > 0) {
    throw new AppError("FORBIDDEN", 403, "You cannot edit these fields.", undefined, {
      requiredPermission: deniedEdit ? "canEdit" : "server-managed",
      blockedFields: blocked,
    });
  }
  const normalized: Record<string, string | number | null> = {};
  for (const key of keys) {
    const column = liveColumn(schema, key);
    if (!column) continue;
    const result = normalizeCellValue(column, changes[key]);
    if (!result.ok) throw new AppError("VALIDATION", 400, result.message);
    normalized[key] = result.value;
  }
  return normalized;
}

function diffChanges(
  schema: DatasetSchema,
  current: Record<string, unknown>,
  prepared: Record<string, string | number | null>,
): Array<{ key: string; groupKey: string; from: ReturnType<typeof storedCell>; to: string | number | null }> {
  const changed: Array<{ key: string; groupKey: string; from: ReturnType<typeof storedCell>; to: string | number | null }> = [];
  for (const [key, value] of Object.entries(prepared)) {
    const column = liveColumn(schema, key);
    if (!column) continue;
    const from = storedCell(current[key]);
    const to = value;
    if (sameCell(from, to)) continue;
    changed.push({
      key,
      groupKey: groupForColumn(schema.groups, column)?.groupKey ?? "",
      from,
      to,
    });
  }
  return changed;
}

function applyPrepared(
  current: Record<string, unknown>,
  prepared: Record<string, string | number | null>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") next[key] = value;
  }
  for (const [key, value] of Object.entries(prepared)) {
    if (value == null) delete next[key];
    else next[key] = value;
  }
  return next;
}

function sameCell(from: ReturnType<typeof storedCell>, to: string | number | null): boolean {
  if (from == null && to == null) return true;
  return from === to;
}

function toProjection(row: RowRecord, columns: DatasetSchema["columns"], schema: DatasetSchema): RowProjection {
  const data = jsonRecord(row.data);
  return {
    id: row.id,
    position: row.position,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName ?? "",
    values: projectValues(data, columns),
    derived: { days: derivedDays(data, schema.columns) },
  };
}

function matchesText(data: Record<string, unknown>, keys: string[], needle: string): boolean {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function jsonRecord(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonInput(value: string | number | boolean | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value;
}

function mirrorData(synced: ReturnType<typeof syncMirrorFields>) {
  return {
    validated: synced.validated,
    validationDue: synced.validationDue,
    verified: synced.verified,
    endDate: synced.endDate,
    amcStatus: synced.amcStatus,
    nextFollowUp: synced.nextFollowUp,
    nextDuePms: synced.nextDuePms,
  };
}

async function resolvePosition(
  tx: Prisma.TransactionClient,
  datasetId: string,
  input: { afterRowId?: string; beforeRowId?: string; atEnd?: boolean },
): Promise<number> {
  const placements = [input.afterRowId, input.beforeRowId, input.atEnd ? "end" : undefined].filter(Boolean);
  if (placements.length > 1) throw new AppError("VALIDATION", 400, "Choose one place to insert the row.");
  if (input.beforeRowId) {
    const target = await tx.row.findFirst({ where: { id: input.beforeRowId, datasetId, deletedAt: null } });
    if (!target) throw new AppError("NOT_FOUND", 404, "Row not found.");
    return target.position;
  }
  if (input.afterRowId) {
    const target = await tx.row.findFirst({ where: { id: input.afterRowId, datasetId, deletedAt: null } });
    if (!target) throw new AppError("NOT_FOUND", 404, "Row not found.");
    return target.position + 1;
  }
  const last = await tx.row.findFirst({
    where: { datasetId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? 0) + 1;
}

function emit(event: { type: string; datasetId: string; rowId: string; actorId: string; actionId: string }): void {
  try {
    publishEvent(event);
  } catch (error) {
    logger.error({ err: error }, `Failed to publish ${event.type}`);
  }
}
