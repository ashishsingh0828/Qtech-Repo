import { UNDO_SECONDS } from "@app/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { type OutboxBody, toJson } from "./payload";

export async function enqueueOutbox(
  tx: Prisma.TransactionClient,
  body: OutboxBody,
  options: { actionId?: string; delay?: boolean } = {},
): Promise<void> {
  const runAt = options.delay ? new Date(Date.now() + UNDO_SECONDS * 1000) : new Date();
  await tx.outboxEvent.create({
    data: {
      kind: body.kind,
      payload: toJson(body),
      actorId: body.actorId,
      actionId: options.actionId,
      runAt,
    },
  });
}

export async function enqueueOutboxNow(body: OutboxBody, actionId?: string): Promise<void> {
  await prisma.$transaction((tx) => enqueueOutbox(tx, body, { actionId, delay: false }));
}

export async function cancelOutbox(tx: Prisma.TransactionClient, actionId: string): Promise<void> {
  await tx.outboxEvent.updateMany({
    where: { actionId, processedAt: null, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });
}
