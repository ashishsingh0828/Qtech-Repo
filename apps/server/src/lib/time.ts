import { todayInTimeZone } from "@app/shared";
import { env } from "../env";

export function today(now: Date = new Date()): string {
  return todayInTimeZone(env.APP_TIMEZONE, now);
}

export function startOfZonedDay(day: string, timeZone: string = env.APP_TIMEZONE): Date {
  const probe = new Date(`${day}T12:00:00.000Z`);
  return new Date(probe.getTime() - 12 * 60 * 60 * 1000 - zoneOffset(probe, timeZone));
}

export function endOfZonedDay(day: string, timeZone: string = env.APP_TIMEZONE): Date {
  const start = startOfZonedDay(day, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function zoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value ?? "0");
    return Number.isFinite(value) ? value : 0;
  };
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return asUtc - date.getTime();
}
