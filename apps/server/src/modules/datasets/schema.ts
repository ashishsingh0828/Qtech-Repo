import { z } from "zod";

export const listDatasetsSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.unknown(),
});

export const exportDatasetSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.object({
    id: z.uuid(),
  }),
});
