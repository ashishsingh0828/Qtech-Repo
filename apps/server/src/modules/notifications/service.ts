import type { PublicUser } from "@app/shared";
import { permissionsFor } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { projectNotice } from "./summary";

export type NotificationItem = {
  id: string;
  type: string;
  priority: "normal" | "high";
  summary: string;
  actorName: string;
  createdAt: string;
  read: boolean;
  href: string | null;
};

export async function listNotifications(
  actor: PublicUser,
  input: { limit?: number; before?: string },
): Promise<{ unreadCount: number; hasHigh: boolean; items: NotificationItem[] }> {
  const limit = input.limit ?? 30;
  const parsedBefore = input.before ? new Date(input.before) : undefined;
  if (parsedBefore && Number.isNaN(parsedBefore.getTime())) {
    throw new AppError("VALIDATION", 400, "Invalid request");
  }
  const before = parsedBefore;
  const [unreadCount, high, rows] = await Promise.all([
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null, priority: "high" } }),
    prisma.notification.findMany({
      where: {
        userId: actor.id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  const permissions = await permissionsFor(actor.role);
  return {
    unreadCount,
    hasHigh: high > 0,
    items: rows.map((row) => {
      const projected = projectNotice(row.params, permissions);
      const focus = projected.focusKeys.join(",");
      const rowHref = row.datasetId && row.rowId
        ? `/records/${row.datasetId}?row=${row.rowId}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`
        : null;
      return {
        id: row.id,
        type: row.type,
        priority: row.priority,
        summary: projected.summary,
        actorName: row.actorName,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt != null,
        href: rowHref ?? projected.href ?? (row.datasetId ? `/records/${row.datasetId}` : null),
      };
    }),
  };
}

export async function markNotificationRead(actor: PublicUser, id: string): Promise<void> {
  const row = await prisma.notification.findFirst({ where: { id, userId: actor.id }, select: { id: true, readAt: true } });
  if (!row) throw new AppError("NOT_FOUND", 404, "Notification not found.");
  if (row.readAt) return;
  await prisma.notification.update({ where: { id: row.id }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(actor: PublicUser): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
}
