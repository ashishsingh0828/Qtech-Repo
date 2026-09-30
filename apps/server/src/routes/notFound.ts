import type { Request, Response } from "express";
import { errorBody } from "../lib/errors";

export function apiNotFound(req: Request, res: Response): void {
  res.status(404).json(
    errorBody({
      error: "Not found",
      code: "NOT_FOUND",
      requestId: req.requestId || "unknown",
    }),
  );
}
