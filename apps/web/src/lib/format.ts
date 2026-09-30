import { formatDisplayDateTime } from "@app/shared";

export function formatWhen(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return formatDisplayDateTime(date, Intl.DateTimeFormat().resolvedOptions().timeZone);
}
