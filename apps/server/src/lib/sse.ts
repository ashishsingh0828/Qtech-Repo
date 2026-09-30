import { randomUUID } from "node:crypto";
import type { DomainEvent, Permissions, Role } from "@app/shared";
import { canViewGroup } from "@app/shared";
import type { Request, Response } from "express";
import { permissionsFor, toSharedRole } from "./account";
import { onDomainEvent } from "./events";
import { logger } from "./logger";
import { prisma } from "./prisma";

const HEARTBEAT_MS = 25_000;

type Client = {
  id: string;
  userId: string;
  role: Role;
  permissions: Permissions;
  res: Response;
  heartbeat: NodeJS.Timeout;
  closed: boolean;
};

const clients = new Map<string, Client>();

let subscribed = false;

export function attachSse(req: Request, res: Response, userId: string, role: Role, permissions: Permissions): void {
  ensureSubscribed();
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.setTimeout(0);

  const id = randomUUID();
  const client: Client = {
    id,
    userId,
    role,
    permissions,
    res,
    heartbeat: setInterval(() => {
      void beat(id);
    }, HEARTBEAT_MS),
    closed: false,
  };
  client.heartbeat.unref();
  clients.set(id, client);
  void permissionsFor(role)
    .then((permissions) => {
      const current = clients.get(id);
      if (current) current.permissions = permissions;
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "Failed to load SSE permissions");
      release(id);
    });

  const close = (): void => release(id);
  req.on("close", close);
  req.on("aborted", close);
  res.on("error", close);
  res.on("close", close);
  if (!write(res, ": heartbeat\n\n")) release(id);
}

export function drainSse(): void {
  for (const id of [...clients.keys()]) release(id);
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  onDomainEvent((event) => {
    for (const client of clients.values()) {
      const payload = projectEvent(event, client.permissions);
      if (!payload) continue;
      if (!write(client.res, `data: ${JSON.stringify(payload)}\n\n`)) release(client.id);
    }
  });
}

async function beat(id: string): Promise<void> {
  const client = clients.get(id);
  if (!client || client.closed) return;
  try {
    const user = await prisma.user.findUnique({
      where: { id: client.userId },
      select: { active: true, role: true },
    });
    if (!user?.active) {
      release(id);
      return;
    }
    client.role = toSharedRole(user.role);
    client.permissions = await permissionsFor(client.role);
  } catch (error) {
    logger.error({ err: error }, "SSE heartbeat auth check failed");
  }
  if (!write(client.res, ": heartbeat\n\n")) release(id);
}

function release(id: string): void {
  const client = clients.get(id);
  if (!client || client.closed) return;
  client.closed = true;
  clearInterval(client.heartbeat);
  clients.delete(id);
  if (!client.res.writableEnded) {
    client.res.end();
  }
}

function write(res: Response, chunk: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    return res.write(chunk);
  } catch (error) {
    logger.error({ err: error }, "SSE write failed");
    return false;
  }
}

function projectEvent(event: DomainEvent, permissions: Permissions): DomainEvent | null {
  const group = groupForEvent(event.type);
  if (group === "calls") {
    const visible =
      canViewGroup(permissions.groupAccess, "complaint") || canViewGroup(permissions.groupAccess, "breakdown_calls");
    if (!visible) return null;
  } else if (group && !canViewGroup(permissions.groupAccess, group)) {
    return null;
  }
  const payload: DomainEvent = { type: event.type };
  if (typeof event.datasetId === "string") payload.datasetId = event.datasetId;
  if (typeof event.rowId === "string") payload.rowId = event.rowId;
  if (typeof event.actionId === "string") payload.actionId = event.actionId;
  return payload;
}

function groupForEvent(type: string): string | null {
  if (type === "action.validate" || type === "action.verify") return "data_validation";
  if (type === "action.amc") return "amc";
  if (type === "action.pms") return "schedule_services";
  if (type === "action.followup") return "follow_up";
  if (type === "call.logged" || type === "call.resolved") return "calls";
  return null;
}
