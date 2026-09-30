import { unlink } from "node:fs/promises";
import { logger } from "./logger";

export function releaseUpload(file: { path?: string; buffer?: Buffer } | undefined): void {
  const path = file?.path;
  if (!path) return;
  void unlink(path).catch((error: unknown) => {
    logger.error({ err: error }, "Failed to remove upload file");
  });
}
