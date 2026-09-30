import { z } from "zod";

export const listNotificationsSchema = z.object({
  body: z.unknown(),
  query: z.object({
    limit: z.preprocess((value) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== "string" || raw.trim() === "") return undefined;
      return Number(raw);
    }, z.number().int().min(1).max(100).optional()),
    before: z.preprocess((value) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== "string" || raw.trim() === "") return undefined;
      return raw;
    }, z.string().optional()),
  }),
  params: z.unknown(),
});

export const readNotificationSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.object({
    id: z.uuid(),
  }),
});
