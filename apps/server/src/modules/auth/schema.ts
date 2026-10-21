import { emailSchema, passwordSchema, roleSchema } from "@app/shared";
import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1).max(200),
    role: roleSchema,
  }),
  query: z.unknown(),
  params: z.unknown(),
});

export const loginOtpSchema = z.object({
  body: z.object({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{4}$/),
  }),
  query: z.unknown(),
  params: z.unknown(),
});

export const sessionReadSchema = z.object({
  body: z.unknown(),
  query: z.unknown(),
  params: z.unknown(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
  }),
  query: z.unknown(),
  params: z.unknown(),
});
