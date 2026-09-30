import { healthResponseSchema } from "@app/shared";
import { Router } from "express";
import { env } from "../env";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json(
        healthResponseSchema.parse({
          status: "ok",
          db: "up",
          time: new Date().toISOString(),
          appName: env.APP_NAME,
        }),
      );
    } catch {
      logger.error("Health check database query failed");
      res.status(503).json(
        healthResponseSchema.parse({
          status: "degraded",
          db: "down",
          appName: env.APP_NAME,
        }),
      );
    }
  }),
);
