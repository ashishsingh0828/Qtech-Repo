import { z } from "zod";

const QUEUES = [
  "verification",
  "amc_unverified",
  "amc_due",
  "amc_proposal",
  "amc_acknowledged",
  "amc_declined",
  "validation_overdue",
  "pms_overdue",
  "followup_overdue",
  "unassigned",
  "validate_queue",
  "rejected",
  "sent_back",
  "agenda",
  "calls",
  "followups",
] as const;

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function optionalText(max: number) {
  return z.preprocess((value) => {
    const raw = one(value);
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    return raw;
  }, z.string().max(max).optional());
}

function optionalInt(min: number, max: number) {
  return z.preprocess((value) => {
    const raw = one(value);
    if (raw === undefined || raw === "") return undefined;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string" && /^-?\d+$/.test(raw)) return Number(raw);
    return raw;
  }, z.number().int().min(min).max(max).optional());
}

function optionalBool() {
  return z.preprocess((value) => {
    const raw = one(value);
    if (raw === "true" || raw === true) return true;
    if (raw === "false" || raw === false) return false;
    return undefined;
  }, z.boolean().optional());
}

export const kpisSchema = z.object({
  body: z.unknown(),
  query: z.object({ datasetId: z.preprocess(one, z.uuid().optional()) }),
  params: z.unknown(),
});

export const cardsSchema = z.object({
  body: z.unknown(),
  query: z.object({
    datasetId: z.preprocess(one, z.uuid()),
    queue: z.preprocess(one, z.enum(QUEUES)),
    limit: optionalInt(1, 100),
    offset: optionalInt(0, 10000),
    mine: optionalBool(),
    city: optionalText(200),
    contract: optionalText(200),
    slot: z.preprocess(one, z.enum(["validator", "service"]).optional()),
  }),
  params: z.unknown(),
});

export const workloadSchema = z.object({
  body: z.unknown(),
  query: z.object({ datasetId: z.preprocess(one, z.uuid().optional()) }),
  params: z.unknown(),
});

export const activityListSchema = z.object({
  body: z.unknown(),
  query: z.object({
    limit: optionalInt(1, 100),
    offset: optionalInt(0, 5000),
    userId: z.preprocess(one, z.uuid().optional()),
    action: optionalText(80),
    datasetId: z.preprocess(one, z.uuid().optional()),
    from: z.preprocess(one, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    to: z.preprocess(one, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  }),
  params: z.unknown(),
});

export const healthSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const searchSchema = z.object({
  body: z.unknown(),
  query: z.object({ q: optionalText(200) }),
  params: z.unknown(),
});
