import { NOTIFY_MERGE_SECONDS, type Role, isAmcDue } from "@app/shared";
import type { Prisma} from "@prisma/client";
import { type Priority } from "@prisma/client";
import { toSharedRole } from "../../lib/account";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { today } from "../../lib/time";
import { type FieldChange, type OutboxBody, readBody, readFields, toJson } from "./payload";

const POLL_MS = 2_000;
const LEASE_MINUTES = 5;
const MAX_ATTEMPTS = 3;

type Claimed = {
  id: string;
  kind: string;
  payload: Prisma.JsonValue;
  actorId: string | null;
  actionId: string | null;
  attempts: number;
};

type Delivery = {
  userId: string;
  type: string;
  priority: Priority;
  template: string;
  fields?: FieldChange[];
  reason?: string;
  note?: string;
  datasetName?: string;
  newRows?: number;
  updatedRows?: number;
  summary?: string;
  link?: string;
  merge: boolean;
};

let timer: NodeJS.Timeout | undefined;
let ticking = false;

export function startOutboxWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void tick().finally(() => {
      ticking = false;
    });
  }, POLL_MS);
  timer.unref();
}

export function stopOutboxWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

async function tick(): Promise<void> {
  try {
    const claimed = await claim();
    for (const event of claimed) {
      await processClaim(event);
    }
  } catch (error) {
    logger.error({ err: error }, "Outbox poll failed");
  }
}

async function claim(): Promise<Claimed[]> {
  return prisma.$transaction(async (tx) => {
    return tx.$queryRaw<Claimed[]>`
      UPDATE "OutboxEvent" AS o
      SET attempts = o.attempts + 1,
          "runAt" = NOW() + (${LEASE_MINUTES} * INTERVAL '1 minute')
      FROM (
        SELECT id
        FROM "OutboxEvent"
        WHERE "runAt" <= NOW()
          AND "processedAt" IS NULL
          AND "cancelledAt" IS NULL
          AND "failedAt" IS NULL
        ORDER BY "runAt"
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      ) AS picked
      WHERE o.id = picked.id
      RETURNING o.id, o.kind, o.payload, o."actorId", o."actionId", o.attempts
    `;
  });
}

async function processClaim(event: Claimed): Promise<void> {
  try {
    const body = readBody(event.payload);
    if (body) await dispatch(body);
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Outbox processing failed";
    logger.error({ err: error, outboxId: event.id }, "Outbox event failed");
    if (event.attempts >= MAX_ATTEMPTS) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { failedAt: new Date(), processedAt: new Date(), lastError: message },
      });
      return;
    }
    const delay = 2 ** event.attempts * 1000;
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { runAt: new Date(Date.now() + delay), lastError: message },
    });
  }
}

async function dispatch(body: OutboxBody): Promise<void> {
  if (body.kind === "cell.updated" || body.kind === "row.action") {
    await dispatchRow(body);
    return;
  }
  if (body.kind === "access.changed") {
    await notifyRoles(body);
    return;
  }
  if (body.kind === "bulk") {
    await dispatchBulk(body);
    return;
  }
  if (body.audience === "all" || body.kind === "import" || body.kind.startsWith("dataset.")) {
    await notifyUsers(await activeUserIds(), body, deliveryForBroadcast(body));
    return;
  }
  await notifyUsers(await roleIds(["admin", "manager"]), body, deliveryForBroadcast(body));
}

async function dispatchRow(body: OutboxBody): Promise<void> {
  const role = await actorRole(body);
  const row = body.datasetId && body.rowId
    ? await prisma.row.findFirst({
        where: { id: body.rowId, datasetId: body.datasetId },
        select: {
          assignedValidatorId: true,
          assignedServiceId: true,
          data: true,
          verified: true,
          endDate: true,
          amcStatus: true,
          deletedAt: true,
        },
      })
    : null;
  const customer = customerName(row?.data ?? null);
  const deliveries = new Map<string, Delivery>();
  const add = (userIds: string[], delivery: Omit<Delivery, "userId">) => {
    for (const userId of userIds) {
      if (!userId || userId === body.actorId) continue;
      if (!deliveries.has(userId)) deliveries.set(userId, { ...delivery, userId });
    }
  };

  const managers = await roleIds(["admin", "manager"]);
  const specific = await specificDeliveries(body, row, role);
  if (specific.length > 0) {
    for (const item of specific) add(item.userIds, item.delivery);
  } else if (role === "validator" || role === "service") {
    add(managers, fieldDelivery(body));
  } else if (row && row.deletedAt == null) {
    const assignees = [row.assignedValidatorId, row.assignedServiceId].filter((id): id is string => Boolean(id));
    add(assignees, fieldDelivery(body));
  }

  for (const delivery of deliveries.values()) {
    await deliver(body, delivery, customer);
  }
}

async function specificDeliveries(
  body: OutboxBody,
  row: {
    assignedValidatorId: string | null;
    assignedServiceId: string | null;
    verified: string | null;
    endDate: Date | null;
    amcStatus: string | null;
  } | null,
  role: Role,
): Promise<Array<{ userIds: string[]; delivery: Omit<Delivery, "userId"> }>> {
  const managers = await roleIds(["admin", "manager"]);
  const items: Array<{ userIds: string[]; delivery: Omit<Delivery, "userId"> }> = [];
  if (body.kind !== "row.action") return items;

  if (role === "validator" && body.validateResult === "Yes") {
    items.push({ userIds: managers, delivery: { type: "ready", priority: "normal", template: "ready", merge: false } });
  }
  if (role === "validator" && body.validateResult === "No") {
    items.push({
      userIds: managers,
      delivery: { type: "rejected", priority: "high", template: "rejected", reason: body.reason, merge: false },
    });
  }
  if ((role === "admin" || role === "manager") && body.verifiedOk === true && row && amcEligible(row)) {
    const serviceIds = row.assignedServiceId ? [row.assignedServiceId] : await roleIds(["service"]);
    items.push({ userIds: serviceIds, delivery: { type: "amc", priority: "high", template: "amc", merge: false } });
    const validatorId = await validatingUser(body);
    if (validatorId) {
      items.push({ userIds: [validatorId], delivery: { type: "verified", priority: "normal", template: "verified", merge: false } });
    }
  }
  if ((role === "admin" || role === "manager") && body.verifiedOk === false && row?.assignedValidatorId) {
    items.push({
      userIds: [row.assignedValidatorId],
      delivery: { type: "recheck", priority: "high", template: "recheck", note: body.note, merge: false },
    });
  }
  if (role === "service" && (body.amcAction === "proposal_sent" || body.amcAction === "acknowledge" || body.amcAction === "decline")) {
    items.push({ userIds: managers, delivery: fieldDelivery(body) });
  }
  if (body.callEvent === "opened" || body.callEvent === "resolved") {
    items.push({
      userIds: managers,
      delivery: {
        type: "call",
        priority: "normal",
        template: "call",
        summary: body.callEvent === "opened" ? "Service call opened" : "Service call resolved",
        merge: false,
      },
    });
  }
  const assigned = [body.newValidatorId, body.newServiceId].filter((id): id is string => typeof id === "string" && id.length > 0);
  if (body.action === "assign" && assigned.length > 0) {
    items.push({ userIds: assigned, delivery: { type: "assigned", priority: "normal", template: "assigned", merge: false } });
  }
  return items;
}

function fieldDelivery(body: OutboxBody): Omit<Delivery, "userId"> {
  return {
    type: "fields",
    priority: "normal",
    template: "fields",
    fields: body.fields ?? [],
    merge: true,
  };
}

async function dispatchBulk(body: OutboxBody): Promise<void> {
  const count = body.count ?? 0;
  if (count <= 0) return;
  const summary = body.summary || `${count} rows updated`;
  const managers = await roleIds(["admin", "manager"]);
  await notifyUsers(managers, body, {
    type: "bulk",
    priority: "normal",
    template: "bulk",
    summary,
    merge: false,
  });
  if (body.action === "assign") {
    const assigned = [body.newValidatorId, body.newServiceId].filter((id): id is string => typeof id === "string" && id.length > 0);
    await notifyUsers(assigned, body, {
      type: "assigned",
      priority: "normal",
      template: "assigned",
      summary: count === 1 ? "Assigned to you" : `Assigned to you (${count} rows)`,
      merge: false,
    });
  }
}

async function notifyRoles(body: OutboxBody): Promise<void> {
  const roles = (body.roles ?? []).filter((role): role is Role => role === "validator" || role === "service" || role === "manager" || role === "admin");
  if (roles.length === 0) return;
  await notifyUsers(await roleIds(roles), body, {
    type: "access",
    priority: "normal",
    template: "access",
    merge: false,
  });
}

function deliveryForBroadcast(body: OutboxBody): Omit<Delivery, "userId"> {
  if (body.kind === "import") {
    return {
      type: "import",
      priority: "normal",
      template: "import",
      datasetName: body.datasetName,
      newRows: body.newRows ?? 0,
      updatedRows: body.updatedRows ?? 0,
      merge: false,
    };
  }
  return {
    type: body.kind,
    priority: "normal",
    template: body.kind,
    summary: body.summary,
    datasetName: body.datasetName,
    merge: false,
  };
}

async function notifyUsers(userIds: string[], body: OutboxBody, delivery: Omit<Delivery, "userId">): Promise<void> {
  const unique = [...new Set(userIds)].filter((id) => id !== body.actorId);
  for (const userId of unique) {
    await deliver(body, { ...delivery, userId }, null);
  }
}

async function deliver(body: OutboxBody, delivery: Delivery, customer: string | null): Promise<void> {
  if (delivery.userId === body.actorId) return;
  const params = toJson({
    kind: "notice",
    actorId: body.actorId,
    actorName: body.actorName,
    template: delivery.template,
    fields: delivery.fields,
    reason: delivery.reason,
    note: delivery.note,
    datasetName: delivery.datasetName ?? body.datasetName,
    newRows: delivery.newRows,
    updatedRows: delivery.updatedRows,
    summary: delivery.summary ?? body.summary,
    link: delivery.link,
  });
  if (delivery.merge && body.rowId) {
    const since = new Date(Date.now() - NOTIFY_MERGE_SECONDS * 1000);
    const existing = await prisma.notification.findFirst({
      where: {
        userId: delivery.userId,
        actorId: body.actorId,
        rowId: body.rowId,
        type: "fields",
        readAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const fields = mergeFields(readFields(paramsRecord(existing.params).fields), delivery.fields ?? []);
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          params: toJson({ ...paramsRecord(existing.params), template: "fields", fields }),
          createdAt: new Date(),
          priority: existing.priority === "high" || delivery.priority === "high" ? "high" : "normal",
        },
      });
      publishNotice(delivery.userId);
      return;
    }
  }
  await prisma.notification.create({
    data: {
      userId: delivery.userId,
      type: delivery.type,
      priority: delivery.priority,
      datasetId: body.datasetId,
      rowId: body.rowId,
      actorId: body.actorId,
      actorName: body.actorName,
      customerName: customer,
      params,
    },
  });
  publishNotice(delivery.userId);
}

function publishNotice(userId: string): void {
  try {
    publishEvent({ type: "notification", userId });
  } catch (error) {
    logger.error({ err: error }, "Failed to publish notification");
  }
}

function mergeFields(current: FieldChange[], incoming: FieldChange[]): FieldChange[] {
  const map = new Map(current.map((field) => [field.key, field]));
  for (const field of incoming) map.set(field.key, field);
  return [...map.values()];
}

function paramsRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...value };
}

async function actorRole(body: OutboxBody): Promise<Role> {
  if (body.actorRole) return body.actorRole;
  const user = await prisma.user.findUnique({ where: { id: body.actorId }, select: { role: true } });
  return user ? toSharedRole(user.role) : "admin";
}

async function roleIds(roles: Role[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: roles } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

async function activeUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
  return users.map((user) => user.id);
}

async function validatingUser(body: OutboxBody): Promise<string | null> {
  if (!body.datasetId || !body.rowId) return null;
  const log = await prisma.activityLog.findFirst({
    where: { datasetId: body.datasetId, rowId: body.rowId, action: "action.validate", actorId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { actorId: true },
  });
  return log?.actorId ?? null;
}

function amcEligible(row: { verified: string | null; endDate: Date | null; amcStatus: string | null }): boolean {
  return isAmcDue({
    endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
    amcStatus: row.amcStatus,
    verified: row.verified,
    today: today(),
  });
}

function customerName(data: Prisma.JsonValue | null): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const value = data.customer_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
