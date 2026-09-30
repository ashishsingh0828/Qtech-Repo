import { todayInTimeZone } from "@app/shared";
import { env } from "../env";

export function today(now: Date = new Date()): string {
  return todayInTimeZone(env.APP_TIMEZONE, now);
}
