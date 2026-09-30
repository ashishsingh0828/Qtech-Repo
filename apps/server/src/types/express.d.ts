import type { PublicUser } from "@app/shared";

export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      validated?: unknown;
      user?: PublicUser;
      sessionId?: string;
      file?: {
        originalname: string;
        mimetype: string;
        size: number;
        buffer: Buffer;
      };
    }
  }
}
