import { EXPIRING_DAYS, PMS_SOON_DAYS, TRASH_RETENTION_DAYS, isServerManagedField, parseDatasetSchema, type Role } from "@app/shared";
import { Prisma } from "@prisma/client";
import { schedule, type ScheduledTask } from "node-cron";
import { env } from "../../env";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { today } from "../../lib/time";
import { syncMirrorFields } from "../datasets/mirrors";
import { toJson } from "../notifications/payload";

const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  if (tasks.length > 0) return;
  const timezone = env.APP_TIMEZONE;
  tasks.push(
    schedule("0 9 * * *", () => void runJob("validation-overdue", validationOverdue), {
      timezone,
      noOverlap: true,
      name: "validation-overdue",
    }),
    schedule("5 9 * * *", () => void runJob("pms-due", pmsDue), {
      timezone,
      noOverlap: true,
      name: "pms-due",
    }),
    schedule("10 9 * * *", () => void runJob("followup-due", followupsDue), {
      timezone,
      noOverlap: true,
      name: "followup-due",
    }),
    schedule("15 9 * * *", () => void runJob("warranty-expiring", warrantyExpiring), {
      timezone,
      noOverlap: true,
      name: "warranty-expiring",
    }),
    schedule("0 2 * * *", () => void runJob("nightly-cleanup", nightlyCleanup), {
      timezone,
      noOverlap: true,
      name: "nightly-cleanup",
    }),
  );
}

export function stopScheduler(): void {
  for (const task of tasks) {
    void task.stop();
  }
  tasks.length = 0;
}

async function runJob(jobName: string, work: () => Promise<void>): Promise<void> {
  try {
    const claimed = await claimJob(jobName);
    if (!claimed) return;
    try {
      await work();
      await finishJob(jobName, "completed");
    } catch (error) {
      logger.error({ err: error, job: jobName }, "Scheduled job failed");
      await finishJob(jobName, "failed");
    }
  } catch (error) {
    logger.error({ err: error, job: jobName }, "Scheduled job could not start");
  }
}

async function claimJob(jobName: string): Promise<boolean> {
  try {
    await prisma.jobRun.create({
      data: { jobName, scope: "global", runDate: dayStamp(today()), status: "running" },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function finishJob(jobName: string, status: "completed" | "failed"): Promise<void> {
  await prisma.jobRun.updateMany({
    where: { jobName, scope: "global", runDate: dayStamp(today()) },
    data: { status, completedAt: new Date() },
  });
}

async function validationOverdue(): Promise<void> {
  const stamp = dayStamp(today());
  const rows = await prisma.row.findMany({
    where: {
      deletedAt: null,
      dataset: { deletedAt: null },
      validationDue: { lt: stamp },
      NOT: { validated: "Yes" },
    },
    select: { datasetId: true, assignedValidatorId: true },
  });
  if (rows.length === 0) return;
  const validators = await roleIds(["validator"]);
  const managers = await roleIds(["admin", "manager"]);
  for (const userId of validators) {
    const mine = rows.filter((row) => row.assignedValidatorId === userId || row.assignedValidatorId == null);
    const picked = busiest(mine);
    if (!picked) continue;
    await writeDigest([userId], {
      type: "validation-overdue",
      datasetId: picked.datasetId,
      tab: "validation_overdue",
      summary: `${picked.count} validation${picked.count === 1 ? "" : "s"} overdue`,
    });
  }
  const all = busiest(rows);
  if (all) {
    await writeDigest(managers, {
      type: "validation-overdue",
      datasetId: all.datasetId,
      tab: "validation_overdue",
      summary: `${all.count} validation${all.count === 1 ? "" : "s"} overdue`,
    });
  }
}

async function pmsDue(): Promise<void> {
  const stamp = dayStamp(today());
  const soon = plusDays(today(), PMS_SOON_DAYS);
  const rows = await prisma.row.findMany({
    where: {
      deletedAt: null,
      dataset: { deletedAt: null },
      nextDuePms: { not: null, lte: soon },
      OR: [{ endDate: null }, { endDate: { gte: stamp } }],
    },
    select: { datasetId: true },
  });
  const picked = busiest(rows);
  if (!picked) return;
  await writeDigest(await roleIds(["service"]), {
    type: "pms-due",
    datasetId: picked.datasetId,
    tab: "pms_overdue",
    summary: `${picked.count} PMS visit${picked.count === 1 ? "" : "s"} overdue or due soon`,
  });
}

async function followupsDue(): Promise<void> {
  const stamp = dayStamp(today());
  const rows = await prisma.row.findMany({
    where: {
      deletedAt: null,
      dataset: { deletedAt: null },
      nextFollowUp: stamp,
    },
    select: { datasetId: true },
  });
  const picked = busiest(rows);
  if (!picked) return;
  await writeDigest(await roleIds(["service"]), {
    type: "followup-due",
    datasetId: picked.datasetId,
    tab: "followup_due",
    summary: `${picked.count} follow-up${picked.count === 1 ? "" : "s"} due today`,
  });
}

async function warrantyExpiring(): Promise<void> {
  const stamp = dayStamp(today());
  const limit = plusDays(today(), EXPIRING_DAYS);
  const rows = await prisma.row.findMany({
    where: {
      deletedAt: null,
      dataset: { deletedAt: null },
      endDate: { gte: stamp, lte: limit },
    },
    select: { datasetId: true },
  });
  const picked = busiest(rows);
  if (!picked) return;
  await writeDigest(await roleIds(["service"]), {
    type: "warranty-expiring",
    datasetId: picked.datasetId,
    tab: "amc_due",
    summary: `${picked.count} warrant${picked.count === 1 ? "y" : "ies"} expiring`,
    priority: "normal",
  });
}

async function nightlyCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);
  let changed = false;
  const datasets = await prisma.dataset.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const dataset of datasets) {
    await purgeDataset(dataset.id);
    changed = true;
  }
  const rows = await prisma.row.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, datasetId: true },
  });
  const recount = new Set<string>();
  for (const row of rows) {
    await prisma.$transaction(async (tx) => {
      await tx.serviceCall.deleteMany({ where: { rowId: row.id } });
      await tx.activityLog.deleteMany({ where: { rowId: row.id } });
      await tx.notification.deleteMany({ where: { rowId: row.id } });
      await tx.row.delete({ where: { id: row.id } });
    });
    recount.add(row.datasetId);
    changed = true;
  }
  for (const datasetId of recount) {
    const rowCount = await prisma.row.count({ where: { datasetId, deletedAt: null } });
    await prisma.dataset.updateMany({ where: { id: datasetId }, data: { rowCount } });
  }
  const live = await prisma.dataset.findMany({
    where: { deletedAt: null },
    select: { id: true, schema: true },
  });
  for (const dataset of live) {
    const purged = await purgeSchemaTrash(dataset.id, dataset.schema, cutoff);
    if (purged) changed = true;
  }
  const notices = await prisma.notification.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } },
  });
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if (changed || notices.count > 0 || sessions.count > 0) {
    try {
      publishEvent({ type: "trash.purged" });
    } catch (error) {
      logger.error({ err: error }, "Failed to publish trash.purged");
    }
  }
}

async function purgeDataset(datasetId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.serviceCall.deleteMany({ where: { datasetId } });
    await tx.activityLog.deleteMany({ where: { datasetId } });
    await tx.notification.deleteMany({ where: { datasetId } });
    await tx.$executeRaw`DELETE FROM "OutboxEvent" WHERE payload::text LIKE ${`%${datasetId}%`}`;
    await tx.row.deleteMany({ where: { datasetId } });
    await tx.dataset.delete({ where: { id: datasetId } });
  });
}

async function purgeSchemaTrash(datasetId: string, raw: Prisma.JsonValue, cutoff: Date): Promise<boolean> {
  const schema = parseDatasetSchema(raw);
  if (!schema) return false;
  const expired = (stamp: string | null): boolean => {
    if (!stamp) return false;
    const time = new Date(stamp).getTime();
    return Number.isFinite(time) && time < cutoff.getTime();
  };
  const droppedGroups = new Set(schema.groups.filter((group) => expired(group.deletedAt)).map((group) => group.id));
  const droppedKeys = schema.columns
    .filter((column) => droppedGroups.has(column.groupId) || expired(column.deletedAt))
    .map((column) => column.key);
  if (droppedKeys.length === 0 && droppedGroups.size === 0) return false;
  const next = {
    ...schema,
    groups: schema.groups.filter((group) => !droppedGroups.has(group.id)),
    columns: schema.columns.filter((column) => !droppedGroups.has(column.groupId) && !expired(column.deletedAt)),
  };
  const strip = droppedKeys.filter((key) => !isServerManagedField(key));
  await prisma.$transaction(async (tx) => {
    await tx.dataset.update({
      where: { id: datasetId },
      data: { schema: next as unknown as Prisma.InputJsonValue },
    });
    if (strip.length === 0) return;
    const stored = await tx.row.findMany({ where: { datasetId }, select: { id: true, data: true } });
    for (const row of stored) {
      const data = jsonRecord(row.data);
      let touched = false;
      for (const key of strip) {
        if (key in data) {
          delete data[key];
          touched = true;
        }
      }
      if (!touched) continue;
      const synced = syncMirrorFields(data, next);
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
  }, { timeout: 120_000 });
  return true;
}

async function writeDigest(
  userIds: string[],
  input: { type: string; datasetId: string; tab: string; summary: string; priority?: "normal" | "high" },
): Promise<void> {
  const unique = [...new Set(userIds)];
  for (const userId of unique) {
    await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        priority: input.priority ?? "normal",
        datasetId: input.datasetId,
        actorName: "Qtech",
        params: toJson({
          template: "digest",
          summary: input.summary,
          link: `/records/${input.datasetId}?tab=${input.tab}`,
        }),
      },
    });
    try {
      publishEvent({ type: "notification", userId });
    } catch (error) {
      logger.error({ err: error }, "Failed to publish digest");
    }
  }
}

async function roleIds(roles: Role[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: roles } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

function busiest(rows: Array<{ datasetId: string }>): { datasetId: string; count: number } | null {
  if (rows.length === 0) return null;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.datasetId, (counts.get(row.datasetId) ?? 0) + 1);
  let datasetId = rows[0]?.datasetId ?? "";
  let count = 0;
  for (const [id, value] of counts) {
    if (value > count) {
      datasetId = id;
      count = value;
    }
  }
  if (!datasetId) return null;
  return { datasetId, count };
}

function dayStamp(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function plusDays(day: string, days: number): Date {
  const date = dayStamp(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}
