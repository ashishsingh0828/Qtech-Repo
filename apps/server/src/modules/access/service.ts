import { randomUUID } from "node:crypto";
import type { PublicUser } from "@app/shared";
import {
  CANONICAL_GROUPS,
  isGroupKeySlug,
  labelForGroupKey,
  normalizeAccess,
} from "@app/shared";
import { Prisma } from "@prisma/client";
import { toPrismaRole, toSharedRole } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AccessRowInput } from "./schema";

export type AccessGroup = {
  groupKey: string;
  label: string;
};

export type AccessRow = {
  role: "validator" | "service";
  groupKey: string;
  canView: boolean;
  canEdit: boolean;
};

export type AccessMatrix = {
  groups: AccessGroup[];
  rows: AccessRow[];
};

const CANONICAL_KEYS = new Set<string>(CANONICAL_GROUPS.map((group) => group.groupKey));

export async function getAccessMatrix(): Promise<AccessMatrix> {
  const [stored, datasets] = await Promise.all([
    prisma.roleGroupAccess.findMany(),
    prisma.dataset.findMany({
      where: { deletedAt: null },
      select: { schema: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const labels = new Map<string, string>(CANONICAL_GROUPS.map((group) => [group.groupKey, group.label]));
  const extras = new Set<string>();
  const overridden = new Set<string>();

  for (const dataset of datasets) {
    walkSchema(dataset.schema, (groupKey, label) => {
      if (!isGroupKeySlug(groupKey)) return;
      if (!CANONICAL_KEYS.has(groupKey)) extras.add(groupKey);
      if (!labels.has(groupKey)) labels.set(groupKey, label ?? labelForGroupKey(groupKey));
      if (label && !overridden.has(groupKey)) {
        labels.set(groupKey, label);
        overridden.add(groupKey);
      }
    });
  }

  const groups: AccessGroup[] = [
    ...CANONICAL_GROUPS.map((group) => ({
      groupKey: group.groupKey,
      label: labels.get(group.groupKey) ?? group.label,
    })),
    ...[...extras]
      .sort((left, right) => left.localeCompare(right))
      .map((groupKey) => ({
        groupKey,
        label: labels.get(groupKey) ?? labelForGroupKey(groupKey),
      })),
  ];

  const rows: AccessRow[] = [];
  for (const row of stored) {
    const role = toSharedRole(row.role);
    if (role !== "validator" && role !== "service") continue;
    rows.push({
      role,
      groupKey: row.groupKey,
      canView: row.canView,
      canEdit: row.canEdit,
    });
  }
  rows.sort((left, right) => left.role.localeCompare(right.role) || left.groupKey.localeCompare(right.groupKey));

  return { groups, rows };
}

export async function replaceAccess(actor: PublicUser, input: AccessRowInput[]): Promise<AccessMatrix> {
  const normalized: AccessRow[] = [];
  const seen = new Set<string>();
  for (const row of input) {
    if (row.role !== "validator" && row.role !== "service") {
      throw new AppError("VALIDATION", 400, "Access rows can only target validator or service.");
    }
    if (!isGroupKeySlug(row.groupKey)) {
      throw new AppError("VALIDATION", 400, "Invalid group key.");
    }
    const key = `${row.role}\u0000${row.groupKey}`;
    if (seen.has(key)) {
      throw new AppError("VALIDATION", 400, "Duplicate access row.");
    }
    seen.add(key);
    const access = normalizeAccess(row.canView, row.canEdit);
    normalized.push({
      role: row.role,
      groupKey: row.groupKey,
      canView: access.canView,
      canEdit: access.canEdit,
    });
  }

  const actionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    const previous = await tx.roleGroupAccess.findMany();
    await tx.roleGroupAccess.deleteMany();
    if (normalized.length > 0) {
      await tx.roleGroupAccess.createMany({
        data: normalized.map((row) => ({
          role: toPrismaRole(row.role),
          groupKey: row.groupKey,
          canView: row.canView,
          canEdit: row.canEdit,
        })),
      });
    }
    await tx.activityLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        action: "access.changed",
        actionId,
        fromValue: previous.map((row) => ({
          role: row.role,
          groupKey: row.groupKey,
          canView: row.canView,
          canEdit: row.canEdit,
        })) as Prisma.InputJsonValue,
        toValue: normalized.map((row) => ({
          role: row.role,
          groupKey: row.groupKey,
          canView: row.canView,
          canEdit: row.canEdit,
        })) as Prisma.InputJsonValue,
      },
    });
  });

  try {
    publishEvent({ type: "access.changed", actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, "Failed to publish access.changed");
  }

  return getAccessMatrix();
}

function walkSchema(value: unknown, visit: (groupKey: string, label: string | undefined) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkSchema(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.groupKey === "string") {
    const label = typeof record.label === "string" && record.label.trim().length > 0 ? record.label.trim() : undefined;
    visit(record.groupKey, label);
  }
  for (const child of Object.values(record)) {
    if (typeof child === "object" && child !== null) walkSchema(child, visit);
  }
}
