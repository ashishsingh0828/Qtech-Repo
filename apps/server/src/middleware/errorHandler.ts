import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { AppError, errorBody } from "../lib/errors";
import { logger } from "../lib/logger";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId || "unknown";

  if (error instanceof AppError) {
    const body = errorBody({
      error: error.message,
      code: error.code,
      requestId,
      details: error.details,
    });
    res.status(error.status).json(error.extras ? { ...body, ...error.extras } : body);
    return;
  }

  if (isInvalidJson(error)) {
    res.status(400).json(errorBody({ error: "Invalid JSON", code: "VALIDATION", requestId }));
    return;
  }

  if (isPayloadTooLarge(error)) {
    res.status(413).json(errorBody({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE", requestId }));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json(errorBody({ error: "Conflict", code: "CONFLICT", requestId }));
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json(errorBody({ error: "Not found", code: "NOT_FOUND", requestId }));
      return;
    }
  }

  logger.error({ err: error, requestId }, "Unhandled error");
  res.status(500).json(errorBody({ error: "Something went wrong", code: "INTERNAL", requestId }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInvalidJson(error: unknown): boolean {
  if (!(error instanceof SyntaxError) || !isRecord(error)) return false;
  return error.status === 400 || error.type === "entity.parse.failed";
}

function isPayloadTooLarge(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.type === "entity.too.large" || error.status === 413;
}
