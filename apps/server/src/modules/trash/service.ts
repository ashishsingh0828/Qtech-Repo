import { randomUUID } from "node:crypto";
import type { DatasetSchema, PublicUser } from "@app/shared";
import { TRASH_RETENTION_DAYS, isServerManagedField, parseDatasetSchema } from "@app/shared";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { syncMirrorFields } from "../datasets/mirrors";
import { restoreColumn, restoreGroup } from "../datasets/structure";
import { enqueueOutbox } from "../notifications/outbox";
import { structurePhrase } from "../notifications/payload";

export type TrashKind = "datasets" | "rows" | "columns" | "groups";

export type TrashItem = {
  id: string;
  kind: TrashKind;
  name: string;
  datasetName: string;
  datasetId: string | null;
  deletedByName: string;
  deletedAt: string;
  daysLeft: number;
};

export async function listTrash(type: "datasets" | "rows" | "columns"): Promise<TrashItem[]> {
  if (type === "datasets") return listDatasets();
  if (type === "rows") return listRows();
  const [columns, groups] = await Promise.all([listColumns(), listGroups()]);
  return [...groups, ...columns].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

export async function restoreTrash(actor: PublicUser, input: {
  kind: TrashKind;
  datasetId?: string;
  id?: string;
  key?: string;
  ids?: string[];
}): Promise<{ restored: number }> {
  const ids = input.ids && input.ids.length > 0 ? input.ids : input.id ? [input.id] : input.key ? [input.key] : [];
  if (ids.length === 0) throw new AppError("VALIDATION", 400, "Choose an item to restore.");
  let restored = 0;
  for (const id of ids) {
    if (input.kind === "datasets") {
      await restoreDataset(actor, id);
      restored += 1;
    } else if (input.kind === "rows") {
      await restoreDeletedRow(actor, id);
      restored += 1;
    } else if (input.kind === "columns") {
      const target = splitId(id, input.datasetId, input.key);
      await restoreColumn(actor, target.datasetId, target.rest);
      restored += 1;
    } else {
      const target = splitId(id, input.datasetId, input.id);
      await restoreGroup(actor, target.datasetId, target.rest);
      restored += 1;
    }
  }
  return { restored };
}

export async function purgeTrash(actor: PublicUser, kind: TrashKind, id: string): Promise<void> {
  if (kind === "datasets") {
    await purgeDataset(actor, id);
    return;
  }
  if (kind === "rows") {
    await purgeRow(actor, id);
    return;
  }
  const target = splitId(id);
  if (kind === "columns") await purgeColumn(actor, target.datasetId, target.rest);
  else await purgeGroup(actor, target.datasetId, target.rest);
}

async function listDatasets(): Promise<TrashItem[]> {
  const datasets = await prisma.dataset.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
  const names = await namesFor(datasets.map((dataset) => dataset.deletedById));
  return datasets.flatMap((dataset) => {
    if (!dataset.deletedAt) return [];
    return [
      {
        id: dataset.id,
        kind: "datasets" as const,
        name: dataset.name,
        datasetName: dataset.name,
        datasetId: dataset.id,
        deletedByName: names.get(dataset.deletedById ?? "") ?? "Unknown",
        deletedAt: dataset.deletedAt.toISOString(),
        daysLeft: daysLeft(dataset.deletedAt),
      },
    ];
  });
}

async function listRows(): Promise<TrashItem[]> {
  const rows = await prisma.row.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    include: { dataset: { select: { name: true } } },
  });
  const names = await namesFor(rows.map((row) => row.deletedById));
  return rows.flatMap((row) => {
    if (!row.deletedAt) return [];
    return [
      {
        id: row.id,
        kind: "rows" as const,
        name: rowName(row.data, row.position),
        datasetName: row.dataset.name,
        datasetId: row.datasetId,
        deletedByName: names.get(row.deletedById ?? "") ?? "Unknown",
        deletedAt: row.deletedAt.toISOString(),
        daysLeft: daysLeft(row.deletedAt),
      },
    ];
  });
}

async function listColumns(): Promise<TrashItem[]> {
  const datasets = await prisma.dataset.findMany({ where: { deletedAt: null }, select: { id: true, name: true, schema: true } });
  const items: TrashItem[] = [];
  for (const dataset of datasets) {
    const schema = parseDatasetSchema(dataset.schema);
    if (!schema) continue;
    const deletedGroups = new Set(schema.groups.filter((group) => group.deletedAt).map((group) => group.id));
    for (const column of schema.columns) {
      if (!column.deletedAt || deletedGroups.has(column.groupId)) continue;
      items.push({
        id: composite(dataset.id, column.key),
        kind: "columns",
        name: column.label,
        datasetName: dataset.name,
        datasetId: dataset.id,
        deletedByName: column.deletedByName || "Unknown",
        deletedAt: column.deletedAt,
        daysLeft: daysLeft(new Date(column.deletedAt)),
      });
    }
  }
  return items;
}

async function listGroups(): Promise<TrashItem[]> {
  const datasets = await prisma.dataset.findMany({ where: { deletedAt: null }, select: { id: true, name: true, schema: true } });
  const items: TrashItem[] = [];
  for (const dataset of datasets) {
    const schema = parseDatasetSchema(dataset.schema);
    if (!schema) continue;
    for (const group of schema.groups) {
      if (!group.deletedAt) continue;
      const count = schema.columns.filter((column) => column.groupId === group.id).length;
      items.push({
        id: composite(dataset.id, group.id),
        kind: "groups",
        name: `Group ${group.label} (${count} columns)`,
        datasetName: dataset.name,
        datasetId: dataset.id,
        deletedByName: group.deletedByName || "Unknown",
        deletedAt: group.deletedAt,
        daysLeft: daysLeft(new Date(group.deletedAt)),
      });
    }
  }
  return items;
}

async function restoreDataset(actor: PublicUser, datasetId: string): Promise<void> {
  const actionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    const dataset = await tx.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset || !dataset.deletedAt) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
    await tx.dataset.update({ where: { id: datasetId }, data: { deletedAt: null, deletedById: null } });
    await tx.activityLog.create({
      data: {
        datasetId,
        actorId: actor.id,
        actorName: actor.name,
        action: "dataset.restored",
        actionId,
      },
    });
    await enqueueOutbox(
      tx,
      {
        kind: "dataset.restored",
        datasetId,
        datasetName: dataset.name,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        audience: "all",
        summary: structurePhrase("dataset.restored", dataset.name),
      },
      { actionId },
    );
  });
  emit(actor, datasetId, actionId, "dataset.restored");
}

async function restoreDeletedRow(actor: PublicUser, rowId: string): Promise<void> {
  const actionId = randomUUID();
  let datasetId = "";
  await prisma.$transaction(async (tx) => {
    const row = await tx.row.findUnique({ where: { id: rowId } });
    if (!row || !row.deletedAt) throw new AppError("NOT_FOUND", 404, "Row not found.");
    const dataset = await tx.dataset.findUnique({ where: { id: row.datasetId } });
    if (!dataset || dataset.deletedAt) throw new AppError("CONFLICT", 409, "Restore the dataset first.");
    datasetId = dataset.id;
    await tx.$queryRaw`SELECT id FROM "Dataset" WHERE id = ${dataset.id} FOR UPDATE`;
    const occupied = await tx.row.findFirst({
      where: { datasetId: dataset.id, deletedAt: null, position: row.position, id: { not: row.id } },
      select: { id: true },
    });
    let position = row.position;
    if (occupied) {
      const earlier = await tx.row.findFirst({
        where: { datasetId: dataset.id, deletedAt: null, position: { lt: row.position } },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      position = (earlier?.position ?? 0) + 1;
      await tx.row.updateMany({
        where: { datasetId: dataset.id, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
    }
    await tx.row.update({
      where: { id: row.id },
      data: { deletedAt: null, deletedById: null, position, updatedById: actor.id, updatedByName: actor.name },
    });
    const rowCount = await tx.row.count({ where: { datasetId: dataset.id, deletedAt: null } });
    await tx.dataset.update({ where: { id: dataset.id }, data: { rowCount } });
    await tx.activityLog.create({
      data: {
        datasetId: dataset.id,
        rowId: row.id,
        actorId: actor.id,
        actorName: actor.name,
        action: "row.restored",
        actionId,
      },
    });
    await enqueueOutbox(
      tx,
      {
        kind: "structure",
        action: "row.restored",
        datasetId: dataset.id,
        rowId: row.id,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        audience: "managers",
        summary: structurePhrase("row.restored"),
      },
      { actionId },
    );
  });
  emit(actor, datasetId, actionId, "row.restored");
}

async function purgeDataset(actor: PublicUser, datasetId: string): Promise<void> {
  const actionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    const dataset = await tx.dataset.findUnique({ where: { id: datasetId } });
    if (!dataset?.deletedAt) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
    await tx.serviceCall.deleteMany({ where: { datasetId } });
    await tx.activityLog.deleteMany({ where: { datasetId } });
    await tx.notification.deleteMany({ where: { datasetId } });
    await tx.$executeRaw`DELETE FROM "OutboxEvent" WHERE payload::text LIKE ${`%${datasetId}%`}`;
    await tx.row.deleteMany({ where: { datasetId } });
    await tx.dataset.delete({ where: { id: datasetId } });
    await enqueueOutbox(
      tx,
      {
        kind: "dataset.purged",
        datasetId,
        datasetName: dataset.name,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        audience: "all",
        summary: structurePhrase("dataset.purged", dataset.name),
      },
      { actionId },
    );
  });
  try {
    publishEvent({ type: "dataset.purged", datasetId, actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, "Failed to publish dataset.purged");
  }
}

async function purgeRow(actor: PublicUser, rowId: string): Promise<void> {
  const actionId = randomUUID();
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.row.findUnique({ where: { id: rowId } });
    if (!current?.deletedAt) throw new AppError("NOT_FOUND", 404, "Row not found.");
    await tx.row.delete({ where: { id: rowId } });
    const rowCount = await tx.row.count({ where: { datasetId: current.datasetId, deletedAt: null } });
    await tx.dataset.update({ where: { id: current.datasetId }, data: { rowCount } });
    await enqueueOutbox(
      tx,
      {
        kind: "structure",
        action: "row.purged",
        datasetId: current.datasetId,
        rowId,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        audience: "managers",
        summary: structurePhrase("row.purged"),
      },
      { actionId },
    );
    return current;
  });
  emit(actor, row.datasetId, actionId, "row.purged");
}

async function purgeColumn(actor: PublicUser, datasetId: string, key: string): Promise<void> {
  const actionId = randomUUID();
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Dataset" WHERE id = ${datasetId} AND "deletedAt" IS NULL FOR UPDATE`;
      const dataset = await tx.dataset.findUnique({ where: { id: datasetId } });
      const schema = parseDatasetSchema(dataset?.schema);
      if (!schema) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
      const column = schema.columns.find((item) => item.key === key);
      if (!column?.deletedAt) throw new AppError("NOT_FOUND", 404, "Column not found.");
      schema.columns = schema.columns.filter((item) => item.key !== key);
      await tx.dataset.update({ where: { id: datasetId }, data: { schema: reindex(schema) as unknown as Prisma.InputJsonValue } });
      await stripKeys(tx, datasetId, schema, [key]);
      await tx.activityLog.create({
        data: { datasetId, actorId: actor.id, actorName: actor.name, action: "column.purged", actionId, columnKey: key },
      });
      await enqueueOutbox(
        tx,
        {
          kind: "structure",
          action: "column.purged",
          datasetId,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          audience: "managers",
          summary: structurePhrase("column.purged"),
        },
        { actionId },
      );
    },
    { timeout: 120_000 },
  );
  emit(actor, datasetId, actionId, "column.purged");
}

async function purgeGroup(actor: PublicUser, datasetId: string, groupId: string): Promise<void> {
  const actionId = randomUUID();
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Dataset" WHERE id = ${datasetId} AND "deletedAt" IS NULL FOR UPDATE`;
      const dataset = await tx.dataset.findUnique({ where: { id: datasetId } });
      const schema = parseDatasetSchema(dataset?.schema);
      if (!schema) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
      const group = schema.groups.find((item) => item.id === groupId);
      if (!group?.deletedAt) throw new AppError("NOT_FOUND", 404, "Group not found.");
      const keys = schema.columns.filter((column) => column.groupId === groupId).map((column) => column.key);
      schema.groups = schema.groups.filter((item) => item.id !== groupId);
      schema.columns = schema.columns.filter((column) => column.groupId !== groupId);
      await tx.dataset.update({ where: { id: datasetId }, data: { schema: reindex(schema) as unknown as Prisma.InputJsonValue } });
      await stripKeys(tx, datasetId, schema, keys.filter((key) => !isServerManagedField(key)));
      await tx.activityLog.create({
        data: { datasetId, actorId: actor.id, actorName: actor.name, action: "group.purged", actionId, groupKey: group.groupKey },
      });
      await enqueueOutbox(
        tx,
        {
          kind: "structure",
          action: "group.purged",
          datasetId,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          audience: "managers",
          summary: structurePhrase("group.purged"),
        },
        { actionId },
      );
    },
    { timeout: 120_000 },
  );
  emit(actor, datasetId, actionId, "group.purged");
}

async function stripKeys(tx: Prisma.TransactionClient, datasetId: string, schema: DatasetSchema, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const rows = await tx.row.findMany({ where: { datasetId }, select: { id: true, data: true } });
  for (const row of rows) {
    const data = jsonRecord(row.data);
    let changed = false;
    for (const key of keys) {
      if (key in data) {
        delete data[key];
        changed = true;
      }
    }
    if (!changed) continue;
    const synced = syncMirrorFields(data, schema);
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

function reindex(schema: DatasetSchema): DatasetSchema {
  return {
    ...schema,
    groups: [...schema.groups].sort((left, right) => left.order - right.order).map((group, order) => ({ ...group, order })),
    columns: [...schema.columns]
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((column, order) => ({ ...column, order })),
  };
}

function composite(datasetId: string, rest: string): string {
  return `${datasetId}~${rest}`;
}

function splitId(id: string, datasetId?: string, rest?: string): { datasetId: string; rest: string } {
  if (datasetId && rest) return { datasetId, rest };
  const index = id.indexOf("~");
  if (index > 0) return { datasetId: id.slice(0, index), rest: id.slice(index + 1) };
  throw new AppError("VALIDATION", 400, "Trash item is invalid.");
}

function daysLeft(deletedAt: Date): number {
  const elapsed = Math.floor((Date.now() - deletedAt.getTime()) / 86_400_000);
  return Math.max(0, TRASH_RETENTION_DAYS - elapsed);
}

function rowName(data: Prisma.JsonValue, position: number): string {
  const record = jsonRecord(data);
  const customer = record.customer_name;
  if (typeof customer === "string" && customer.trim()) return customer.trim();
  return `Row ${position}`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function namesFor(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

function emit(actor: PublicUser, datasetId: string, actionId: string, type: string): void {
  try {
    publishEvent({ type, datasetId, actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, `Failed to publish ${type}`);
  }
}
