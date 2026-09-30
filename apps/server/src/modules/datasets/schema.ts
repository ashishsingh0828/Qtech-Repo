import { MAX_ROWS } from "@app/shared";
import { z } from "zod";

const idParams = z.object({
  id: z.uuid(),
});

const rowParams = z.object({
  id: z.uuid(),
  rowId: z.uuid(),
});

function queryString() {
  return z.preprocess((value) => (Array.isArray(value) ? value[0] : value), z.string().max(200).optional());
}

function queryInt(min: number, max: number) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === "") return undefined;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string" && /^-?\d+$/.test(raw)) return Number(raw);
    return raw;
  }, z.number().int().min(min).max(max).optional());
}

export const listDatasetsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.unknown(),
});

export const exportDatasetSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: idParams,
});

export const datasetParamsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: idParams,
});

export const listRowsSchema = z.object({
  body: z.unknown(),
  query: z.object({
    q: queryString(),
    limit: queryInt(1, MAX_ROWS),
    offset: queryInt(0, MAX_ROWS),
  }),
  params: idParams,
});

export const updateRowSchema = z.object({
  body: z
    .object({
      version: z.number().int().min(1),
      changes: z.record(z.string(), z.unknown()),
    })
    .strict(),
  query: z.unknown(),
  params: rowParams,
});

export const createRowSchema = z.object({
  body: z
    .object({
      afterRowId: z.uuid().optional(),
      beforeRowId: z.uuid().optional(),
      atEnd: z.boolean().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: idParams,
});

export const rowParamsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: rowParams,
});

export const historySchema = z.object({
  body: z.unknown(),
  query: z.object({
    columnKey: z.preprocess((value) => (Array.isArray(value) ? value[0] : value), z.string().min(1).max(200)),
  }),
  params: rowParams,
});

export const exportRowsSchema = z.object({
  body: z
    .object({
      rowIds: z.array(z.uuid()).max(MAX_ROWS),
    })
    .strict(),
  query: z.unknown(),
  params: idParams,
});
