import { randomUUID } from "node:crypto";
import type { ColumnType, DatasetColumn, DatasetGroup, DatasetSchema } from "@app/shared";
import { CANONICAL_GROUPS, GROUP_TINTS, cleanLabel, labelForGroupKey, parseDatasetSchema, todayInTimeZone } from "@app/shared";
import { Prisma } from "@prisma/client";
import { env } from "../../env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { syncMirrorFields } from "./mirrors";

type ColumnSpec = {
  groupKey: string;
  key: string;
  label: string;
  type: ColumnType;
  semantic: string;
  options: string[];
  patterns: RegExp[];
};

const SPECS: ColumnSpec[] = [
  spec("data_validation", "validated", "Validated", "yesno", ["Yes", "No"], [/^validated$/i]),
  spec("data_validation", "validated_by", "Validated by", "text", [], [/^validated by$/i]),
  spec("data_validation", "validated_at", "Validated at", "date", [], [/^validated at$/i]),
  spec("data_validation", "validation_due", "By when Data will be validated", "date", [], [
    /^validation due$/i,
    /^by when data will be validated$/i,
  ]),
  spec("data_validation", "rejection_reason", "Rejection reason", "text", [], [/^rejection reason$/i]),
  spec("data_validation", "verified", "Verified", "status", ["Pending", "Verified OK"], [/^verified$/i]),
  spec("data_validation", "verified_by", "Verified by", "text", [], [/^verified by$/i]),
  spec("data_validation", "verified_at", "Verified at", "date", [], [/^verified at$/i]),
  spec("instrument_details", "warranty_live", "Warranty live", "status", ["Active", "Expiring", "Expired", "Unknown"], [
    /^warranty live$/i,
  ]),
  spec("schedule_services", "next_due_pms", "Next due PMS", "date", [], [/^next due pms$/i]),
  spec("amc", "amc_status", "AMC status", "status", ["Not Due", "AMC Due", "Proposal Sent", "Acknowledged", "Declined"], [
    /^amc status$/i,
    /^amc$/i,
  ]),
  spec("amc", "proposal_sent_at", "Proposal sent at", "date", [], [/^proposal sent(?: at)?$/i]),
  spec("amc", "ack_response", "Ack response", "status", ["Acknowledged", "Declined"], [/^ack(?:nowledge(?:d)?)? response$/i]),
  spec("amc", "ack_note", "Ack note", "text", [], [/^ack(?:nowledge(?:d)?)? note$/i]),
  spec("amc", "ack_at", "Ack at", "date", [], [/^ack(?:nowledged)? at$/i]),
  spec("follow_up", "next_follow_up", "Next follow-up", "date", [], [/^(follow up|follow-up|next follow up|next follow-up)$/i]),
];

const CALL_SPECS: ColumnSpec[] = [
  spec("complaint", "open_calls", "Open calls", "integer", [], [/^open calls$/i]),
  spec("complaint", "last_call_date", "Last call date", "date", [], [/^last call date$/i]),
];

export function applySystemColumns(schema: DatasetSchema): DatasetSchema {
  const next: DatasetSchema = {
    version: 1,
    groups: schema.groups.map((group) => ({ ...group })),
    columns: schema.columns.map((column) => ({ ...column, options: [...column.options] })),
  };
  for (const item of SPECS) bindSpec(next, item, item.groupKey);
  const callGroup = callGroupKey(next);
  for (const item of CALL_SPECS) bindSpec(next, { ...item, groupKey: callGroup }, callGroup);
  pairPmDates(next);
  return reindex(next);
}

export async function ensureDatasetSystemColumns(datasetId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Dataset" WHERE id = ${datasetId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `;
      if (locked.length === 0) return;
      const dataset = await tx.dataset.findUnique({ where: { id: datasetId }, select: { schema: true } });
      const schema = parseDatasetSchema(dataset?.schema);
      if (!schema) return;
      const next = applySystemColumns(schema);
      if (JSON.stringify(next) === JSON.stringify(schema)) return;
      await tx.dataset.update({
        where: { id: datasetId },
        data: { schema: next as unknown as Prisma.InputJsonValue },
      });
      await resyncRows(tx, datasetId, next);
    },
    { timeout: 120_000 },
  );
}

export async function ensureAllSystemColumns(): Promise<void> {
  const datasets = await prisma.dataset.findMany({ where: { deletedAt: null }, select: { id: true } });
  for (const dataset of datasets) {
    try {
      await ensureDatasetSystemColumns(dataset.id);
    } catch (error) {
      logger.error({ err: error, datasetId: dataset.id }, "Failed to ensure system columns");
    }
  }
}

function spec(
  groupKey: string,
  key: string,
  label: string,
  type: ColumnType,
  options: string[],
  patterns: RegExp[],
): ColumnSpec {
  return { groupKey, key, label, type, semantic: key, options, patterns };
}

function bindSpec(schema: DatasetSchema, item: ColumnSpec, groupKey: string): void {
  const existing = schema.columns.find(
    (column) =>
      column.key === item.key ||
      column.semantic === item.semantic ||
      item.patterns.some((pattern) => pattern.test(cleanLabel(column.label))),
  );
  if (existing) {
    existing.semantic = item.semantic;
    existing.system = true;
    existing.deletedAt = null;
    existing.deletedByName = null;
    existing.type = item.type;
    existing.options = item.options;
    return;
  }
  const group = ensureGroup(schema, groupKey);
  schema.columns.push(blankColumn(item, group.id, schema.columns.length));
}

function callGroupKey(schema: DatasetSchema): string {
  if (schema.groups.some((group) => group.groupKey === "complaint" && group.deletedAt == null)) return "complaint";
  if (schema.groups.some((group) => group.groupKey === "breakdown_calls" && group.deletedAt == null)) return "breakdown_calls";
  return "complaint";
}

function pairPmDates(schema: DatasetSchema): void {
  const ordered = [...schema.columns].sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
  const additions: Array<{ afterKey: string; column: DatasetColumn }> = [];
  for (const column of ordered) {
    if (column.deletedAt) continue;
    const match = /^pms:(\d+)$/.exec(column.semantic ?? "") ?? /^pms:(\d+)$/.exec(column.key);
    const number = match?.[1];
    if (!number) continue;
    const semantic = `pm_date:${number}`;
    const existing = schema.columns.find((item) => item.key === semantic || item.semantic === semantic);
    if (existing) {
      existing.semantic = semantic;
      existing.system = true;
      existing.deletedAt = null;
      existing.deletedByName = null;
      existing.type = "date";
      continue;
    }
    const groupId = column.groupId;
    additions.push({
      afterKey: column.key,
      column: blankColumn(
        {
          groupKey: "schedule_services",
          key: semantic,
          label: `PM Date ${number}`,
          type: "date",
          semantic,
          options: [],
          patterns: [],
        },
        groupId,
        column.order + 1,
      ),
    });
  }
  if (additions.length === 0) {
    schema.columns = ordered;
    return;
  }
  let columns = ordered;
  for (const addition of additions) {
    const index = columns.findIndex((column) => column.key === addition.afterKey);
    columns = [...columns.slice(0, index + 1), addition.column, ...columns.slice(index + 1)];
  }
  schema.columns = columns;
}

function ensureGroup(schema: DatasetSchema, groupKey: string): DatasetGroup {
  const live = schema.groups.find((group) => group.groupKey === groupKey && group.deletedAt == null);
  if (live) return live;
  const deleted = schema.groups.find((group) => group.groupKey === groupKey);
  if (deleted) {
    deleted.deletedAt = null;
    deleted.deletedByName = null;
    return deleted;
  }
  const known = CANONICAL_GROUPS.find((group) => group.groupKey === groupKey);
  const tint = GROUP_TINTS[schema.groups.length % GROUP_TINTS.length] ?? GROUP_TINTS[0];
  const group: DatasetGroup = {
    id: randomUUID(),
    label: known?.label ?? labelForGroupKey(groupKey),
    groupKey,
    order: schema.groups.length,
    tint,
    deletedAt: null,
    deletedByName: null,
  };
  schema.groups.push(group);
  return group;
}

function blankColumn(item: ColumnSpec, groupId: string, order: number): DatasetColumn {
  return {
    key: item.key,
    label: item.label,
    originalLabel: item.label,
    autoNamed: false,
    groupId,
    order,
    type: item.type,
    semantic: item.semantic,
    system: true,
    width: 140,
    hidden: false,
    options: item.options,
    deletedAt: null,
    deletedByName: null,
  };
}

function reindex(schema: DatasetSchema): DatasetSchema {
  return {
    version: 1,
    groups: [...schema.groups]
      .sort((left, right) => left.order - right.order)
      .map((group, order) => ({ ...group, order })),
    columns: [...schema.columns]
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((column, order) => ({ ...column, order })),
  };
}

async function resyncRows(tx: Prisma.TransactionClient, datasetId: string, schema: DatasetSchema): Promise<void> {
  const rows = await tx.row.findMany({ where: { datasetId }, select: { id: true, data: true } });
  const calls = await tx.serviceCall.findMany({
    where: { datasetId, deletedAt: null },
    select: { rowId: true, status: true, reportedAt: true },
  });
  for (const row of rows) {
    const mine = calls.filter((call) => call.rowId === row.id);
    const openCalls = mine.filter((call) => call.status === "Open").length;
    const latest = mine.reduce<Date | null>((best, call) => (!best || call.reportedAt > best ? call.reportedAt : best), null);
    const data = jsonRecord(row.data);
    const synced = syncMirrorFields(data, schema, {
      openCalls,
      lastCallDate: latest ? todayInTimeZone(env.APP_TIMEZONE, latest) : null,
    });
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

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}
