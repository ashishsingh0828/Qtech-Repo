import { Prisma } from "@prisma/client";
import { createApp } from "./app";
import { env } from "./env";
import { ensureDefaultGroupAccess } from "./lib/access";
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

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void prisma.$disconnect().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
