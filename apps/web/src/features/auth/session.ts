import type { Permissions, PublicUser } from "@app/shared";
import { api } from "../../lib/api";
import { queryClient } from "../../lib/query";

export type SessionState = {
  user: PublicUser;
  permissions: Permissions;
  countryCode?: string;
};

export const meQueryKey = ["auth", "me"] as const;

const RETURN_KEY = "qsh.returnTo";

let captureReturn = true;
let loginDestination: string | null = null;
let epoch = 0;

export function sessionEpoch(): number {
  return epoch;
}

export function advanceSessionEpoch(): void {
  epoch += 1;
}

function isSafePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login");
}

export function rememberReturnTo(path: string): void {
  if (!isSafePath(path)) return;
  sessionStorage.setItem(RETURN_KEY, path);
}

export function consumeReturnTo(): string {
  const value = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return typeof value === "string" && isSafePath(value) ? value : "/";
}

export function suppressReturnCapture(): void {
  captureReturn = false;
}

export function shouldCaptureReturn(): boolean {
  return captureReturn;
}

export function allowReturnCapture(): void {
  captureReturn = true;
}

export function setLoginDestination(path: string): void {
  loginDestination = path;
}

export function peekLoginDestination(): string {
  return loginDestination ?? "/";
}

export function clearLoginDestination(): void {
  loginDestination = null;
}

export async function endSession(): Promise<void> {
  advanceSessionEpoch();
  await api("/api/auth/logout", { method: "POST" });
  sessionStorage.removeItem(RETURN_KEY);
  clearLoginDestination();
  suppressReturnCapture();
  queryClient.setQueryData<SessionState | null>(meQueryKey, null);
}
