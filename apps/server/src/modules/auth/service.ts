import type { Permissions, PublicUser, Role } from "@app/shared";
import { Role as PrismaRole } from "@prisma/client";
import { env } from "../../env";
import { permissionsFor, toPublicUser, toSharedRole } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "../../lib/login-rate-limit";
import { logger } from "../../lib/logger";
import { consumeOtp, issueOtp, type OtpIssue } from "../../lib/otp";
import { hashPassword, verifyPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { hashToken, newSessionToken, SESSION_TTL_MS } from "../../lib/session";

const INVALID_LOGIN = "Email or password is incorrect.";

const DESK_USERS: Array<{
  role: Role;
  name: string;
  email: string;
  password: string;
  phone: string | null;
}> = [
  {
    role: "manager",
    name: "Service Manager",
    email: "manager@example.com",
    password: "change-me",
    phone: "9800000002",
  },
  {
    role: "validator",
    name: "Service Coordinator",
    email: "validator@example.com",
    password: "change-me",
    phone: null,
  },
  {
    role: "service",
    name: "Service Engineer",
    email: "service@example.com",
    password: "change-me",
    phone: "9800000001",
  },
];

export type LoginResult =
  | { otpRequired: true; issue: OtpIssue }
  | { otpRequired: false; token: string; user: PublicUser; permissions: Permissions };

export async function ensureBootstrapAdmin(): Promise<void> {
  const existing = await prisma.user.count();
  if (existing === 0) {
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

  for (const desk of DESK_USERS) {
    const found = await prisma.user.findUnique({ where: { email: desk.email } });
    if (found) continue;
    await prisma.user.create({
      data: {
        name: desk.name,
        email: desk.email,
        phone: desk.phone,
        passwordHash: await hashPassword(desk.password),
        role: desk.role,
        active: true,
      },
    });
    logger.info(`Created ${desk.role} user ${desk.email}`);
  }
}

export async function login(input: {
  email: string;
  password: string;
  role: Role;
  ip: string;
}): Promise<LoginResult> {
  assertLoginAllowed(input.ip, input.email);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const matches = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !user.active || !matches) {
    recordLoginFailure(input.ip, input.email);
    throw new AppError("UNAUTHENTICATED", 401, INVALID_LOGIN);
  }
  if (toSharedRole(user.role) !== input.role) {
    recordLoginFailure(input.ip, input.email);
    throw new AppError("UNAUTHENTICATED", 401, `Use the ${deskLabel(toSharedRole(user.role))} desk for this login.`);
  }

  clearLoginFailures(input.ip, input.email);
  const issue = await issueOtp({
    purpose: "login",
    email: user.email,
    phone: user.phone,
    userId: user.id,
  });
  if (issue) {
    return { otpRequired: true, issue };
  }
  const session = await createSession(user.id);
  return { otpRequired: false, ...session };
}

export async function verifyLoginOtp(input: {
  challengeId: string;
  code: string;
  ip: string;
}): Promise<{ token: string; user: PublicUser; permissions: Permissions }> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge?.userId) {
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
  if (!user || !user.active) {
    throw new AppError("UNAUTHENTICATED", 401, INVALID_LOGIN);
  }
  assertLoginAllowed(input.ip, user.email);
  try {
    await consumeOtp({
      challengeId: input.challengeId,
      code: input.code,
      purpose: "login",
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION") {
      recordLoginFailure(input.ip, user.email);
    }
    throw error;
  }
  clearLoginFailures(input.ip, user.email);
  return createSession(user.id);
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

async function createSession(
  userId: string,
): Promise<{ token: string; user: PublicUser; permissions: Permissions }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new AppError("UNAUTHENTICATED", 401, INVALID_LOGIN);
  }
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

function deskLabel(role: Role): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Service Manager";
  if (role === "validator") return "Service Coordinator";
  return "Service Engineer";
}
