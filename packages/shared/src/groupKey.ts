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

export function labelForGroupKey(groupKey: string): string {
  const known = CANONICAL_GROUPS.find((group) => group.groupKey === groupKey);
  if (known) return known.label;
  return groupKey
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
