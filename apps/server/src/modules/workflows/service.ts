import { randomUUID } from "node:crypto";
import type { DatasetColumn, DatasetSchema, Permissions, PublicUser, QuickFilterKey } from "@app/shared";
import {
  UNDO_SECONDS,
  canEditGroup,
  canPerformAction,
  canViewGroup,
  effectiveAmcStatus,
  isWarrantyExpired,
  matchesQuickFilter,
  parseDatasetSchema,
  quickFiltersForRole,
  todayInTimeZone,
  excelDateToISO,
} from "@app/shared";
import { Prisma, type CallType } from "@prisma/client";
import { env } from "../../env";
import { permissionsFor } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { lockLiveRow } from "../../lib/locks";
import { syncMirrorFields, type MirrorExtras } from "../datasets/mirrors";

type ActionName = "validate" | "verify" | "amc" | "pms" | "followup" | "assign" | "calls";

const ACTION_GROUP: Record<ActionName, string | null> = {
  validate: "data_validation",
  verify: "data_validation",
  amc: "amc",
  pms: "schedule_services",
  followup: "follow_up",
  assign: null,
  calls: null,
};

export type ActionResult = { actionId: string; version: number };
export type BulkResult = { results: Array<{ rowId: string; ok: boolean; error?: string; actionId?: string }> };

export async function datasetSummary(actor: PublicUser, datasetId: string): Promise<{
  filters: Array<{ key: QuickFilterKey; label: string; count: number }>;
}> {
  const filters = quickFiltersForRole(actor.role);
  const rows = await prisma.row.findMany({
    where: { datasetId, deletedAt: null, dataset: { deletedAt: null } },
    select: snapshotSelect,
  });
  const today = currentDay();
  const now = new Date();
  return {
    filters: filters.map((filter) => ({
      key: filter.key,
      label: filter.label,
      count: rows.filter((row) => matchesQuickFilter(filter.key, snapshot(row), today, actor.id, now)).length,
    })),
  };
}

export async function listAssignees(): Promise<Array<{ id: string; name: string; role: "validator" | "service" }>> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: ["validator", "service"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return users.flatMap((user) =>
    user.role === "validator" || user.role === "service" ? [{ id: user.id, name: user.name, role: user.role }] : [],
  );
}

export async function runValidate(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { result: "Yes" | "No" | "Clear"; reason?: string; expectedDate?: string },
): Promise<ActionResult> {
  return runAction(actor, datasetId, rowId, "validate", (data, schema) => {
    const verified = readText(data, schema, "verified");
    if (verified === "Verified OK" && actor.role !== "admin" && actor.role !== "manager") {
      throw new AppError("CONFLICT", 409, "Only a manager can change a verified row.");
    }
    if (input.result === "Clear") {
      if (actor.role !== "admin" && actor.role !== "manager") {
        throw new AppError("FORBIDDEN", 403, "Only a manager can clear validation.");
      }
      writeSemantic(data, schema, "validated", null);
      return;
    }
    const stamp = currentDay();
    writeSemantic(data, schema, "validated", input.result);
    writeSemantic(data, schema, "validated_by", actor.name);
    writeSemantic(data, schema, "validated_at", stamp);
    if (input.result === "Yes") {
      writeSemantic(data, schema, "rejection_reason", null);
      writeSemantic(data, schema, "validation_due", null);
      return;
    }
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 5) throw new AppError("VALIDATION", 400, "Enter a reason of at least 5 characters.");
    if (!input.expectedDate || input.expectedDate < stamp) {
      throw new AppError("VALIDATION", 400, "Choose today or a later expected date.");
    }
    writeSemantic(data, schema, "rejection_reason", reason);
    writeSemantic(data, schema, "validation_due", input.expectedDate);
  });
}

export async function runVerify(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { verified: boolean; note?: string },
): Promise<ActionResult> {
  return runAction(actor, datasetId, rowId, "verify", (data, schema) => {
    if (readText(data, schema, "validated") !== "Yes") {
      throw new AppError("CONFLICT", 409, "Verify a row only after it is validated Yes.");
    }
    if (input.verified) {
      writeSemantic(data, schema, "verified", "Verified OK");
      writeSemantic(data, schema, "verified_by", actor.name);
      writeSemantic(data, schema, "verified_at", currentDay());
      return;
    }
    const note = input.note?.trim() ?? "";
    if (note.length < 5) throw new AppError("VALIDATION", 400, "Enter a note of at least 5 characters.");
    writeSemantic(data, schema, "verified", "Pending");
    writeSemantic(data, schema, "verified_by", null);
    writeSemantic(data, schema, "verified_at", null);
  }, { note: input.note?.trim() ?? "" });
}

export async function runAmc(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { action: "proposal_sent" | "acknowledge" | "decline" | "reset"; note?: string; date?: string },
): Promise<ActionResult> {
  return runAction(actor, datasetId, rowId, "amc", (data, schema) => {
    const today = currentDay();
    const end = readText(data, schema, "end_date");
    const status = effectiveAmcStatus(readText(data, schema, "amc_status"), isWarrantyExpired(end, today));
    if (input.action === "reset") {
      if (actor.role !== "admin" && actor.role !== "manager") {
        throw new AppError("FORBIDDEN", 403, "Only a manager can reset AMC.");
      }
      for (const key of ["amc_status", "proposal_sent_at", "ack_response", "ack_note", "ack_at"]) {
        writeSemantic(data, schema, key, null);
      }
      return;
    }
    if (input.action === "proposal_sent") {
      if (status !== "AMC Due") throw new AppError("CONFLICT", 409, "A proposal can be sent only when AMC is due.");
      writeSemantic(data, schema, "amc_status", "Proposal Sent");
      writeSemantic(data, schema, "proposal_sent_at", input.date ?? today);
      return;
    }
    if (status !== "Proposal Sent") throw new AppError("CONFLICT", 409, "Acknowledge or decline only a sent proposal.");
    const when = input.date ?? today;
    if (input.action === "acknowledge") {
      writeSemantic(data, schema, "amc_status", "Acknowledged");
      writeSemantic(data, schema, "ack_response", "Acknowledged");
    } else {
      writeSemantic(data, schema, "amc_status", "Declined");
      writeSemantic(data, schema, "ack_response", "Declined");
    }
    writeSemantic(data, schema, "ack_at", when);
    writeSemantic(data, schema, "ack_note", input.note?.trim() || null);
  });
}

export async function runPms(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { action: "markDone" | "reschedule"; n: number; date?: string },
): Promise<ActionResult> {
  return runAction(actor, datasetId, rowId, "pms", (data, schema) => {
    const scheduledKey = `pms:${input.n}`;
    const scheduled = readText(data, schema, scheduledKey);
    if (!scheduled || scheduled === "NA" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) {
      throw new AppError("CONFLICT", 409, "That PMS date is not scheduled.");
    }
    const today = currentDay();
    if (input.action === "markDone") {
      const done = input.date ?? today;
      if (done > today) throw new AppError("VALIDATION", 400, "A done date cannot be in the future.");
      writeSemantic(data, schema, `pm_date:${input.n}`, done);
      return;
    }
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new AppError("VALIDATION", 400, "Choose a reschedule date.");
    }
    writeSemantic(data, schema, scheduledKey, input.date);
  });
}

export async function runFollowup(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { date: string },
): Promise<ActionResult> {
  return runAction(actor, datasetId, rowId, "followup", (data, schema) => {
    writeSemantic(data, schema, "next_follow_up", input.date);
  });
}

export async function runAssign(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { validatorId?: string | null; serviceId?: string | null },
): Promise<ActionResult> {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new AppError("FORBIDDEN", 403, "Only a manager can assign rows.");
  }
  const validatorId = await activeRoleUser(input.validatorId, "validator");
  const serviceId = await activeRoleUser(input.serviceId, "service");
  return runAction(actor, datasetId, rowId, "assign", () => undefined, {}, { validatorId, serviceId });
}

export async function logCall(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  input: { type: CallType; description: string },
): Promise<ActionResult> {
  assertCalls(actor, await permissionsFor(actor.role));
  const description = input.description.trim();
  if (!description) throw new AppError("VALIDATION", 400, "Describe the call.");
  return mutateCalls(actor, datasetId, rowId, async (tx, row) => {
    const call = await tx.serviceCall.create({
      data: {
        datasetId,
        rowId: row.id,
        type: input.type,
        description,
        reportedAt: new Date(),
        createdById: actor.id,
      },
    });
    return { undo: "delete-call", callId: call.id };
  }, "call.logged");
}

export async function resolveCall(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  callId: string,
  note?: string,
): Promise<ActionResult> {
  assertCalls(actor, await permissionsFor(actor.role));
  return mutateCalls(actor, datasetId, rowId, async (tx, row) => {
    const call = await tx.serviceCall.findFirst({ where: { id: callId, datasetId, rowId: row.id, deletedAt: null } });
    if (!call || call.status !== "Open") throw new AppError("CONFLICT", 409, "That call is not open.");
    await tx.serviceCall.update({
      where: { id: call.id },
      data: { status: "Resolved", resolvedAt: new Date(), resolvedById: actor.id, note: note?.trim() || null },
    });
    return { undo: "reopen-call", callId: call.id };
  }, "call.resolved");
}

export async function listCalls(actor: PublicUser, datasetId: string, rowId: string): Promise<Array<{
  id: string;
  type: string;
  description: string;
  reportedAt: string;
  status: string;
  resolvedAt: string | null;
  note: string | null;
}>> {
  const permissions = await permissionsFor(actor.role);
  if (!canViewGroup(permissions.groupAccess, "complaint") && !canViewGroup(permissions.groupAccess, "breakdown_calls")) {
    throw new AppError("FORBIDDEN", 403, "You cannot view service calls.");
  }
  await assertLiveRow(datasetId, rowId);
  const calls = await prisma.serviceCall.findMany({
    where: { datasetId, rowId, deletedAt: null },
    orderBy: { reportedAt: "desc" },
  });
  return calls.map((call) => ({
    id: call.id,
    type: call.type,
    description: call.description,
    reportedAt: call.reportedAt.toISOString(),
    status: call.status,
    resolvedAt: call.resolvedAt?.toISOString() ?? null,
    note: call.note,
  }));
}

export async function listActivity(actor: PublicUser, datasetId: string, rowId: string): Promise<Array<{
  who: string;
  what: string;
  when: string;
}>> {
  const { schema, permissions } = await loadDataset(actor, datasetId);
  await assertLiveRow(datasetId, rowId);
  const logs = await prisma.activityLog.findMany({
    where: { datasetId, rowId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return logs.flatMap((log) => {
    if (!activityVisible(log.columnKey, log.groupKey, schema, permissions)) return [];
    return [{ who: log.actorName, what: describeActivity(log.action, log.columnKey, log.toValue), when: log.createdAt.toISOString() }];
  });
}

export async function undoAction(actor: PublicUser, datasetId: string, rowId: string, actionId: string): Promise<ActionResult> {
  const since = new Date(Date.now() - UNDO_SECONDS * 1000);
  const action = randomUUID();
  let version = 0;
  await prisma.$transaction(async (tx) => {
    await lockDataset(tx, datasetId);
    await lockLiveRow(tx, datasetId, rowId);
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    const logs = await tx.activityLog.findMany({
      where: { actionId, rowId, actorId: actor.id, createdAt: { gte: since } },
    });
    if (logs.length === 0) throw new AppError("CONFLICT", 409, "This action can no longer be undone.");
    const stamped = logs.map((log) => readVersion(log.meta)).find((value) => value != null);
    if (stamped == null || row.version !== stamped) {
      throw new AppError("CONFLICT", 409, "This row changed again.");
    }
    const schema = await schemaOf(tx, datasetId);
    const data = jsonRecord(row.data);
    let validatorId = row.assignedValidatorId;
    let serviceId = row.assignedServiceId;
    for (const log of logs) {
      if (log.columnKey === "assignedValidatorId") validatorId = textJson(log.fromValue);
      else if (log.columnKey === "assignedServiceId") serviceId = textJson(log.fromValue);
      else if (log.columnKey) {
        const previous = jsonCell(log.fromValue);
        if (previous == null) delete data[log.columnKey];
        else data[log.columnKey] = previous;
      }
      const undo = readUndo(log.meta);
      if (undo.undo === "delete-call" && undo.callId) {
        await tx.serviceCall.updateMany({ where: { id: undo.callId, rowId }, data: { deletedAt: new Date() } });
      }
      if (undo.undo === "reopen-call" && undo.callId) {
        await tx.serviceCall.updateMany({
          where: { id: undo.callId, rowId },
          data: { status: "Open", resolvedAt: null, resolvedById: null, note: null },
        });
      }
    }
    const extras = await callExtras(tx, datasetId, rowId);
    const synced = syncMirrorFields(data, schema, extras);
    version = row.version + 1;
    await tx.row.update({
      where: { id: row.id },
      data: {
        data: synced.data as Prisma.InputJsonValue,
        version,
        assignedValidatorId: validatorId,
        assignedServiceId: serviceId,
        updatedById: actor.id,
        updatedByName: actor.name,
        ...mirrorPatch(synced),
      },
    });
    await tx.activityLog.create({
      data: {
        datasetId,
        rowId,
        actorId: actor.id,
        actorName: actor.name,
        action: "action.undone",
        actionId: action,
        meta: { undoneActionId: actionId, version },
      },
    });
  });
  emit(actor, datasetId, rowId, action, "action.undone");
  return { actionId: action, version };
}

export async function closeHistorical(actor: PublicUser, datasetId: string, rowIds: string[]): Promise<BulkResult> {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new AppError("FORBIDDEN", 403, "Only a manager can close historical PMS.");
  }
  const results: BulkResult["results"] = [];
  for (const rowId of rowIds) {
    try {
      const result = await runAction(actor, datasetId, rowId, "pms", (data, schema) => {
        const today = currentDay();
        const end = readText(data, schema, "end_date");
        if (!end || end >= today) throw new AppError("CONFLICT", 409, "Historical close applies to lapsed contracts.");
        let closed = 0;
        for (const column of schema.columns) {
          if (column.deletedAt) continue;
          const match = /^pms:(\d+)$/.exec(column.semantic ?? "") ?? /^pms:(\d+)$/.exec(column.key);
          const number = match?.[1];
          if (!number) continue;
          const scheduled = readText(data, schema, `pms:${number}`);
          if (!scheduled || scheduled === "NA" || scheduled >= today) continue;
          const done = readText(data, schema, `pm_date:${number}`);
          if (done && done !== "NA") continue;
          writeSemantic(data, schema, `pm_date:${number}`, scheduled);
          closed += 1;
        }
        if (closed === 0) throw new AppError("CONFLICT", 409, "No past PMS entries to close.");
      }, { historical: true });
      results.push({ rowId, ok: true, actionId: result.actionId });
    } catch (error) {
      if (error instanceof AppError) results.push({ rowId, ok: false, error: error.message });
      else throw error;
    }
  }
  return { results };
}

export async function bulkValidate(
  actor: PublicUser,
  datasetId: string,
  rowIds: string[],
  input: { result: "Yes" | "No" | "Clear"; reason?: string; expectedDate?: string },
): Promise<BulkResult> {
  return bulk(rowIds, (rowId) => runValidate(actor, datasetId, rowId, input));
}

export async function bulkVerify(
  actor: PublicUser,
  datasetId: string,
  rowIds: string[],
  input: { verified: boolean; note?: string },
): Promise<BulkResult> {
  return bulk(rowIds, (rowId) => runVerify(actor, datasetId, rowId, input));
}

export async function bulkAssign(
  actor: PublicUser,
  datasetId: string,
  rowIds: string[],
  input: { validatorId?: string | null; serviceId?: string | null },
): Promise<BulkResult> {
  return bulk(rowIds, (rowId) => runAssign(actor, datasetId, rowId, input));
}

async function bulk(rowIds: string[], run: (rowId: string) => Promise<ActionResult>): Promise<BulkResult> {
  const results: BulkResult["results"] = [];
  for (const rowId of rowIds) {
    try {
      const result = await run(rowId);
      results.push({ rowId, ok: true, actionId: result.actionId });
    } catch (error) {
      if (error instanceof AppError) results.push({ rowId, ok: false, error: error.message });
      else throw error;
    }
  }
  return { results };
}

async function runAction(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  action: ActionName,
  mutate: (data: Record<string, unknown>, schema: DatasetSchema) => void,
  meta: Record<string, unknown> = {},
  assignment?: { validatorId?: string | null; serviceId?: string | null },
): Promise<ActionResult> {
  const permissions = await permissionsFor(actor.role);
  assertCapability(actor, permissions, action);
  const actionId = randomUUID();
  let version = 0;
  await prisma.$transaction(async (tx) => {
    await lockDataset(tx, datasetId);
    await lockLiveRow(tx, datasetId, rowId);
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    const schema = await schemaOf(tx, datasetId);
    const data = jsonRecord(row.data);
    const before = { ...data };
    mutate(data, schema);
    const extras = await callExtras(tx, datasetId, row.id);
    const synced = syncMirrorFields(data, schema, extras);
    version = row.version + 1;
    const validatorId = assignment && assignment.validatorId !== undefined ? assignment.validatorId : row.assignedValidatorId;
    const serviceId = assignment && assignment.serviceId !== undefined ? assignment.serviceId : row.assignedServiceId;
    await tx.row.update({
      where: { id: row.id },
      data: {
        data: synced.data as Prisma.InputJsonValue,
        version,
        assignedValidatorId: validatorId,
        assignedServiceId: serviceId,
        updatedById: actor.id,
        updatedByName: actor.name,
        ...mirrorPatch(synced),
      },
    });
    const logs = fieldLogs(before, synced.data, schema);
    if (assignment && assignment.validatorId !== undefined && (assignment.validatorId ?? null) !== row.assignedValidatorId) {
      logs.push({ key: "assignedValidatorId", from: row.assignedValidatorId, to: assignment.validatorId, groupKey: "" });
    }
    if (assignment && assignment.serviceId !== undefined && (assignment.serviceId ?? null) !== row.assignedServiceId) {
      logs.push({ key: "assignedServiceId", from: row.assignedServiceId, to: assignment.serviceId, groupKey: "" });
    }
    if (logs.length === 0) logs.push({ key: "", from: null, to: null, groupKey: ACTION_GROUP[action] ?? "" });
    await tx.activityLog.createMany({
      data: logs.map((log) => ({
        datasetId,
        rowId,
        actorId: actor.id,
        actorName: actor.name,
        action: `action.${action}`,
        actionId,
        columnKey: log.key || null,
        groupKey: log.groupKey || ACTION_GROUP[action],
        fromValue: jsonInput(log.from),
        toValue: jsonInput(log.to),
        meta: { ...meta, version } as Prisma.InputJsonValue,
      })),
    });
  });
  emit(actor, datasetId, rowId, actionId, `action.${action}`);
  return { actionId, version };
}

async function mutateCalls(
  actor: PublicUser,
  datasetId: string,
  rowId: string,
  change: (tx: Prisma.TransactionClient, row: { id: string; version: number; data: Prisma.JsonValue }) => Promise<Record<string, unknown>>,
  action: string,
): Promise<ActionResult> {
  const actionId = randomUUID();
  let version = 0;
  await prisma.$transaction(async (tx) => {
    await lockDataset(tx, datasetId);
    await lockLiveRow(tx, datasetId, rowId);
    const row = await tx.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
    const extraMeta = await change(tx, row);
    const schema = await schemaOf(tx, datasetId);
    const extras = await callExtras(tx, datasetId, row.id);
    const synced = syncMirrorFields(jsonRecord(row.data), schema, extras);
    version = row.version + 1;
    await tx.row.update({
      where: { id: row.id },
      data: {
        data: synced.data as Prisma.InputJsonValue,
        version,
        updatedById: actor.id,
        updatedByName: actor.name,
        ...mirrorPatch(synced),
      },
    });
    await tx.activityLog.create({
      data: {
        datasetId,
        rowId,
        actorId: actor.id,
        actorName: actor.name,
        action,
        actionId,
        groupKey: "complaint",
        meta: { ...extraMeta, version } as Prisma.InputJsonValue,
      },
    });
  });
  emit(actor, datasetId, rowId, actionId, action);
  return { actionId, version };
}

function assertCapability(actor: PublicUser, permissions: Permissions, action: ActionName): void {
  if (action === "calls") {
    assertCalls(actor, permissions);
    return;
  }
  const allowed = canPerformAction(actor.role, action === "assign" || action === "verify" ? action : action, (groupKey) =>
    canEditGroup(permissions.groupAccess, groupKey),
  );
  if (!allowed) throw new AppError("FORBIDDEN", 403, "You cannot run that action.");
  const groupKey = ACTION_GROUP[action];
  if (groupKey && actor.role !== "admin" && actor.role !== "manager" && !canEditGroup(permissions.groupAccess, groupKey)) {
    throw new AppError("FORBIDDEN", 403, "You cannot edit that group.");
  }
}

function assertCalls(actor: PublicUser, permissions: Permissions): void {
  const allowed = canPerformAction(actor.role, "calls", (groupKey) => canEditGroup(permissions.groupAccess, groupKey));
  if (!allowed) throw new AppError("FORBIDDEN", 403, "You cannot log calls.");
}

async function activeRoleUser(id: string | null | undefined, role: "validator" | "service"): Promise<string | null | undefined> {
  if (id === undefined) return undefined;
  if (id === null || id === "") return null;
  const user = await prisma.user.findFirst({ where: { id, active: true, role }, select: { id: true } });
  if (!user) throw new AppError("VALIDATION", 400, `Choose an active ${role}.`);
  return user.id;
}

async function loadDataset(actor: PublicUser, datasetId: string): Promise<{ schema: DatasetSchema; permissions: Permissions }> {
  const dataset = await prisma.dataset.findFirst({ where: { id: datasetId, deletedAt: null }, select: { schema: true } });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  return { schema, permissions: await permissionsFor(actor.role) };
}

async function assertLiveRow(datasetId: string, rowId: string): Promise<void> {
  const row = await prisma.row.findFirst({ where: { id: rowId, datasetId, deletedAt: null }, select: { id: true } });
  if (!row) throw new AppError("NOT_FOUND", 404, "Row not found.");
}

async function schemaOf(tx: Prisma.TransactionClient, datasetId: string): Promise<DatasetSchema> {
  const dataset = await tx.dataset.findUnique({ where: { id: datasetId }, select: { schema: true } });
  const schema = parseDatasetSchema(dataset?.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  return schema;
}

async function lockDataset(tx: Prisma.TransactionClient, datasetId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Dataset" WHERE id = ${datasetId}::uuid AND "deletedAt" IS NULL FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
}

async function callExtras(tx: Prisma.TransactionClient, datasetId: string, rowId: string): Promise<MirrorExtras> {
  const calls = await tx.serviceCall.findMany({
    where: { datasetId, rowId, deletedAt: null },
    select: { status: true, reportedAt: true },
  });
  const latest = calls.reduce<Date | null>((best, call) => (!best || call.reportedAt > best ? call.reportedAt : best), null);
  return {
    openCalls: calls.filter((call) => call.status === "Open").length,
    lastCallDate: latest ? todayInTimeZone(env.APP_TIMEZONE, latest) : null,
  };
}

function findColumn(schema: DatasetSchema, semantic: string): DatasetColumn | undefined {
  return schema.columns.find((column) => column.deletedAt == null && (column.semantic === semantic || column.key === semantic));
}

function readText(data: Record<string, unknown>, schema: DatasetSchema, semantic: string): string | null {
  const column = findColumn(schema, semantic);
  const value = column ? data[column.key] : data[semantic];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function writeSemantic(data: Record<string, unknown>, schema: DatasetSchema, semantic: string, value: string | null): void {
  const column = findColumn(schema, semantic);
  const key = column?.key ?? semantic;
  if (value == null || value === "") delete data[key];
  else data[key] = value;
}

function fieldLogs(
  before: Record<string, unknown>,
  after: Record<string, string | number | boolean>,
  schema: DatasetSchema,
): Array<{ key: string; from: unknown; to: unknown; groupKey: string }> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const logs: Array<{ key: string; from: unknown; to: unknown; groupKey: string }> = [];
  for (const key of keys) {
    if (same(before[key], after[key])) continue;
    const column = schema.columns.find((item) => item.key === key);
    const group = schema.groups.find((item) => item.id === column?.groupId);
    logs.push({ key, from: before[key] ?? null, to: after[key] ?? null, groupKey: group?.groupKey ?? "" });
  }
  return logs;
}

function activityVisible(
  columnKey: string | null,
  groupKey: string | null,
  schema: DatasetSchema,
  permissions: Permissions,
): boolean {
  const key = groupKey || groupForColumnKey(schema, columnKey);
  if (!key) return columnKey == null || permissions.groupAccess === "all";
  if (key === "complaint" || key === "breakdown_calls") {
    return canViewGroup(permissions.groupAccess, "complaint") || canViewGroup(permissions.groupAccess, "breakdown_calls");
  }
  return canViewGroup(permissions.groupAccess, key);
}

function groupForColumnKey(schema: DatasetSchema, columnKey: string | null): string | null {
  if (!columnKey) return null;
  const column = schema.columns.find((item) => item.key === columnKey);
  return schema.groups.find((group) => group.id === column?.groupId)?.groupKey ?? null;
}

function describeActivity(action: string, columnKey: string | null, toValue: Prisma.JsonValue | null): string {
  if (action === "cell.updated") return `${columnKey ?? "Field"} updated`;
  if (action === "action.validate") return "Validation updated";
  if (action === "action.verify") return "Verification updated";
  if (action === "action.amc") return "AMC updated";
  if (action === "action.pms") return "PMS updated";
  if (action === "action.followup") return "Follow-up updated";
  if (action === "action.assign") return "Assignment updated";
  if (action === "call.logged") return "Call logged";
  if (action === "call.resolved") return "Call resolved";
  if (action === "action.undone") return "Action undone";
  if (toValue == null) return action;
  return action;
}

function snapshot(row: {
  validated: string | null;
  validationDue: Date | null;
  verified: string | null;
  endDate: Date | null;
  amcStatus: string | null;
  nextFollowUp: Date | null;
  nextDuePms: Date | null;
  updatedAt: Date;
  assignedValidatorId: string | null;
  assignedServiceId: string | null;
}) {
  return {
    validated: row.validated,
    validationDue: dateOnly(row.validationDue),
    verified: row.verified,
    endDate: dateOnly(row.endDate),
    amcStatus: row.amcStatus,
    nextFollowUp: dateOnly(row.nextFollowUp),
    nextDuePms: dateOnly(row.nextDuePms),
    updatedAt: row.updatedAt.toISOString(),
    assignedValidatorId: row.assignedValidatorId,
    assignedServiceId: row.assignedServiceId,
  };
}

const snapshotSelect = {
  validated: true,
  validationDue: true,
  verified: true,
  endDate: true,
  amcStatus: true,
  nextFollowUp: true,
  nextDuePms: true,
  updatedAt: true,
  assignedValidatorId: true,
  assignedServiceId: true,
} as const;

function dateOnly(value: Date | null): string | null {
  if (!value) return null;
  return excelDateToISO(value);
}

function currentDay(): string {
  return todayInTimeZone(env.APP_TIMEZONE);
}

function mirrorPatch(synced: ReturnType<typeof syncMirrorFields>) {
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

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function same(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  return left === right;
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return Prisma.JsonNull;
}

function jsonCell(value: Prisma.JsonValue | null): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function textJson(value: Prisma.JsonValue | null): string | null {
  return typeof value === "string" && value ? value : null;
}

function readVersion(meta: Prisma.JsonValue | null): number | null {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  const version = meta.version;
  return typeof version === "number" ? version : null;
}

function readUndo(meta: Prisma.JsonValue | null): { undo?: string; callId?: string } {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return {};
  return {
    undo: typeof meta.undo === "string" ? meta.undo : undefined,
    callId: typeof meta.callId === "string" ? meta.callId : undefined,
  };
}

function emit(actor: PublicUser, datasetId: string, rowId: string, actionId: string, type: string): void {
  try {
    publishEvent({ type, datasetId, rowId, actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, `Failed to publish ${type}`);
  }
}
