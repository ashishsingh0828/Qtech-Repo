import { randomUUID } from "node:crypto";
import type { PublicUser } from "@app/shared";
import type { Request, Response } from "express";
import type { DomainEvent } from "@app/shared";
import { onDomainEvent } from "../../lib/events";
import { logger } from "../../lib/logger";

type Client = {
  id: string;
  userId: string;
  res: Response;
};

const clients = new Map<string, Client>();
const byUser = new Map<string, Set<string>>();

const HEARTBEAT_MS = 25_000;

export function attachStream(user: PublicUser, req: Request, res: Response): void {
  const id = randomUUID();
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client: Client = { id, userId: user.id, res };
  clients.set(id, client);
  const bucket = byUser.get(user.id) ?? new Set<string>();
  bucket.add(id);
  byUser.set(user.id, bucket);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clients.delete(id);
    const current = byUser.get(user.id);
    current?.delete(id);
    if (current && current.size === 0) byUser.delete(user.id);
    if (!res.writableEnded) res.end();
  };

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) {
      close();
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch (error) {
      logger.error({ err: error }, "SSE heartbeat failed");
      close();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  try {
    res.write(": connected\n\n");
  } catch (error) {
    logger.error({ err: error }, "SSE connect write failed");
    close();
    return;
  }

  req.on("close", close);
  req.on("aborted", close);
  res.on("error", close);
  res.on("close", close);
}

export function closeUserStreams(userId: string): void {
  const ids = byUser.get(userId);
  if (!ids) return;
  for (const id of [...ids]) {
    const client = clients.get(id);
    if (!client) continue;
    clients.delete(id);
    try {
      client.res.end();
    } catch (error) {
      logger.error({ err: error }, "Failed to close SSE stream");
    }
  }
  byUser.delete(userId);
}

function broadcast(event: DomainEvent): void {
  const payload = clientPayload(event);
  const onlyUser = typeof event.userId === "string" ? event.userId : undefined;
  const targets = onlyUser ? usersClients(onlyUser) : [...clients.values()];
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of targets) {
    if (client.res.writableEnded) {
      clients.delete(client.id);
      continue;
    }
    try {
      client.res.write(body);
    } catch (error) {
      logger.error({ err: error }, "SSE write failed");
      clients.delete(client.id);
      const bucket = byUser.get(client.userId);
      bucket?.delete(client.id);
      if (bucket && bucket.size === 0) byUser.delete(client.userId);
    }
  }
}

function usersClients(userId: string): Client[] {
  const ids = byUser.get(userId);
  if (!ids) return [];
  const found: Client[] = [];
  for (const id of ids) {
    const client = clients.get(id);
    if (client) found.push(client);
  }
  return found;
}

function clientPayload(event: DomainEvent): { type: string; datasetId?: string; rowId?: string; actorName?: string } {
  const payload: { type: string; datasetId?: string; rowId?: string; actorName?: string } = { type: event.type };
  if (typeof event.datasetId === "string") payload.datasetId = event.datasetId;
  if (typeof event.rowId === "string") payload.rowId = event.rowId;
  if (event.type === "dataset.deleted" && typeof event.actorName === "string") payload.actorName = event.actorName;
  return payload;
}

onDomainEvent((event) => {
  try {
    broadcast(event);
  } catch (error) {
    logger.error({ err: error }, "SSE broadcast failed");
  }
});
