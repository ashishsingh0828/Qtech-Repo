import type { PublicUser } from "@app/shared";

export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      validated?: unknown;
      user?: PublicUser;
      sessionId?: string;
    }
  }
}
