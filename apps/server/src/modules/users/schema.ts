import { emailSchema, passwordSchema, roleSchema } from "@app/shared";
import { z } from "zod";

const idParams = z.object({
  id: z.uuid(),
});

export const listUsersSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.unknown(),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    role: roleSchema,
    password: passwordSchema,
  }),
  query: z.unknown(),
  params: z.unknown(),
});

export const updateUserSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      role: roleSchema.optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  query: z.unknown(),
  params: idParams,
});

export const resetPasswordSchema = z.object({
  body: z.object({
    password: passwordSchema,
  }),
  query: z.unknown(),
  params: idParams,
});
