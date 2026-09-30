import { AppError } from "./errors";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Bucket = {
  failures: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

function bucketKey(ip: string, email: string): string {
  return `${ip}|${email}`;
}

function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export function assertLoginAllowed(ip: string, email: string): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(bucketKey(ip, email));
  if (!bucket) return;
  const elapsed = now - bucket.windowStart;
  if (elapsed >= WINDOW_MS) {
    buckets.delete(bucketKey(ip, email));
    return;
  }
  if (bucket.failures >= MAX_FAILURES) {
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000));
    throw new AppError(
      "RATE_LIMITED",
      429,
      `Too many sign-in attempts. Try again in ${retryAfterSeconds} seconds.`,
      { retryAfterSeconds },
    );
  }
}

export function recordLoginFailure(ip: string, email: string): void {
  const now = Date.now();
  const key = bucketKey(ip, email);
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(key, { failures: 1, windowStart: now });
    return;
  }
  if (existing.failures >= MAX_FAILURES) return;
  existing.failures += 1;
}

export function clearLoginFailures(ip: string, email: string): void {
  buckets.delete(bucketKey(ip, email));
}

export function readRetryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof AppError) || error.code !== "RATE_LIMITED" || !isRecord(error.details)) {
    return undefined;
  }
  const seconds = error.details.retryAfterSeconds;
  return typeof seconds === "number" ? seconds : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
