import type { ErrorCode } from "@app/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "UNKNOWN";
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code: ErrorCode | "UNKNOWN",
    requestId?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

const ERROR_CODES = new Set<ErrorCode>([
  "VALIDATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL",
]);

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  tolerate?: number[];
};

export async function api<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const headers = new Headers(request.headers);
  let body: BodyInit | undefined;
  if (request.body instanceof FormData) {
    body = request.body;
  } else if (request.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(request.body);
  }

  const response = await fetch(path, {
    method: request.method ?? (body ? "POST" : "GET"),
    credentials: "same-origin",
    headers,
    body,
    signal: request.signal,
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event("unauthenticated"));
  }

  const payload = await readBody(response);
  const tolerated = request.tolerate?.includes(response.status) ?? false;
  if (!response.ok && !tolerated) {
    const record = isRecord(payload) ? payload : {};
    const code = typeof record.code === "string" && isErrorCode(record.code) ? record.code : "UNKNOWN";
    throw new ApiError(
      typeof record.error === "string" ? record.error : "Request failed",
      response.status,
      code,
      typeof record.requestId === "string" ? record.requestId : undefined,
      record.details,
    );
  }

  return payload as T;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODES.has(value as ErrorCode);
}
