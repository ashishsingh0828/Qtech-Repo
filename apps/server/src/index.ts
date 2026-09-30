import { Prisma } from "@prisma/client";
import { createApp } from "./app";
import { env } from "./env";
import { ensureDefaultGroupAccess } from "./lib/access";
import { installProcessGuards, shutdownServer, startBackground } from "./lib/lifecycle";
import { ensureBootstrapAdmin } from "./modules/auth/service";
import { ensureAllSystemColumns } from "./modules/datasets/systemColumns";
import { databaseAddress } from "./lib/databaseAddress";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

async function connectDatabase(): Promise<void> {
  const address = databaseAddress(env.DATABASE_URL);
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    logger.fatal(`Database unreachable at ${address}. Check that PostgreSQL is running on that host and port.`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await connectDatabase();

  try {
    await ensureDefaultGroupAccess();
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "unknown";
    logger.fatal(`Failed to ensure default group access (${code})`);
    process.exit(1);
  }

  try {
    await ensureBootstrapAdmin();
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "unknown";
    logger.fatal(`Failed to bootstrap admin (${code})`);
    process.exit(1);
  }

  try {
    await ensureAllSystemColumns();
  } catch (error) {
    logger.error({ err: error }, "Failed to ensure system columns");
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, `${env.APP_NAME} listening`);
  });
  startBackground();

  const shutdown = (signal: string, code: number): void => {
    shutdownServer(server, signal, code);
  };
  installProcessGuards(shutdown);
  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
}

void main();
