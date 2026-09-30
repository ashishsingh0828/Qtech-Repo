import { TRASH_RETENTION_DAYS } from "@app/shared";
import { Prisma } from "@prisma/client";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "../env";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { today } from "./time";

const tasks: ScheduledTask[] = [];

export function startJobs(): void {
  if (tasks.length > 0) return;
  const task = cron.schedule(
    "0 9 * * *",
    () => {
      void runTrashRetention();
    },
    { timezone: env.APP_TIMEZONE },
  );
  tasks.push(task);
  void runTrashRetention();
}

export function stopJobs(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

async function runTrashRetention(): Promise<void> {
  const runDate = new Date(`${today()}T00:00:00.000Z`);
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.jobRun.create({
          data: { jobName: "trash.retention", runDate, scope: "global" },
        });
        await purgeExpiredTrash(tx);
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    logger.error({ err: error }, "Scheduled trash retention failed");
  }
}

async function purgeExpiredTrash(tx: Prisma.TransactionClient): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);
  const datasets = await tx.dataset.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const dataset of datasets) {
    await deleteDatasetGraph(tx, dataset.id);
  }
  const rows = await tx.row.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, datasetId: true },
  });
  const datasetsTouched = new Set<string>();
  for (const row of rows) {
    await deleteRowGraph(tx, row.id);
    datasetsTouched.add(row.datasetId);
  }
  for (const datasetId of datasetsTouched) {
    const stillThere = await tx.dataset.findUnique({ where: { id: datasetId }, select: { id: true } });
    if (!stillThere) continue;
    const rowCount = await tx.row.count({ where: { datasetId, deletedAt: null } });
    await tx.dataset.update({ where: { id: datasetId }, data: { rowCount } });
  }
}

async function deleteDatasetGraph(tx: Prisma.TransactionClient, datasetId: string): Promise<void> {
  await tx.serviceCall.deleteMany({ where: { datasetId } });
  await tx.activityLog.deleteMany({ where: { datasetId } });
  await tx.notification.deleteMany({ where: { datasetId } });
  await tx.$executeRaw`DELETE FROM "OutboxEvent" WHERE payload::text LIKE ${`%${datasetId}%`}`;
  await tx.row.deleteMany({ where: { datasetId } });
  await tx.dataset.delete({ where: { id: datasetId } });
}

async function deleteRowGraph(tx: Prisma.TransactionClient, rowId: string): Promise<void> {
  await tx.serviceCall.deleteMany({ where: { rowId } });
  await tx.activityLog.deleteMany({ where: { rowId } });
  await tx.notification.deleteMany({ where: { rowId } });
  await tx.$executeRaw`DELETE FROM "OutboxEvent" WHERE payload::text LIKE ${`%${rowId}%`}`;
  await tx.row.delete({ where: { id: rowId } });
}
