import { NOTIFY_MERGE_SECONDS, type DomainEvent } from "@app/shared";
import { Prisma } from "@prisma/client";
import { logger } from "./logger";
import { prisma } from "./prisma";

const POLL_MS = 2_000;
const MAX_ATTEMPTS = 5;

let timer: NodeJS.Timeout | null = null;
let polling = false;

export function startOutboxWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void pollOutbox();
  }, POLL_MS);
  timer.unref();
}

export function stopOutboxWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function enqueueOutbox(event: DomainEvent): Promise<void> {
  const delay = event.type === "dataset.merged" ? NOTIFY_MERGE_SECONDS * 1000 : 0;
  await prisma.outboxEvent.create({
    data: {
      kind: event.type,
      payload: eventPayload(event),
      actorId: typeof event.actorId === "string" ? event.actorId : null,
      actionId: typeof event.actionId === "string" ? event.actionId : null,
      runAt: new Date(Date.now() + delay),
    },
  });
}

async function pollOutbox(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (let count = 0; count < 20; count += 1) {
      const claimed = await claimOne();
      if (!claimed) break;
    }
  } catch (error) {
    logger.error({ err: error }, "Outbox poll failed");
  } finally {
    polling = false;
  }
}

async function claimOne(): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; kind: string; payload: Prisma.JsonValue }>>`
      SELECT id, kind, payload
      FROM "OutboxEvent"
      WHERE "processedAt" IS NULL
        AND "cancelledAt" IS NULL
        AND "runAt" <= NOW()
      ORDER BY "runAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return false;
    try {
      acceptEvent(row.kind, row.payload);
      await tx.outboxEvent.update({
        where: { id: row.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      logger.error({ err: error, id: row.id }, "Outbox handler failed");
      const attempts = readAttempts(row.payload) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: { cancelledAt: new Date() },
        });
      } else {
        const delay = Math.min(60_000, 1_000 * 2 ** attempts);
        await tx.outboxEvent.update({
          where: { id: row.id },
          data: {
            runAt: new Date(Date.now() + delay),
            payload: withAttempts(row.payload, attempts),
          },
        });
      }
    }
    return true;
  });
}

function acceptEvent(kind: string, payload: Prisma.JsonValue): void {
  if (!kind.trim()) throw new Error("Outbox event is missing a kind");
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Outbox payload is invalid");
  }
}

function eventPayload(event: DomainEvent): Prisma.InputJsonValue {
  const payload: Record<string, string> = { type: event.type };
  if (typeof event.datasetId === "string") payload.datasetId = event.datasetId;
  if (typeof event.rowId === "string") payload.rowId = event.rowId;
  if (typeof event.actorId === "string") payload.actorId = event.actorId;
  if (typeof event.actionId === "string") payload.actionId = event.actionId;
  return payload;
}

function readAttempts(payload: Prisma.JsonValue): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;
  const value = payload.attempts;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function withAttempts(payload: Prisma.JsonValue, attempts: number): Prisma.InputJsonValue {
  const base: Record<string, Prisma.InputJsonValue> = {};
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (key === "attempts" || value === null) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") base[key] = value;
    }
  }
  base.attempts = attempts;
  return base;
}
