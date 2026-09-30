import type { Role } from "./roles";

export const CAPABILITIES = [
  "manageUsers",
  "manageAccess",
  "importData",
  "editAnyCell",
  "manageRows",
  "manageStructure",
  "deleteDataset",
  "useTrash",
  "purgeTrash",
  "verify",
  "assign",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MANAGER_EXCLUDED = new Set<Capability>(["manageUsers", "manageAccess", "purgeTrash"]);

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: CAPABILITIES,
  manager: CAPABILITIES.filter((capability) => !MANAGER_EXCLUDED.has(capability)),
  validator: [],
  service: [],
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export type ActionName = "validate" | "amc" | "pms" | "followup" | "calls" | "verify" | "assign";

export type GroupEditCheck = (groupKey: string) => boolean;

export function canPerformAction(
  role: Role,
  action: ActionName,
  canEdit: GroupEditCheck = () => false,
): boolean {
  if (role === "admin" || role === "manager") return true;
  if (role === "validator" && action === "validate") return canEdit("data_validation");
  if (role !== "service") return false;
  if (action === "amc") return canEdit("amc");
  if (action === "pms") return canEdit("schedule_services");
  if (action === "followup") return canEdit("follow_up");
  if (action === "calls") return canEdit("complaint") || canEdit("breakdown_calls");
  return false;
}

export function normalizeAccess(
  canView: boolean,
  canEdit: boolean,
): { canView: boolean; canEdit: boolean } {
  if (canEdit) return { canView: true, canEdit: true };
  return { canView, canEdit: false };
}

export type StoredAccessRole = Extract<Role, "validator" | "service">;

export type RoleGroupAccessDefault = {
  role: StoredAccessRole;
  groupKey: string;
  canView: boolean;
  canEdit: boolean;
};

function access(
  role: StoredAccessRole,
  groupKey: string,
  canView: boolean,
  canEdit: boolean,
): RoleGroupAccessDefault {
  return { role, groupKey, ...normalizeAccess(canView, canEdit) };
}

export const DEFAULT_ROLE_GROUP_ACCESS: readonly RoleGroupAccessDefault[] = [
  access("validator", "customer_detail", true, false),
  access("service", "customer_detail", true, false),
  access("validator", "instrument_details", true, false),
  access("service", "instrument_details", true, false),
  access("validator", "data_validation", true, true),
  access("service", "data_validation", false, false),
  access("validator", "schedule_services", false, false),
  access("service", "schedule_services", true, true),
  access("validator", "complaint", false, false),
  access("service", "complaint", true, true),
  access("validator", "breakdown_calls", false, false),
  access("service", "breakdown_calls", true, true),
  access("validator", "amc", false, false),
  access("service", "amc", true, true),
  access("validator", "follow_up", false, false),
  access("service", "follow_up", true, true),
];
