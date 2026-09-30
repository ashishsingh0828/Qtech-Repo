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
