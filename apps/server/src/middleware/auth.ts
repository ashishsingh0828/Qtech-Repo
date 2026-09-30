import type { Capability, PublicUser, Role } from "@app/shared";
import { hasCapability } from "@app/shared";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { toPublicUser } from "../lib/account";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { clearSessionCookie, hashToken, readSessionToken } from "../lib/session";

const SEEN_INTERVAL_MS = 60_000;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res).then(
    () => next(),
    (error: unknown) => next(error),
  );
}

export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError("UNAUTHENTICATED", 401, "Sign in required"));
      return;
    }
    if (!hasCapability(req.user.role, capability)) {
      next(new AppError("FORBIDDEN", 403, "You do not have access to this."));
      return;
    }
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError("UNAUTHENTICATED", 401, "Sign in required"));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError("FORBIDDEN", 403, "You do not have access to this."));
      return;
    }
    next();
  };
}

export function currentUser(req: Request): PublicUser {
  if (!req.user) {
    throw new AppError("UNAUTHENTICATED", 401, "Sign in required");
  }
  return req.user;
}

async function authenticate(req: Request, res: Response): Promise<void> {
  const token = readSessionToken(req.cookies as Record<string, unknown> | undefined);
  if (!token) {
    clearSessionCookie(res);
    throw new AppError("UNAUTHENTICATED", 401, "Sign in required");
  }

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) {
      clearSessionCookie(res);
      throw new AppError("UNAUTHENTICATED", 401, "Sign in required");
    }

    const now = new Date();
    const seenAt = session.user.lastSeenAt?.getTime() ?? 0;
    if (now.getTime() - seenAt >= SEEN_INTERVAL_MS) {
      try {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { lastSeenAt: now },
        });
        session.user.lastSeenAt = now;
      } catch (error) {
        logger.error({ err: error }, "Failed to update lastSeenAt");
      }
    }

    req.user = toPublicUser(session.user);
    req.sessionId = session.id;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isDatabaseError(error)) throw error;
    clearSessionCookie(res);
    throw new AppError("UNAUTHENTICATED", 401, "Sign in required");
  }
}

function isDatabaseError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}
