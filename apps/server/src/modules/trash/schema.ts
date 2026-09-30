import { z } from "zod";

export const listTrashSchema = z.object({
  body: z.unknown(),
  query: z.object({
    type: z.preprocess((value) => (Array.isArray(value) ? value[0] : value), z.enum(["datasets", "rows", "columns"])),
  }),
  params: z.unknown(),
});

export const restoreTrashSchema = z.object({
  body: z
    .object({
      kind: z.enum(["datasets", "rows", "columns", "groups"]),
      datasetId: z.uuid().optional(),
      id: z.string().min(1).max(300).optional(),
      key: z.string().min(1).max(200).optional(),
      ids: z.array(z.string().min(1).max(300)).max(500).optional(),
    })
    .strict(),
  query: z.unknown(),
  params: z.unknown(),
});

export const purgeTrashSchema = z.object({
  body: z
    .object({
      confirm: z.literal("DELETE"),
    })
    .strict(),
  query: z.unknown(),
  params: z.object({
    kind: z.enum(["datasets", "rows", "columns", "groups"]),
    id: z.string().min(1).max(300),
  }),
});
