import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodError, ZodType } from "zod";
import { AppError } from "./errors";

export function validate<T extends ZodType>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (!parsed.success) {
      next(new AppError("VALIDATION", 400, "Invalid request", zodDetails(parsed.error)));
      return;
    }
    req.validated = parsed.data;
    next();
  };
}

export function validated<T>(req: Request): T {
  return req.validated as T;
}

function zodDetails(error: ZodError): { path: PropertyKey[]; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}
