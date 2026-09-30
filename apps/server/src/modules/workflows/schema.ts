import { QUICK_FILTER_KEYS, callTypeSchema, dateOnlySchema } from "@app/shared";
import { MAX_ROWS } from "@app/shared";
import { z } from "zod";

const datasetRow = z.object({
  id: z.uuid(),
  rowId: z.uuid(),
});

export const summarySchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const actionParamsSchema = datasetRow.extend({
  action: z.enum(["validate", "verify", "amc", "pms", "followup", "assign"]),
});

export const validateActionSchema = z.object({
  body: z
    .object({
      result: z.enum(["Yes", "No", "Clear"]),
      reason: z.string().max(2000).optional(),
      expectedDate: dateOnlySchema.optional(),
    })
    .strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const verifyActionSchema = z.object({
  body: z.object({ verified: z.boolean(), note: z.string().max(2000).optional() }).strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const amcActionSchema = z.object({
  body: z
    .object({
      action: z.enum(["proposal_sent", "acknowledge", "decline", "reset"]),
      note: z.string().max(2000).optional(),
      date: dateOnlySchema.optional(),
    })
    .strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const pmsActionSchema = z.object({
  body: z
    .object({
      action: z.enum(["markDone", "reschedule"]),
      n: z.number().int().min(1).max(100),
      date: dateOnlySchema.optional(),
    })
    .strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const followupActionSchema = z.object({
  body: z.object({ date: dateOnlySchema }).strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const assignActionSchema = z.object({
  body: z
    .object({
      validatorId: z.uuid().nullable().optional(),
      serviceId: z.uuid().nullable().optional(),
    })
    .strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const undoSchema = z.object({
  body: z.object({ actionId: z.uuid() }).strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const callCreateSchema = z.object({
  body: z.object({ type: callTypeSchema, description: z.string().min(1).max(4000) }).strict(),
  query: z.unknown(),
  params: datasetRow,
});

export const callResolveSchema = z.object({
  body: z.object({ note: z.string().max(4000).optional() }).strict(),
  query: z.unknown(),
  params: datasetRow.extend({ callId: z.uuid() }),
});

export const callsListSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: datasetRow,
});

export const activitySchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: datasetRow,
});

const bulkIds = z.array(z.uuid()).min(1).max(MAX_ROWS);

export const bulkValidateSchema = z.object({
  body: z
    .object({
      rowIds: bulkIds,
      result: z.enum(["Yes", "No", "Clear"]),
      reason: z.string().max(2000).optional(),
      expectedDate: dateOnlySchema.optional(),
    })
    .strict(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const bulkVerifySchema = z.object({
  body: z.object({ rowIds: bulkIds, verified: z.boolean(), note: z.string().max(2000).optional() }).strict(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const bulkAssignSchema = z.object({
  body: z
    .object({
      rowIds: bulkIds,
      validatorId: z.uuid().nullable().optional(),
      serviceId: z.uuid().nullable().optional(),
    })
    .strict(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const bulkHistoricalSchema = z.object({
  body: z.object({ rowIds: bulkIds }).strict(),
  query: z.unknown(),
  params: z.object({ id: z.uuid() }),
});

export const rowsTabValues = QUICK_FILTER_KEYS;
