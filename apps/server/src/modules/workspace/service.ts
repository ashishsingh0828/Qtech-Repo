import type { DatasetSchema, PublicUser } from "@app/shared";
import {
  DAILY_VALIDATION_TARGET,
  ROLE_REGISTRY,
  calendarDaysBetween,
  effectiveAmcStatus,
  isAmcDue,
  isContractLive,
  isFollowupDue,
  isNeedsValidation,
  isPendingVerification,
  isPmsDueSoon,
  isPmsOverdue,
  isUnverifiedExpiry,
  isValidationOverdue,
  isWarrantyExpired,
  parseDatasetSchema,
  projectSchema,
  readField,
  warrantyLiveStatus,
} from "@app/shared";
import type { Prisma } from "@prisma/client";
import { permissionsFor } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { endOfZonedDay, startOfZonedDay, today } from "../../lib/time";

type Tone = "emerald" | "amber" | "ruby" | "sapphire" | "stone";

export type KpiCard = {
  key: string;
  label: string;
  value: number;
  hint: string;
  href: string | null;
  target?: number;
};

export type WorkCardItem = {
  rowId: string;
  version: number;
  customer: string;
  equipment: string;
  serial: string;
  summary: string;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  contractType: string;
  pills: Array<{ label: string; tone: Tone }>;
  scheduled: string | null;
  pmsN: number | null;
  pmsLabel: string | null;
  bucket: "overdue" | "today" | "week" | "later" | null;
  validationDue: string | null;
  callId: string | null;
  callType: string | null;
  callDescription: string | null;
};

type StoredRow = {
  id: string;
  position: number;
  version: number;
  data: Prisma.JsonValue;
  validated: string | null;
  validationDue: Date | null;
  verified: string | null;
  endDate: Date | null;
  amcStatus: string | null;
  nextFollowUp: Date | null;
  nextDuePms: Date | null;
  assignedValidatorId: string | null;
  assignedServiceId: string | null;
};

const TEXT_TYPES = new Set(["text", "phone", "email", "status", "category", "yesno"]);

const DONE_ACTIONS = [
  "action.validate",
  "action.verify",
  "action.amc",
  "action.pms",
  "action.followup",
  "action.assign",
  "call.logged",
  "call.resolved",
];

export async function roleKpis(actor: PublicUser, datasetId?: string): Promise<{ today: string; kpis: KpiCard[] }> {
  const day = today();
  if (!datasetId) {
    return { today: day, kpis: await cardsFor(actor, day, null, [], 0) };
  }
  const loaded = await loadRows(datasetId);
  const openCalls = await openCallCount(datasetId, loaded.rows);
  const validatedTodayCount = actor.role === "validator" ? await countValidatedToday(actor.id, datasetId, day) : 0;
  return { today: day, kpis: await cardsFor(actor, day, datasetId, loaded.rows, openCalls, validatedTodayCount) };
}

export async function workCards(
  actor: PublicUser,
  input: {
    datasetId: string;
    queue: string;
    limit?: number;
    offset?: number;
    mine?: boolean;
    city?: string;
    contract?: string;
    slot?: "validator" | "service";
  },
): Promise<{ total: number; items: WorkCardItem[]; cities: string[]; contracts: string[] }> {
  const day = today();
  const loaded = await loadRows(input.datasetId);
  const permissions = await permissionsFor(actor.role);
  const projected = projectSchema(loaded.schema, permissions.groupAccess);
  const calls = input.queue === "calls" ? await datasetOpenCalls(input.datasetId) : new Map<string, OpenCall>();
  let matched = loaded.rows.filter((row) =>
    input.queue === "calls" ? calls.has(row.id) : matchesQueue(input.queue, row, day, actor, input.slot),
  );
  if (input.mine) {
    matched = matched.filter((row) =>
      actor.role === "service" ? row.assignedServiceId === actor.id : row.assignedValidatorId === actor.id,
    );
  }
  const cities = unique(matched.map((row) => textField(row.data, projected.columns, "city")));
  const contracts = unique(matched.map((row) => textField(row.data, projected.columns, "contract_type")));
  if (input.city) matched = matched.filter((row) => textField(row.data, projected.columns, "city") === input.city);
  if (input.contract) {
    matched = matched.filter((row) => textField(row.data, projected.columns, "contract_type") === input.contract);
  }
  matched.sort((left, right) => compareQueue(input.queue, left, right, day));
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  const page = matched.slice(offset, offset + limit);
  return {
    total: matched.length,
    cities,
    contracts,
    items: page.map((row) => toCard(row, projected.columns, day, calls.get(row.id) ?? null)),
  };
}

export async function teamWorkload(datasetId?: string): Promise<{
  members: Array<{ id: string; name: string; role: "validator" | "service"; open: number; doneToday: number }>;
}> {
  const day = today();
  const members = await prisma.user.findMany({
    where: { active: true, role: { in: ["validator", "service"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const rows = datasetId ? (await loadRows(datasetId)).rows : await allLiveRows();
  const since = startOfZonedDay(day);
  const until = endOfZonedDay(day);
  const logs = await prisma.activityLog.findMany({
    where: {
      createdAt: { gte: since, lt: until },
      action: { in: DONE_ACTIONS },
      actorId: { in: members.map((member) => member.id) },
      ...(datasetId ? { datasetId } : {}),
    },
    select: { actorId: true, actionId: true },
  });
  const done = new Map<string, Set<string>>();
  for (const log of logs) {
    if (!log.actorId) continue;
    const bucket = done.get(log.actorId) ?? new Set<string>();
    bucket.add(log.actionId ?? log.actorId);
    done.set(log.actorId, bucket);
  }
  return {
    members: members.flatMap((member) => {
      const role = member.role === "validator" || member.role === "service" ? member.role : null;
      if (!role) return [];
      const open = rows.filter((row) => openFor(role, member.id, row, day)).length;
      return [{ id: member.id, name: member.name, role, open, doneToday: done.get(member.id)?.size ?? 0 }];
    }),
  };
}

export async function listFeed(input: {
  limit?: number;
  offset?: number;
  userId?: string;
  action?: string;
  datasetId?: string;
  from?: string;
  to?: string;
}): Promise<{
  total: number;
  items: Array<{
    id: string;
    actorName: string;
    action: string;
    summary: string;
    datasetId: string | null;
    datasetName: string | null;
    rowId: string | null;
    createdAt: string;
  }>;
  actors: Array<{ id: string; name: string }>;
  datasets: Array<{ id: string; name: string }>;
}> {
  const where: Prisma.ActivityLogWhereInput = {};
  if (input.userId) where.actorId = input.userId;
  if (input.action) where.action = input.action;
  if (input.datasetId) where.datasetId = input.datasetId;
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: startOfZonedDay(input.from) } : {}),
      ...(input.to ? { lt: endOfZonedDay(input.to) } : {}),
    };
  }
  const limit = input.limit ?? 15;
  const offset = input.offset ?? 0;
  const [total, logs, actors, datasets] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset, take: limit }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.dataset.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  return {
    total,
    actors,
    datasets,
    items: logs.map((log) => ({
      id: log.id,
      actorName: log.actorName,
      action: log.action,
      summary: describe(log.action, log.columnKey),
      datasetId: log.datasetId,
      datasetName: log.datasetId ? names.get(log.datasetId) ?? null : null,
      rowId: log.rowId,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

export async function datasetHealth(datasetId: string): Promise<{
  duplicateSerials: number;
  missingEndDate: number;
  autoNamedColumns: number;
  historicalPms: number;
  historicalRowIds: string[];
}> {
  const loaded = await loadRows(datasetId);
  const day = today();
  const serials = new Map<string, number>();
  for (const row of loaded.rows) {
    const serial = textField(row.data, loaded.schema.columns, "serial").toLowerCase();
    if (!serial) continue;
    serials.set(serial, (serials.get(serial) ?? 0) + 1);
  }
  let duplicateSerials = 0;
  for (const count of serials.values()) {
    if (count > 1) duplicateSerials += count;
  }
  const historicalRowIds = loaded.rows.filter((row) => hasHistoricalPms(row, loaded.schema, day)).map((row) => row.id);
  return {
    duplicateSerials,
    missingEndDate: loaded.rows.filter((row) => row.endDate == null).length,
    autoNamedColumns: loaded.schema.columns.filter((column) => column.deletedAt == null && column.autoNamed).length,
    historicalPms: historicalRowIds.length,
    historicalRowIds,
  };
}

export async function searchHub(actor: PublicUser, q: string): Promise<{
  pages: Array<{ label: string; path: string }>;
  datasets: Array<{ id: string; name: string }>;
  records: Array<{ datasetId: string; rowId: string; label: string; hint: string }>;
  columns: Array<{ datasetId: string; key: string; label: string }>;
}> {
  const needle = q.trim().toLowerCase();
  const pages = ROLE_REGISTRY[actor.role].nav
    .filter((item) => !needle || item.label.toLowerCase().includes(needle))
    .map((item) => ({ label: item.label, path: item.path }));
  const datasets = await prisma.dataset.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, schema: true },
    orderBy: { name: "asc" },
  });
  const datasetHits = datasets
    .filter((dataset) => !needle || dataset.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((dataset) => ({ id: dataset.id, name: dataset.name }));
  const permissions = await permissionsFor(actor.role);
  const columns: Array<{ datasetId: string; key: string; label: string }> = [];
  const records: Array<{ datasetId: string; rowId: string; label: string; hint: string }> = [];
  if (needle) {
    for (const dataset of datasets) {
      const schema = parseDatasetSchema(dataset.schema);
      if (!schema) continue;
      const projected = projectSchema(schema, permissions.groupAccess);
      for (const column of projected.columns) {
        if (columns.length >= 8) break;
        if (column.label.toLowerCase().includes(needle) || column.key.toLowerCase().includes(needle)) {
          columns.push({ datasetId: dataset.id, key: column.key, label: column.label });
        }
      }
      if (records.length >= 8) continue;
      const rows = await prisma.row.findMany({
        where: { datasetId: dataset.id, deletedAt: null },
        select: { id: true, data: true, position: true },
        orderBy: { position: "asc" },
        take: 400,
      });
      for (const row of rows) {
        if (records.length >= 8) break;
        const data = jsonRecord(row.data);
        const hit = projected.columns.find((column) => {
          if (!TEXT_TYPES.has(column.type)) return false;
          const value = data[column.key];
          return typeof value === "string" && value.toLowerCase().includes(needle);
        });
        if (!hit) continue;
        const customer = textField(data, projected.columns, "customer_name") || `Row ${row.position}`;
        const value = data[hit.key];
        records.push({
          datasetId: dataset.id,
          rowId: row.id,
          label: customer,
          hint: typeof value === "string" ? value : hit.label,
        });
      }
    }
  }
  return { pages, datasets: datasetHits, records, columns };
}

export async function datasetBoards(): Promise<
  Array<{
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
    updatedAt: string;
    uploadedByName: string;
    stages: Array<{ key: string; label: string; count: number }>;
  }>
> {
  const day = today();
  const datasets = await prisma.dataset.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
  const boards = [];
  for (const dataset of datasets) {
    const schema = parseDatasetSchema(dataset.schema);
    const rows = await prisma.row.findMany({
      where: { datasetId: dataset.id, deletedAt: null },
      select: {
        validated: true,
        validationDue: true,
        verified: true,
        endDate: true,
        amcStatus: true,
        nextDuePms: true,
      },
    });
    const snap = (row: (typeof rows)[number]) => ({
      validated: row.validated,
      due: dayOf(row.validationDue),
      verified: row.verified,
      end: dayOf(row.endDate),
      amc: row.amcStatus,
      pms: dayOf(row.nextDuePms),
    });
    boards.push({
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.rowCount,
      columnCount: schema ? schema.columns.filter((column) => column.deletedAt == null).length : 0,
      updatedAt: dataset.updatedAt.toISOString(),
      uploadedByName: dataset.uploadedBy.name,
      stages: [
        { key: "needs_validation", label: "To validate", count: rows.filter((row) => isNeedsValidation(row.validated)).length },
        {
          key: "pending_verification",
          label: "To verify",
          count: rows.filter((row) => isPendingVerification(row.validated, row.verified)).length,
        },
        {
          key: "amc_due",
          label: "AMC due",
          count: rows.filter((row) => isAmcDue({ endDate: snap(row).end, amcStatus: snap(row).amc, verified: snap(row).verified, today: day })).length,
        },
        {
          key: "pms_overdue",
          label: "PMS overdue",
          count: rows.filter((row) => isPmsOverdue(snap(row).end, snap(row).pms, day)).length,
        },
      ],
    });
  }
  return boards;
}

async function cardsFor(
  actor: PublicUser,
  day: string,
  datasetId: string | null,
  rows: StoredRow[],
  openCalls: number,
  validatedTodayCount = 0,
): Promise<KpiCard[]> {
  const link = (tab: string) => (datasetId ? `/records/${datasetId}?tab=${tab}` : null);
  const count = (test: (row: StoredRow) => boolean) => rows.filter(test).length;
  const overdue = count((row) => isValidationOverdue(row.validated, dayOf(row.validationDue), day));
  const amc = count((row) => isAmcDue({ endDate: dayOf(row.endDate), amcStatus: row.amcStatus, verified: row.verified, today: day }));
  const pending = count((row) => isPendingVerification(row.validated, row.verified));
  if (actor.role === "admin") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUsers = await prisma.user.count({
      where: { active: true, OR: [{ lastSeenAt: { gte: since } }, { lastLoginAt: { gte: since } }] },
    });
    return [
      { key: "validation_overdue", label: "Validation overdue", value: overdue, hint: "Validated No and past the due date", href: link("validation_overdue") },
      { key: "amc_due", label: "AMC due", value: amc, hint: "Verified contracts ready for a proposal", href: link("amc_due") },
      { key: "pending_verification", label: "Pending verification", value: pending, hint: "Validated Yes and not yet verified", href: link("pending_verification") },
      { key: "active_users", label: "Active users", value: activeUsers, hint: "Signed in or seen in the last 24 hours", href: "/team" },
    ];
  }
  if (actor.role === "manager") {
    return [
      { key: "pending_verification", label: "Pending verification", value: pending, hint: "Waiting for a manager to verify", href: link("pending_verification") },
      { key: "validation_overdue", label: "Validation overdue", value: overdue, hint: "Still marked No after the due date", href: link("validation_overdue") },
      { key: "amc_due", label: "AMC due", value: amc, hint: "Expired warranty, verified, no proposal yet", href: link("amc_due") },
      { key: "open_calls", label: "Open service calls", value: openCalls, hint: "Calls that are still open", href: datasetId ? `/records/${datasetId}` : null },
    ];
  }
  if (actor.role === "validator") {
    const mine = rows.filter((row) => row.assignedValidatorId == null || row.assignedValidatorId === actor.id);
    return [
      { key: "needs_validation", label: "To validate", value: mine.filter((row) => isNeedsValidation(row.validated)).length, hint: "Blank validation on your queue", href: link("needs_validation") },
      { key: "validation_overdue", label: "Overdue", value: mine.filter((row) => isValidationOverdue(row.validated, dayOf(row.validationDue), day)).length, hint: "No, and the expected date has passed", href: link("validation_overdue") },
      { key: "validated_today", label: "Validated today", value: validatedTodayCount, hint: `Daily target ${DAILY_VALIDATION_TARGET}`, href: link("recent"), target: DAILY_VALIDATION_TARGET },
      { key: "sent_back", label: "Sent back", value: mine.filter((row) => row.verified === "Pending" && row.validated === "Yes").length, hint: "A manager asked for a recheck", href: link("pending_verification") },
    ];
  }
  return [
    { key: "pms_due_week", label: "PMS due this week", value: count((row) => isContractLive(dayOf(row.endDate), day) && isPmsDueSoon(dayOf(row.endDate), dayOf(row.nextDuePms), day, 7)), hint: "Live contracts due within 7 days", href: link("pms_due_week") },
    { key: "pms_overdue", label: "PMS overdue", value: count((row) => isPmsOverdue(dayOf(row.endDate), dayOf(row.nextDuePms), day)), hint: "Live contracts past the next PMS date", href: link("pms_overdue") },
    { key: "amc_due", label: "AMC due", value: amc, hint: "Verified expiries waiting on a proposal", href: link("amc_due") },
    { key: "followups_today", label: "Follow-ups today", value: count((row) => dayOf(row.nextFollowUp) === day), hint: "Next follow-up is today", href: link("followup_due") },
  ];
}

async function countValidatedToday(actorId: string, datasetId: string, day: string): Promise<number> {
  const logs = await prisma.activityLog.findMany({
    where: {
      datasetId,
      actorId,
      action: "action.validate",
      createdAt: { gte: startOfZonedDay(day), lt: endOfZonedDay(day) },
    },
    select: { actionId: true, toValue: true },
  });
  const ids = new Set<string>();
  for (const log of logs) {
    if (log.toValue === "Yes" && log.actionId) ids.add(log.actionId);
  }
  return ids.size;
}

async function openCallCount(datasetId: string, rows: StoredRow[]): Promise<number> {
  const calls = await prisma.serviceCall.findMany({
    where: { datasetId, status: "Open", deletedAt: null },
    select: { rowId: true },
  });
  const live = new Set(rows.map((row) => row.id));
  return calls.filter((call) => live.has(call.rowId)).length;
}

type OpenCall = { id: string; type: string; description: string };

async function datasetOpenCalls(datasetId: string): Promise<Map<string, OpenCall>> {
  const calls = await prisma.serviceCall.findMany({
    where: { datasetId, status: "Open", deletedAt: null },
    orderBy: { reportedAt: "desc" },
  });
  const map = new Map<string, OpenCall>();
  for (const call of calls) {
    if (!map.has(call.rowId)) map.set(call.rowId, { id: call.id, type: call.type, description: call.description });
  }
  return map;
}

function matchesQueue(queue: string, row: StoredRow, day: string, actor: PublicUser, slot?: "validator" | "service"): boolean {
  const end = dayOf(row.endDate);
  const due = dayOf(row.validationDue);
  const follow = dayOf(row.nextFollowUp);
  const pms = dayOf(row.nextDuePms);
  const amc = effectiveAmcStatus(row.amcStatus, isWarrantyExpired(end, day));
  if (queue === "verification") return isPendingVerification(row.validated, row.verified);
  if (queue === "amc_unverified") return isUnverifiedExpiry(end, row.verified, day);
  if (queue === "amc_due") return isAmcDue({ endDate: end, amcStatus: row.amcStatus, verified: row.verified, today: day });
  if (queue === "amc_proposal") return amc === "Proposal Sent";
  if (queue === "amc_acknowledged") return amc === "Acknowledged";
  if (queue === "amc_declined") return amc === "Declined";
  if (queue === "validation_overdue") return isValidationOverdue(row.validated, due, day);
  if (queue === "pms_overdue") return isPmsOverdue(end, pms, day);
  if (queue === "followup_overdue") return follow != null && follow < day;
  if (queue === "unassigned") {
    if (slot === "service") return row.assignedServiceId == null;
    return row.assignedValidatorId == null;
  }
  if (queue === "validate_queue") {
    const visible = row.assignedValidatorId == null || row.assignedValidatorId === actor.id || actor.role !== "validator";
    return visible && (isNeedsValidation(row.validated) || isValidationOverdue(row.validated, due, day));
  }
  if (queue === "rejected") return row.validated === "No";
  if (queue === "sent_back") return row.validated === "Yes" && row.verified === "Pending";
  if (queue === "agenda") return isContractLive(end, day) && pms != null;
  if (queue === "followups") return isFollowupDue(follow, day);
  return false;
}

function compareQueue(queue: string, left: StoredRow, right: StoredRow, day: string): number {
  if (queue === "validate_queue" || queue === "rejected") {
    const rank = (row: StoredRow) => (isValidationOverdue(row.validated, dayOf(row.validationDue), day) ? 0 : 1);
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    const leftDue = dayOf(left.validationDue) ?? "9999-99-99";
    const rightDue = dayOf(right.validationDue) ?? "9999-99-99";
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  }
  if (queue === "agenda" || queue === "pms_overdue") {
    const leftPms = dayOf(left.nextDuePms) ?? "9999-99-99";
    const rightPms = dayOf(right.nextDuePms) ?? "9999-99-99";
    if (leftPms !== rightPms) return leftPms < rightPms ? -1 : 1;
  }
  return left.position - right.position;
}

function toCard(
  row: StoredRow,
  columns: DatasetSchema["columns"],
  day: string,
  call: { id: string; type: string; description: string } | null,
): WorkCardItem {
  const data = jsonRecord(row.data);
  const end = dayOf(row.endDate);
  const pms = dayOf(row.nextDuePms);
  const warranty = warrantyLiveStatus(end, day);
  const amc = effectiveAmcStatus(row.amcStatus, isWarrantyExpired(end, day));
  const customer = textField(data, columns, "customer_name") || "Record";
  const equipment = textField(data, columns, "equipment") || labeled(data, columns, /equipment|instrument|model/i);
  const serial = textField(data, columns, "serial");
  const city = textField(data, columns, "city");
  const facts = [city, textField(data, columns, "contract_type"), end ? `Ends ${end}` : ""].filter(Boolean);
  return {
    rowId: row.id,
    version: row.version,
    customer,
    equipment,
    serial,
    summary: facts.slice(0, 3).join(" · "),
    phone: phoneOf(data, columns),
    email: emailOf(data, columns),
    address: textField(data, columns, "address") || labeled(data, columns, /address/i),
    city,
    contractType: textField(data, columns, "contract_type"),
    pills: [
      { label: warranty, tone: warranty === "Active" ? "emerald" : warranty === "Expiring" ? "amber" : warranty === "Expired" ? "ruby" : "stone" },
      { label: amc, tone: amc === "Acknowledged" ? "emerald" : amc === "AMC Due" || amc === "Proposal Sent" ? "amber" : amc === "Declined" ? "ruby" : "stone" },
      ...(row.validated ? [{ label: `Validated ${row.validated}`, tone: (row.validated === "Yes" ? "emerald" : "ruby") as Tone }] : []),
    ],
    scheduled: pms,
    pmsN: pmsNumber(data, columns, pms),
    pmsLabel: pmsNumber(data, columns, pms) ? `PMS ${pmsNumber(data, columns, pms)}` : null,
    bucket: bucketFor(end, pms, day),
    validationDue: dayOf(row.validationDue),
    callId: call?.id ?? null,
    callType: call?.type ?? null,
    callDescription: call?.description ?? null,
  };
}

function bucketFor(end: string | null, pms: string | null, day: string): WorkCardItem["bucket"] {
  if (!pms || !isContractLive(end, day)) return null;
  if (pms < day) return "overdue";
  if (pms === day) return "today";
  if (calendarDaysBetween(day, pms) <= 7) return "week";
  return "later";
}

function pmsNumber(data: Record<string, unknown>, columns: DatasetSchema["columns"], due: string | null): number | null {
  if (!due) return null;
  for (const column of columns) {
    const match = /^pms:(\d+)$/.exec(column.semantic ?? "") ?? /^pms:(\d+)$/.exec(column.key);
    if (!match?.[1]) continue;
    if (textField(data, columns, `pms:${match[1]}`) === due) return Number(match[1]);
  }
  return null;
}

function openFor(role: "validator" | "service", userId: string, row: StoredRow, day: string): boolean {
  if (role === "validator") {
    if (row.assignedValidatorId !== userId) return false;
    return isNeedsValidation(row.validated) || isValidationOverdue(row.validated, dayOf(row.validationDue), day) || row.verified === "Pending";
  }
  if (row.assignedServiceId !== userId) return false;
  const end = dayOf(row.endDate);
  return (
    isPmsOverdue(end, dayOf(row.nextDuePms), day) ||
    isPmsDueSoon(end, dayOf(row.nextDuePms), day) ||
    isFollowupDue(dayOf(row.nextFollowUp), day) ||
    isAmcDue({ endDate: end, amcStatus: row.amcStatus, verified: row.verified, today: day })
  );
}

function hasHistoricalPms(row: StoredRow, schema: DatasetSchema, day: string): boolean {
  const end = dayOf(row.endDate);
  if (!end || end >= day) return false;
  const data = jsonRecord(row.data);
  for (const column of schema.columns) {
    if (column.deletedAt) continue;
    const match = /^pms:(\d+)$/.exec(column.semantic ?? "") ?? /^pms:(\d+)$/.exec(column.key);
    if (!match?.[1]) continue;
    const scheduled = textField(data, schema.columns, `pms:${match[1]}`);
    if (!scheduled || scheduled === "NA" || scheduled >= day) continue;
    const done = textField(data, schema.columns, `pm_date:${match[1]}`);
    if (!done || done === "NA") return true;
  }
  return false;
}

async function loadRows(datasetId: string): Promise<{ schema: DatasetSchema; rows: StoredRow[] }> {
  const dataset = await prisma.dataset.findFirst({ where: { id: datasetId, deletedAt: null }, select: { schema: true } });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  const rows = await prisma.row.findMany({
    where: { datasetId, deletedAt: null },
    select: {
      id: true,
      position: true,
      version: true,
      data: true,
      validated: true,
      validationDue: true,
      verified: true,
      endDate: true,
      amcStatus: true,
      nextFollowUp: true,
      nextDuePms: true,
      assignedValidatorId: true,
      assignedServiceId: true,
    },
  });
  return { schema, rows };
}

async function allLiveRows(): Promise<StoredRow[]> {
  return prisma.row.findMany({
    where: { deletedAt: null, dataset: { deletedAt: null } },
    select: {
      id: true,
      position: true,
      version: true,
      data: true,
      validated: true,
      validationDue: true,
      verified: true,
      endDate: true,
      amcStatus: true,
      nextFollowUp: true,
      nextDuePms: true,
      assignedValidatorId: true,
      assignedServiceId: true,
    },
  });
}

function describe(action: string, columnKey: string | null): string {
  if (action === "cell.updated") return `Updated ${columnKey ?? "a field"}`;
  if (action === "action.validate") return "Validated a record";
  if (action === "action.verify") return "Verified a record";
  if (action === "action.amc") return "Updated AMC";
  if (action === "action.pms") return "Updated PMS";
  if (action === "action.followup") return "Updated a follow-up";
  if (action === "action.assign") return "Changed assignment";
  if (action === "call.logged") return "Logged a service call";
  if (action === "call.resolved") return "Resolved a service call";
  if (action === "dataset.imported") return "Imported a dataset";
  if (action === "dataset.merged") return "Merged a workbook";
  if (action === "dataset.deleted") return "Deleted a dataset";
  if (action === "dataset.restored") return "Restored a dataset";
  if (action === "row.created") return "Added a record";
  if (action === "row.deleted") return "Deleted a record";
  if (action === "row.restored") return "Restored a record";
  return action.replaceAll(".", " ");
}

function textField(data: Prisma.JsonValue | Record<string, unknown>, columns: DatasetSchema["columns"], semantic: string): string {
  const record = jsonRecord(data);
  const value = readField(record, columns, semantic);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function labeled(data: Record<string, unknown>, columns: DatasetSchema["columns"], pattern: RegExp): string {
  const column = columns.find((item) => pattern.test(item.label) || pattern.test(item.key));
  if (!column) return "";
  const value = data[column.key];
  return typeof value === "string" ? value.trim() : "";
}

function phoneOf(data: Record<string, unknown>, columns: DatasetSchema["columns"]): string | null {
  const semantic = textField(data, columns, "mobile");
  if (semantic) return semantic;
  const column = columns.find((item) => item.type === "phone");
  const value = column ? data[column.key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emailOf(data: Record<string, unknown>, columns: DatasetSchema["columns"]): string | null {
  const semantic = textField(data, columns, "email");
  if (semantic) return semantic;
  const column = columns.find((item) => item.type === "email");
  const value = column ? data[column.key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dayOf(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function assertLead(actor: PublicUser): void {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new AppError("FORBIDDEN", 403, "You do not have access to this.");
  }
}
