import { PrismaClient } from "@prisma/client";
import { env } from "../env";

void env;

export const prisma = new PrismaClient({
  log: [],
  errorFormat: "minimal",
});
