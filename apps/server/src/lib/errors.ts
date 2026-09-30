import type { ErrorCode } from "@app/shared";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly extras?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    details?: unknown,
    extras?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.extras = extras;
  }
}

export function errorBody(input: {
  error: string;
  code: ErrorCode;
  requestId: string;
  details?: unknown;
}): { error: string; code: ErrorCode; requestId: string; details?: unknown } {
  if (input.details === undefined) {
    return { error: input.error, code: input.code, requestId: input.requestId };
  }
  return {
    error: input.error,
    code: input.code,
    requestId: input.requestId,
    details: input.details,
  };
}
