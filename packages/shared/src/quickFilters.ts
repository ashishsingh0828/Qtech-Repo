import { RECENT_EDIT_HOURS } from "./constants";
import {
  isAmcDue,
  isContractLive,
  isFollowupDue,
  isNeedsValidation,
  isPendingVerification,
  isPmsDueSoon,
  isPmsOverdue,
  isUnverifiedExpiry,
  isValidationOverdue,
} from "./metrics";
import type { Role } from "./roles";

export const QUICK_FILTER_KEYS = [
  "needs_validation",
  "validation_overdue",
  "pending_verification",
  "amc_due",
  "unverified_expiries",
  "pms_overdue",
  "pms_due_week",
  "followup_due",
  "recent",
  "mine",
] as const;

export type QuickFilterKey = (typeof QUICK_FILTER_KEYS)[number];

export type QuickFilterDefinition = {
  key: QuickFilterKey;
  label: string;
};

export const QUICK_FILTERS: readonly QuickFilterDefinition[] = [
  { key: "needs_validation", label: "Needs validation" },
  { key: "validation_overdue", label: "Validation overdue" },
  { key: "pending_verification", label: "Pending verification" },
  { key: "amc_due", label: "AMC due" },
  { key: "unverified_expiries", label: "Unverified expiries" },
  { key: "pms_overdue", label: "PMS overdue" },
  { key: "pms_due_week", label: "PMS due this week" },
  { key: "followup_due", label: "Follow-up due" },
  { key: "recent", label: "Recently updated" },
  { key: "mine", label: "Mine" },
];

const VALIDATOR_FILTERS: readonly QuickFilterKey[] = ["needs_validation", "validation_overdue", "recent", "mine"];
const SERVICE_FILTERS: readonly QuickFilterKey[] = ["amc_due", "pms_overdue", "followup_due", "recent", "mine"];

export type FilterSnapshot = {
  validated: string | null;
  validationDue: string | null;
  verified: string | null;
  endDate: string | null;
  amcStatus: string | null;
  nextFollowUp: string | null;
  nextDuePms: string | null;
  updatedAt: string;
  assignedValidatorId: string | null;
  assignedServiceId: string | null;
};

export function quickFiltersForRole(role: Role): QuickFilterDefinition[] {
  const allowed =
    role === "validator" ? VALIDATOR_FILTERS : role === "service" ? SERVICE_FILTERS : QUICK_FILTER_KEYS;
  return QUICK_FILTERS.filter((filter) => (allowed as readonly string[]).includes(filter.key));
}

export function matchesQuickFilter(
  key: QuickFilterKey,
  row: FilterSnapshot,
  today: string,
  userId: string,
  now: Date = new Date(),
): boolean {
  if (key === "needs_validation") return isNeedsValidation(row.validated);
  if (key === "validation_overdue") return isValidationOverdue(row.validated, row.validationDue, today);
  if (key === "pending_verification") return isPendingVerification(row.validated, row.verified);
  if (key === "amc_due") {
    return isAmcDue({ endDate: row.endDate, amcStatus: row.amcStatus, verified: row.verified, today });
  }
  if (key === "unverified_expiries") return isUnverifiedExpiry(row.endDate, row.verified, today);
  if (key === "pms_overdue") return isPmsOverdue(row.endDate, row.nextDuePms, today);
  if (key === "pms_due_week") return isContractLive(row.endDate, today) && isPmsDueSoon(row.endDate, row.nextDuePms, today, 7);
  if (key === "followup_due") return isFollowupDue(row.nextFollowUp, today);
  if (key === "recent") {
    const updated = new Date(row.updatedAt).getTime();
    return Number.isFinite(updated) && now.getTime() - updated <= RECENT_EDIT_HOURS * 60 * 60 * 1000;
  }
  return row.assignedValidatorId === userId || row.assignedServiceId === userId;
}
