import type { Server } from "node:http";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { startJobs, stopJobs } from "./jobs";
import { startMergeSweep, stopMergeSweep } from "../modules/datasets/merge";
import { startOutboxWorker, stopOutboxWorker } from "./outbox";
import { drainSse } from "./sse";

type Shutdown = (signal: string, code: number) => void;

let shuttingDown = false;

export function startBackground(): void {
  startOutboxWorker();
  startJobs();
  startMergeSweep();
}

export function installProcessGuards(shutdown: Shutdown): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled rejection");
    shutdown("unhandledRejection", 1);
  });
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught exception");
    shutdown("uncaughtException", 1);
  });
}

export function shutdownServer(server: Server, signal: string, code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  stopJobs();
  stopOutboxWorker();
  stopMergeSweep();
  drainSse();
  const timer = setTimeout(() => process.exit(code === 0 ? 1 : code), 10_000);
  timer.unref();
  server.close(() => {
    void prisma.$disconnect().then(
      () => {
        clearTimeout(timer);
        process.exit(code);
      },
      (error: unknown) => {
        logger.error({ err: error }, "Failed to disconnect Prisma");
        clearTimeout(timer);
        process.exit(1);
      },
    );
  });
}
