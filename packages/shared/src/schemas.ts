import { z } from "zod";
import { ROLES } from "./roles";

export const roleSchema = z.enum(ROLES);
export const callTypeSchema = z.enum(["Complaint", "Breakdown", "Emergency", "CourtesyVisit"]);
export const callStatusSchema = z.enum(["Open", "Resolved"]);
export const prioritySchema = z.enum(["normal", "high"]);
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["up", "down"]),
  time: z.string().optional(),
  appName: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  active: z.boolean(),
  lastLoginAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

export const groupKeySchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

export const passwordSchema = z.string().min(8).max(200);
