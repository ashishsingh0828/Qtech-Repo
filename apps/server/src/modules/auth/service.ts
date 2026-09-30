import type { Permissions, PublicUser } from "@app/shared";
import { Role as PrismaRole } from "@prisma/client";
import { env } from "../../env";
import { permissionsFor, toPublicUser } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "../../lib/login-rate-limit";
import { logger } from "../../lib/logger";
import { hashPassword, verifyPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { hashToken, newSessionToken, SESSION_TTL_MS } from "../../lib/session";

const INVALID_LOGIN = "Email or password is incorrect.";

export async function ensureBootstrapAdmin(): Promise<void> {
  const existing = await prisma.user.count();
  if (existing > 0) return;
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      name: env.ADMIN_NAME.trim(),
      email,
      passwordHash,
      role: PrismaRole.admin,
      active: true,
    },
  });
  logger.info(`Created admin user ${email}`);
}

export async function login(input: {
  email: string;
  password: string;
  ip: string;
}): Promise<{ token: string; user: PublicUser; permissions: Permissions }> {
  assertLoginAllowed(input.ip, input.email);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const matches = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !user.active || !matches) {
    recordLoginFailure(input.ip, input.email);
    throw new AppError("UNAUTHENTICATED", 401, INVALID_LOGIN);
  }

  clearLoginFailures(input.ip, input.email);
  const now = new Date();
  const token = newSessionToken();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastSeenAt: now },
    }),
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    }),
  ]);

  const refreshed = { ...user, lastLoginAt: now, lastSeenAt: now };
  return {
    token,
    user: toPublicUser(refreshed),
    permissions: await permissionsFor(toPublicUser(refreshed).role),
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new AppError("UNAUTHENTICATED", 401, "Sign in required");
  }
  const matches = await verifyPassword(currentPassword, user.passwordHash);
  if (!matches) {
    throw new AppError("VALIDATION", 400, "Current password is incorrect.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}
