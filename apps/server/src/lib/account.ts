import type { Permissions, PublicUser, Role } from "@app/shared";
import { capabilitiesForRole, isRole, resolveGroupAccess } from "@app/shared";
import { Role as PrismaRole, type User } from "@prisma/client";
import { AppError } from "./errors";
import { prisma } from "./prisma";

const TO_PRISMA = {
  admin: PrismaRole.admin,
  manager: PrismaRole.manager,
  validator: PrismaRole.validator,
  service: PrismaRole.service,
} as const satisfies Record<Role, PrismaRole>;

export function toPrismaRole(role: Role): PrismaRole {
  return TO_PRISMA[role];
}

export function toSharedRole(role: string): Role {
  if (!isRole(role)) {
    throw new AppError("INTERNAL", 500, "Unknown role.");
  }
  return role;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: toSharedRole(user.role),
    active: user.active,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function permissionsFor(role: Role): Promise<Permissions> {
  const capabilities = capabilitiesForRole(role);
  if (role === "admin" || role === "manager") {
    return { capabilities, groupAccess: "all" };
  }
  const rows = await prisma.roleGroupAccess.findMany({
    where: { role: toPrismaRole(role) },
  });
  return {
    capabilities,
    groupAccess: resolveGroupAccess(
      role,
      rows.map((row) => ({
        role,
        groupKey: row.groupKey,
        canView: row.canView,
        canEdit: row.canEdit,
      })),
    ),
  };
}
