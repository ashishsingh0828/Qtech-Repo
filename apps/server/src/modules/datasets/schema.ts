import { COLUMN_TYPES, MAX_ROWS } from "@app/shared";
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

const columnKeyParams = z.object({
  id: z.uuid(),
  key: z.string().min(1).max(200),
});

const groupParams = z.object({
  id: z.uuid(),
  groupId: z.string().min(1).max(200),
});

export const addColumnSchema = z.object({
  body: z
    .object({
      label: z.string().min(1).max(200),
      groupId: z.string().min(1).max(200).optional(),
      newGroup: z.object({ label: z.string().min(1).max(200) }).strict().optional(),
      type: z.enum(COLUMN_TYPES),
      options: z.array(z.string().max(120)).max(100).optional(),
      afterKey: z.string().min(1).max(200).optional(),
      beforeKey: z.string().min(1).max(200).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: idParams,
});

export const patchColumnSchema = z.object({
  body: z
    .object({
      label: z.string().min(1).max(200).optional(),
      type: z.enum(COLUMN_TYPES).optional(),
      groupId: z.string().min(1).max(200).optional(),
      hidden: z.boolean().optional(),
      width: z.number().min(40).max(800).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: columnKeyParams,
});

export const moveColumnSchema = z.object({
  body: z
    .object({
      afterKey: z.string().min(1).max(200).optional(),
      beforeKey: z.string().min(1).max(200).optional(),
      groupId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: columnKeyParams,
});

export const columnParamsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: columnKeyParams,
});

export const addGroupSchema = z.object({
  body: z.object({ label: z.string().min(1).max(200) }).strict(),
  query: z.unknown(),
  params: idParams,
});

export const patchGroupSchema = z.object({
  body: z
    .object({
      label: z.string().min(1).max(200).optional(),
      tint: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: groupParams,
});

export const moveGroupSchema = z.object({
  body: z
    .object({
      afterGroupId: z.string().min(1).max(200).optional(),
      beforeGroupId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: groupParams,
});

export const groupParamsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: groupParams,
});

export const importPreviewSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: idParams,
});

export const importConfirmSchema = z.object({
  body: z.object({ token: z.string().min(16).max(200) }).strict(),
  query: z.unknown(),
  params: idParams,
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
