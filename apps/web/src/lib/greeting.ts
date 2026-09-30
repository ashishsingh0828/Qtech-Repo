import { formatDisplayDate, todayInTimeZone } from "@app/shared";

export function greeting(name: string, timeZone: string, now: Date = new Date()): { hello: string; dateLabel: string } {
  const hourText = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
  const hour = Number(hourText);
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0] || name.trim() || "there";
  return { hello: `${part}, ${first}`, dateLabel: formatDisplayDate(todayInTimeZone(timeZone, now)) };
}
