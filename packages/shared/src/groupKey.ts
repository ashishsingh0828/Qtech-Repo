export function normalizeGroupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isGroupKeySlug(value: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);
}

export const CANONICAL_GROUPS = [
  { groupKey: "customer_detail", label: "Customer detail" },
  { groupKey: "instrument_details", label: "Instrument details" },
  { groupKey: "data_validation", label: "Data validation" },
  { groupKey: "schedule_services", label: "Schedule services" },
  { groupKey: "complaint", label: "Complaint" },
  { groupKey: "breakdown_calls", label: "Breakdown calls" },
  { groupKey: "amc", label: "AMC" },
  { groupKey: "follow_up", label: "Follow-up" },
] as const;

const GROUP_KEY_ALIASES: Record<string, string> = {
  compaint: "complaint",
  complaints: "complaint",
  followup: "follow_up",
  follow_ups: "follow_up",
};

export function groupKeyFromLabel(label: string): string {
  const normalized = normalizeGroupKey(label);
  if (!normalized) return "general";
  const alias = GROUP_KEY_ALIASES[normalized];
  if (alias) return alias;
  const canonical = CANONICAL_GROUPS.map((group) => group.groupKey).sort((left, right) => right.length - left.length);
  for (const key of canonical) {
    if (normalized === key || normalized.startsWith(`${key}_`)) return key;
  }
  return normalized;
}

export function labelForGroupKey(groupKey: string): string {
  const known = CANONICAL_GROUPS.find((group) => group.groupKey === groupKey);
  if (known) return known.label;
  return groupKey
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
