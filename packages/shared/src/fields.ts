const SERVER_MANAGED_FIELDS = new Set([
  "validated",
  "validated_by",
  "validated_at",
  "verified",
  "verified_by",
  "verified_at",
  "amc_status",
  "ack_at",
  "warranty_live",
  "days",
  "next_due_pms",
  "open_calls",
  "last_call_date",
]);

export function isServerManagedField(key: string): boolean {
  return SERVER_MANAGED_FIELDS.has(key) || key.startsWith("assigned");
}
