import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { CookieOptions, Response } from "express";
import { env } from "../env";
import type { prisma } from "./prisma";

export const SESSION_COOKIE = "qsh_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

type SessionStore = Prisma.TransactionClient | typeof prisma;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSessionToken(cookies: RequestCookies | undefined): string | undefined {
  const value = cookies?.[SESSION_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type RequestCookies = Record<string, unknown>;

export async function deleteUserSessions(store: SessionStore, userId: string): Promise<void> {
  await store.session.deleteMany({ where: { userId } });
}
