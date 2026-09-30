import type { PublicUser, Role } from "@app/shared";
import { Prisma, Role as PrismaRole } from "@prisma/client";
import { toPrismaRole, toPublicUser, toSharedRole } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { deleteUserSessions } from "../../lib/session";

const EMAIL_CONFLICT = "A user with this email already exists.";

export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  return users.map(toPublicUser);
}

export async function createUser(input: {
  name: string;
  email: string;
  role: Role;
  password: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("CONFLICT", 409, EMAIL_CONFLICT);
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: toPrismaRole(input.role),
        active: true,
      },
    });
    return toPublicUser(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", 409, EMAIL_CONFLICT);
    }
    throw error;
  }
}

export async function updateUser(
  actorId: string,
  userId: string,
  input: { name?: string; role?: Role; active?: boolean },
): Promise<PublicUser> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw new AppError("NOT_FOUND", 404, "User not found.");
    }

    const currentRole = toSharedRole(target.role);
    const nextRole = input.role ?? currentRole;
    const nextActive = input.active ?? target.active;
    const roleChanged = input.role !== undefined && input.role !== currentRole;
    const deactivating = input.active === false && target.active;
    const removesActiveAdmin =
      target.role === PrismaRole.admin && target.active && (nextRole !== "admin" || !nextActive);

    if (removesActiveAdmin) {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE role::text = 'admin' AND active = true FOR UPDATE
      `;
      const others = await tx.user.count({
        where: { role: PrismaRole.admin, active: true, id: { not: target.id } },
      });
      if (others === 0) {
        throw new AppError(
          "CONFLICT",
          409,
          deactivating || nextRole === "admin"
            ? "The last active admin cannot be deactivated."
            : "The last active admin cannot be demoted.",
        );
      }
    }

    if (roleChanged && actorId === target.id) {
      throw new AppError("FORBIDDEN", 403, "You cannot change your own role.");
    }
    if (deactivating && actorId === target.id) {
      throw new AppError("FORBIDDEN", 403, "You cannot deactivate your own account.");
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: {
        name: input.name ?? target.name,
        role: toPrismaRole(nextRole),
        active: nextActive,
      },
    });
    if (deactivating) {
      await deleteUserSessions(tx, target.id);
    }
    return toPublicUser(updated);
  });
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) {
      throw new AppError("NOT_FOUND", 404, "User not found.");
    }
    await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
    await deleteUserSessions(tx, target.id);
  });
}
