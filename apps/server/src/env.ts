import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
config({ path: rootEnvPath });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["development", "production", "test"]),
  CLIENT_ORIGIN: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true"),
  APP_NAME: z.string().min(1),
  APP_TIMEZONE: z.string().min(1),
  DEFAULT_COUNTRY_CODE: z.string().min(1),
  ADMIN_NAME: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = new Map<string, string[]>();
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0] ?? "unknown");
    const existing = messages.get(name) ?? [];
    existing.push(issue.message);
    messages.set(name, existing);
  }
  console.error("Invalid environment variables:");
  for (const [name, issues] of messages) {
    console.error(`- ${name}: ${issues.join("; ")}`);
  }
  process.exit(1);
}

const clientOrigin = parsed.data.CLIENT_ORIGIN ?? parsed.data.RENDER_EXTERNAL_URL;
if (!clientOrigin) {
  console.error("Invalid environment variables:\n- CLIENT_ORIGIN: required");
  process.exit(1);
}

export const env = { ...parsed.data, CLIENT_ORIGIN: clientOrigin };
