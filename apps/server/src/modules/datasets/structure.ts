import { randomUUID } from "node:crypto";
import type { ColumnType, DatasetColumn, DatasetGroup, DatasetSchema, PublicUser } from "@app/shared";
import {
  GROUP_TINTS,
  cleanLabel,
  groupKeyFromLabel,
  isServerManagedField,
  normalizeCellValue,
  normalizeGroupKey,
  parseDatasetSchema,
} from "@app/shared";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { enqueueOutbox } from "../notifications/outbox";
import { structurePhrase, type OutboxBody } from "../notifications/payload";
import { syncMirrorFields } from "./mirrors";
import { applySystemColumns } from "./systemColumns";

type ColumnInput = {
  label: string;
  groupId?: string;
  newGroup?: { label: string };
  type: ColumnType;
  options?: string[];
  afterKey?: string;
  beforeKey?: string;
};

type ColumnPatch = {
  label?: string;
  type?: ColumnType;
  groupId?: string;
  hidden?: boolean;
  width?: number;
};

type MoveColumnInput = {
  afterKey?: string;
  beforeKey?: string;
  groupId?: string;
};

export async function addColumn(actor: PublicUser, datasetId: string, input: ColumnInput): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "column.created", (schema) => {
    const label = cleanLabel(input.label);
    if (!label) throw new AppError("VALIDATION", 400, "Label is required.");
    assertUniqueLabel(schema, label);
    if (input.afterKey && input.beforeKey) throw new AppError("VALIDATION", 400, "Choose one place for the column.");
    if (input.groupId && input.newGroup) throw new AppError("VALIDATION", 400, "Choose an existing group or a new group.");
    const group = input.newGroup ? pushGroup(schema, input.newGroup.label) : requireGroup(schema, input.groupId);
    const used = new Set(schema.columns.map((column) => column.key));
    const key = uniqueSlug(normalizeGroupKey(label) || "column", used);
    const column: DatasetColumn = {
      key,
      label,
      originalLabel: label,
      autoNamed: false,
      groupId: group.id,
      order: schema.columns.length,
      type: input.type,
      semantic: null,
      system: isServerManagedField(key),
      width: 120,
      hidden: false,
      options: columnOptions(input.type, input.options),
      deletedAt: null,
      deletedByName: null,
    };
    const ordered = sortColumns(schema);
    const index = insertIndex(ordered, input.beforeKey, input.afterKey);
    ordered.splice(index, 0, column);
    schema.columns = ordered;
    return schema;
  });
}

export async function updateColumn(
  actor: PublicUser,
  datasetId: string,
  key: string,
  patch: ColumnPatch,
): Promise<DatasetSchema> {
  if (patch.label == null && patch.type == null && patch.groupId == null && patch.hidden == null && patch.width == null) {
    throw new AppError("VALIDATION", 400, "No changes.");
  }
  const actionId = randomUUID();
  const schema = await prisma.$transaction(
    async (tx) => {
      const current = await loadSchema(tx, datasetId);
      const column = activeColumn(current, key);
      if (patch.label != null) {
        const label = cleanLabel(patch.label);
        if (!label) throw new AppError("VALIDATION", 400, "Label is required.");
        assertUniqueLabel(current, label, column.key);
        column.label = label;
        column.autoNamed = false;
      }
      if (patch.groupId != null) column.groupId = requireGroup(current, patch.groupId).id;
      if (patch.hidden != null) column.hidden = patch.hidden;
      if (patch.width != null) column.width = Math.min(800, Math.max(40, patch.width));
      if (patch.type != null && patch.type !== column.type) {
        await convertColumnType(tx, datasetId, column, patch.type);
        column.type = patch.type;
        column.options = columnOptions(patch.type, column.options);
      }
      const next = applySystemColumns(reindex(current));
      await saveSchema(tx, datasetId, next);
      await writeActivity(tx, actor, datasetId, actionId, "column.updated", { key });
      await enqueueOutbox(tx, structureBody(actor, datasetId, "column.updated"), { actionId });
      return next;
    },
    { timeout: 120_000 },
  );
  emit(actor, datasetId, actionId, "column.updated");
  return schema;
}

export async function moveColumn(
  actor: PublicUser,
  datasetId: string,
  key: string,
  input: MoveColumnInput,
): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "column.moved", (schema) => {
    if (input.afterKey && input.beforeKey) throw new AppError("VALIDATION", 400, "Choose one place for the column.");
    const ordered = sortColumns(schema);
    const index = ordered.findIndex((column) => column.key === key && column.deletedAt == null);
    const column = ordered[index];
    if (!column || index < 0) throw new AppError("NOT_FOUND", 404, "Column not found.");
    if (input.groupId) column.groupId = requireGroup(schema, input.groupId).id;
    ordered.splice(index, 1);
    let target = ordered.length;
    if (input.beforeKey || input.afterKey) target = insertIndex(ordered, input.beforeKey, input.afterKey);
    else if (input.groupId) {
      let last = -1;
      ordered.forEach((item, itemIndex) => {
        if (item.groupId === column.groupId) last = itemIndex;
      });
      target = last >= 0 ? last + 1 : ordered.length;
    }
    ordered.splice(target, 0, column);
    schema.columns = ordered;
    return schema;
  });
}

export async function deleteColumn(actor: PublicUser, datasetId: string, key: string): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "column.deleted", (schema) => {
    const column = activeColumn(schema, key);
    if (column.system || isServerManagedField(column.key) || (column.semantic != null && isServerManagedField(column.semantic))) {
      throw new AppError("CONFLICT", 409, "System columns cannot be deleted.");
    }
    if (column.semantic) throw new AppError("CONFLICT", 409, "Semantic columns cannot be deleted.");
    column.deletedAt = new Date().toISOString();
    column.deletedByName = actor.name;
    return schema;
  });
}

export async function restoreColumn(actor: PublicUser, datasetId: string, key: string): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "column.restored", (schema) => {
    const column = schema.columns.find((item) => item.key === key);
    if (!column || column.deletedAt == null) throw new AppError("NOT_FOUND", 404, "Column not found.");
    column.deletedAt = null;
    column.deletedByName = null;
    const group = schema.groups.find((item) => item.id === column.groupId);
    if (group?.deletedAt) {
      group.deletedAt = null;
      group.deletedByName = null;
    }
    return schema;
  });
}

export async function addGroup(actor: PublicUser, datasetId: string, label: string): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "group.created", (schema) => {
    pushGroup(schema, label);
    return schema;
  });
}

export async function updateGroup(
  actor: PublicUser,
  datasetId: string,
  groupId: string,
  patch: { label?: string; tint?: string },
): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "group.updated", (schema) => {
    const group = requireGroup(schema, groupId);
    if (patch.label != null) {
      const label = cleanLabel(patch.label);
      if (!label) throw new AppError("VALIDATION", 400, "Label is required.");
      group.label = label;
    }
    if (patch.tint != null) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(patch.tint)) throw new AppError("VALIDATION", 400, "Tint must be a hex color.");
      group.tint = patch.tint;
    }
    return schema;
  });
}

export async function moveGroup(
  actor: PublicUser,
  datasetId: string,
  groupId: string,
  input: { afterGroupId?: string; beforeGroupId?: string },
): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "group.moved", (schema) => {
    if (input.afterGroupId && input.beforeGroupId) throw new AppError("VALIDATION", 400, "Choose one place for the group.");
    const ordered = [...schema.groups].sort((left, right) => left.order - right.order);
    const index = ordered.findIndex((group) => group.id === groupId && group.deletedAt == null);
    const group = ordered[index];
    if (!group || index < 0) throw new AppError("NOT_FOUND", 404, "Group not found.");
    ordered.splice(index, 1);
    const target = insertGroupIndex(ordered, input.beforeGroupId, input.afterGroupId);
    ordered.splice(target, 0, group);
    schema.groups = ordered;
    return schema;
  });
}

export async function deleteGroup(actor: PublicUser, datasetId: string, groupId: string): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "group.deleted", (schema) => {
    const group = requireGroup(schema, groupId);
    const stamp = new Date().toISOString();
    group.deletedAt = stamp;
    group.deletedByName = actor.name;
    for (const column of schema.columns) {
      if (column.groupId !== group.id || column.deletedAt) continue;
      if (column.system || column.semantic || isServerManagedField(column.key)) {
        throw new AppError("CONFLICT", 409, "This group contains columns that cannot be deleted.");
      }
      column.deletedAt = stamp;
      column.deletedByName = actor.name;
    }
    return schema;
  });
}

export async function restoreGroup(actor: PublicUser, datasetId: string, groupId: string): Promise<DatasetSchema> {
  return changeSchema(actor, datasetId, "group.restored", (schema) => {
    const group = schema.groups.find((item) => item.id === groupId);
    if (!group || group.deletedAt == null) throw new AppError("NOT_FOUND", 404, "Group not found.");
    group.deletedAt = null;
    group.deletedByName = null;
    for (const column of schema.columns) {
      if (column.groupId !== group.id) continue;
      column.deletedAt = null;
      column.deletedByName = null;
    }
    return schema;
  });
}

export async function softDeleteDataset(actor: PublicUser, datasetId: string): Promise<void> {
  const actionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await lockDataset(tx, datasetId);
    const current = await tx.dataset.findUnique({ where: { id: datasetId }, select: { name: true } });
    await tx.dataset.update({
      where: { id: datasetId },
      data: { deletedAt: new Date(), deletedById: actor.id },
    });
    await writeActivity(tx, actor, datasetId, actionId, "dataset.deleted", {});
    await enqueueOutbox(tx, structureBody(actor, datasetId, "dataset.deleted", current?.name), { actionId });
  });
  emit(actor, datasetId, actionId, "dataset.deleted");
}

async function changeSchema(
  actor: PublicUser,
  datasetId: string,
  action: string,
  mutate: (schema: DatasetSchema) => DatasetSchema,
): Promise<DatasetSchema> {
  const actionId = randomUUID();
  const schema = await prisma.$transaction(async (tx) => {
    const current = await loadSchema(tx, datasetId);
    const next = applySystemColumns(reindex(mutate(current)));
    await saveSchema(tx, datasetId, next);
    await writeActivity(tx, actor, datasetId, actionId, action, {});
    await enqueueOutbox(tx, structureBody(actor, datasetId, action), { actionId });
    return next;
  });
  emit(actor, datasetId, actionId, action);
  return schema;
}

export async function loadSchema(tx: Prisma.TransactionClient, datasetId: string): Promise<DatasetSchema> {
  await lockDataset(tx, datasetId);
  const dataset = await tx.dataset.findUnique({ where: { id: datasetId }, select: { schema: true } });
  const schema = parseDatasetSchema(dataset?.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  return schema;
}

export async function lockDataset(tx: Prisma.TransactionClient, datasetId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Dataset" WHERE id = ${datasetId}::uuid AND "deletedAt" IS NULL FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
}

async function saveSchema(tx: Prisma.TransactionClient, datasetId: string, schema: DatasetSchema): Promise<void> {
  await tx.dataset.update({
    where: { id: datasetId },
    data: { schema: schema as unknown as Prisma.InputJsonValue },
  });
}

async function convertColumnType(
  tx: Prisma.TransactionClient,
  datasetId: string,
  column: DatasetColumn,
  type: ColumnType,
): Promise<void> {
  const rows = await tx.row.findMany({ where: { datasetId }, select: { id: true, data: true } });
  const converted: Array<{ id: string; data: Record<string, unknown> }> = [];
  let unconvertible = 0;
  for (const row of rows) {
    const data = jsonRecord(row.data);
    const current = data[column.key];
    if (current == null || current === "") {
      converted.push({ id: row.id, data });
      continue;
    }
    const result = normalizeCellValue({ label: column.label, type }, current);
    if (!result.ok) {
      unconvertible += 1;
      continue;
    }
    if (result.value == null) delete data[column.key];
    else data[column.key] = result.value;
    converted.push({ id: row.id, data });
  }
  if (unconvertible > 0) {
    throw new AppError("VALIDATION", 400, `${unconvertible} values cannot be converted to ${type}.`, undefined, {
      unconvertible,
    });
  }
  const schema = await schemaForMirrors(tx, datasetId, column.key, type);
  for (const row of converted) {
    const synced = syncMirrorFields(row.data, schema);
    await tx.row.update({
      where: { id: row.id },
      data: {
        data: synced.data as Prisma.InputJsonValue,
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
}

async function schemaForMirrors(
  tx: Prisma.TransactionClient,
  datasetId: string,
  key: string,
  type: ColumnType,
): Promise<DatasetSchema> {
  const dataset = await tx.dataset.findUnique({ where: { id: datasetId }, select: { schema: true } });
  const schema = parseDatasetSchema(dataset?.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  return {
    ...schema,
    columns: schema.columns.map((column) => (column.key === key ? { ...column, type } : column)),
  };
}

function pushGroup(schema: DatasetSchema, rawLabel: string): DatasetGroup {
  const label = cleanLabel(rawLabel);
  if (!label) throw new AppError("VALIDATION", 400, "Label is required.");
  const used = new Set(schema.groups.map((group) => group.groupKey));
  const groupKey = uniqueSlug(groupKeyFromLabel(label), used);
  const tint = GROUP_TINTS[schema.groups.length % GROUP_TINTS.length] ?? GROUP_TINTS[0];
  const group: DatasetGroup = {
    id: randomUUID(),
    label,
    groupKey,
    order: schema.groups.length,
    tint,
    deletedAt: null,
    deletedByName: null,
  };
  schema.groups.push(group);
  return group;
}

function requireGroup(schema: DatasetSchema, groupId: string | undefined): DatasetGroup {
  const group = schema.groups.find((item) => item.id === groupId && item.deletedAt == null);
  if (!group) throw new AppError("VALIDATION", 400, "Group not found.");
  return group;
}

function activeColumn(schema: DatasetSchema, key: string): DatasetColumn {
  const column = schema.columns.find((item) => item.key === key && item.deletedAt == null);
  if (!column) throw new AppError("NOT_FOUND", 404, "Column not found.");
  return column;
}

function assertUniqueLabel(schema: DatasetSchema, label: string, exceptKey?: string): void {
  const needle = label.toLowerCase();
  const clash = schema.columns.find(
    (column) => column.deletedAt == null && column.key !== exceptKey && cleanLabel(column.label).toLowerCase() === needle,
  );
  if (clash) throw new AppError("VALIDATION", 400, `A column named "${label}" already exists.`);
}

function sortColumns(schema: DatasetSchema): DatasetColumn[] {
  return [...schema.columns].sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

function insertIndex(columns: DatasetColumn[], beforeKey?: string, afterKey?: string): number {
  if (beforeKey) {
    const index = columns.findIndex((column) => column.key === beforeKey);
    if (index < 0) throw new AppError("NOT_FOUND", 404, "Column not found.");
    return index;
  }
  if (afterKey) {
    const index = columns.findIndex((column) => column.key === afterKey);
    if (index < 0) throw new AppError("NOT_FOUND", 404, "Column not found.");
    return index + 1;
  }
  return columns.length;
}

function insertGroupIndex(groups: DatasetGroup[], beforeGroupId?: string, afterGroupId?: string): number {
  if (beforeGroupId) {
    const index = groups.findIndex((group) => group.id === beforeGroupId);
    if (index < 0) throw new AppError("NOT_FOUND", 404, "Group not found.");
    return index;
  }
  if (afterGroupId) {
    const index = groups.findIndex((group) => group.id === afterGroupId);
    if (index < 0) throw new AppError("NOT_FOUND", 404, "Group not found.");
    return index + 1;
  }
  return groups.length;
}

function reindex(schema: DatasetSchema): DatasetSchema {
  return {
    ...schema,
    groups: [...schema.groups]
      .sort((left, right) => left.order - right.order)
      .map((group, order) => ({ ...group, order })),
    columns: [...schema.columns]
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((column, order) => ({ ...column, order })),
  };
}

function uniqueSlug(base: string, used: Set<string>): string {
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

function columnOptions(type: ColumnType, options: string[] | undefined): string[] {
  if (type === "yesno") return options && options.length > 0 ? cleanOptions(options) : ["Yes", "No"];
  if (type === "status" || type === "category") return cleanOptions(options ?? []);
  return [];
}

function cleanOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const option of options) {
    const label = cleanLabel(option);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    next.push(label);
  }
  return next;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

async function writeActivity(
  tx: Prisma.TransactionClient,
  actor: PublicUser,
  datasetId: string,
  actionId: string,
  action: string,
  meta: Record<string, string>,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      datasetId,
      actorId: actor.id,
      actorName: actor.name,
      action,
      actionId,
      meta,
    },
  });
}

function structureBody(actor: PublicUser, datasetId: string, action: string, datasetName?: string): OutboxBody {
  const datasetLevel = action.startsWith("dataset.");
  return {
    kind: datasetLevel ? action : "structure",
    action,
    datasetId,
    datasetName,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    audience: datasetLevel ? "all" : "managers",
    summary: structurePhrase(action, datasetName),
  };
}

function emit(actor: PublicUser, datasetId: string, actionId: string, type: string): void {
  try {
    publishEvent({ type, datasetId, actorId: actor.id, actorName: actor.name, actionId });
  } catch (error) {
    logger.error({ err: error }, `Failed to publish ${type}`);
  }
}
