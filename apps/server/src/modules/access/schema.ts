import { groupKeySchema } from "@app/shared";
import { z } from "zod";

const storedRoleSchema = z.enum(["validator", "service"]);

export const getAccessSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.unknown(),
});

export const putAccessSchema = z.object({
  body: z.object({
    rows: z.array(
      z.object({
        role: storedRoleSchema,
        groupKey: groupKeySchema,
        canView: z.boolean(),
        canEdit: z.boolean(),
      }),
    ),
  }),
  query: z.unknown(),
  params: z.unknown(),
});

export type AccessRowInput = z.infer<typeof putAccessSchema>["body"]["rows"][number];
