import { differenceInCalendarDays, parseISO } from "date-fns";
import { AMC_REQUIRES_VERIFICATION, EXPIRING_DAYS, PMS_SOON_DAYS } from "./constants";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PMS_KEY = /^pms:(\d+)$/;

export const METRICS = [
  { key: "needs_validation", label: "Needs validation" },
  { key: "validation_overdue", label: "Validation overdue" },
  { key: "pending_verification", label: "Pending verification" },
  { key: "warranty_expired", label: "Warranty expired" },
  { key: "expiring_soon", label: "Expiring soon" },
  { key: "amc_due", label: "AMC due" },
  { key: "active_amcs", label: "Active AMCs" },
  { key: "pms_overdue", label: "PMS overdue" },
  { key: "pms_due_soon", label: "PMS due soon" },
  { key: "followup_due", label: "Follow-up due" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

export type EffectiveAmcStatus =
  | "Proposal Sent"
  | "Acknowledged"
  | "Declined"
  | "AMC Due"
  | "Not Due";

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function present(value: string | null | undefined): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value;
}

export function isNeedsValidation(validated: string | null | undefined): boolean {
  return isBlank(validated);
}

export function isValidationOverdue(
  validated: string | null | undefined,
  validationDue: string | null | undefined,
  today: string,
): boolean {
  const due = present(validationDue);
  if (validated !== "No" || !due) return false;
  return due < today;
}

export function isPendingVerification(
  validated: string | null | undefined,
  verified: string | null | undefined,
): boolean {
  return validated === "Yes" && verified !== "Verified OK";
}

export function isWarrantyExpired(endDate: string | null | undefined, today: string): boolean {
  const end = present(endDate);
  return end != null && end < today;
}

export function calendarDaysBetween(startDate: string, endDate: string): number {
  return differenceInCalendarDays(parseISO(`${endDate}T12:00:00Z`), parseISO(`${startDate}T12:00:00Z`));
}

export function isExpiringSoon(
  endDate: string | null | undefined,
  today: string,
  withinDays: number = EXPIRING_DAYS,
): boolean {
  const end = present(endDate);
  if (!end || end < today) return false;
  return calendarDaysBetween(today, end) <= withinDays;
}

export function effectiveAmcStatus(
  stored: string | null | undefined,
  warrantyExpired: boolean,
): EffectiveAmcStatus {
  if (stored === "Proposal Sent" || stored === "Acknowledged" || stored === "Declined") return stored;
  return warrantyExpired ? "AMC Due" : "Not Due";
}

export function isAmcDue(input: {
  endDate: string | null | undefined;
  amcStatus: string | null | undefined;
  verified: string | null | undefined;
  today: string;
}): boolean {
  const expired = isWarrantyExpired(input.endDate, input.today);
  if (!expired) return false;
  if (effectiveAmcStatus(input.amcStatus, expired) !== "AMC Due") return false;
  if (AMC_REQUIRES_VERIFICATION && input.verified !== "Verified OK") return false;
  return true;
}

export function isUnverifiedExpiry(
  endDate: string | null | undefined,
  verified: string | null | undefined,
  today: string,
): boolean {
  return isWarrantyExpired(endDate, today) && verified !== "Verified OK";
}

export function isActiveAmc(amcStatus: string | null | undefined, warrantyExpired: boolean): boolean {
  return effectiveAmcStatus(amcStatus, warrantyExpired) === "Acknowledged";
}

export function isContractLive(endDate: string | null | undefined, today: string): boolean {
  const end = present(endDate);
  return end == null || end >= today;
}

export function isPmsLapsed(endDate: string | null | undefined, today: string): boolean {
  return !isContractLive(endDate, today);
}

export function isPmsOverdue(
  endDate: string | null | undefined,
  nextDuePms: string | null | undefined,
  today: string,
): boolean {
  const due = present(nextDuePms);
  return isContractLive(endDate, today) && due != null && due < today;
}

export function isPmsDueSoon(
  endDate: string | null | undefined,
  nextDuePms: string | null | undefined,
  today: string,
  withinDays: number = PMS_SOON_DAYS,
): boolean {
  const due = present(nextDuePms);
  if (!isContractLive(endDate, today) || !due || due < today) return false;
  return calendarDaysBetween(today, due) <= withinDays;
}

export type WarrantyLive = "Active" | "Expiring" | "Expired" | "Unknown";

export function warrantyLiveStatus(endDate: string | null | undefined, today: string): WarrantyLive {
  const end = present(endDate);
  if (!end) return "Unknown";
  if (end < today) return "Expired";
  if (isExpiringSoon(end, today)) return "Expiring";
  return "Active";
}

export type PmsEntryStatus = "Done" | "Upcoming" | "Due soon" | "Overdue" | "Lapsed";

export function pmsEntryStatus(input: {
  scheduled: string;
  done: string | null | undefined;
  endDate: string | null | undefined;
  today: string;
}): PmsEntryStatus {
  if (!isContractLive(input.endDate, input.today)) return "Lapsed";
  if (present(input.done)) return "Done";
  if (input.scheduled < input.today) return "Overdue";
  if (calendarDaysBetween(input.today, input.scheduled) <= PMS_SOON_DAYS) return "Due soon";
  return "Upcoming";
}

export function isFollowupDue(nextFollowUp: string | null | undefined, today: string): boolean {
  const due = present(nextFollowUp);
  return due != null && due <= today;
}

export function contractDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): number | null {
  const start = present(startDate);
  const end = present(endDate);
  if (!start || !end) return null;
  return calendarDaysBetween(start, end);
}

export function nextDuePmsDate(data: Record<string, unknown>): string | null {
  const dates: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const match = PMS_KEY.exec(key);
    if (!match || typeof value !== "string" || !DATE_ONLY.test(value)) continue;
    const done = data[`pm_date:${match[1]}`];
    if (typeof done === "string" && done.trim() !== "") continue;
    dates.push(value);
  }
  dates.sort();
  return dates[0] ?? null;
}
