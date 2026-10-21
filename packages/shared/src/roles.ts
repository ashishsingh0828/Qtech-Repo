export const ROLES = ["admin", "manager", "validator", "service"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const NAV_ICONS = ["home", "rows", "table", "schema", "trash", "users", "shield", "activity"] as const;

export type NavIcon = (typeof NAV_ICONS)[number];

export type NavItem = {
  id: string;
  label: string;
  hint?: string;
  icon: NavIcon;
  path: string;
};

export type RoleDefinition = {
  label: string;
  homePath: string;
  nav: readonly NavItem[];
};

export const ROLE_COPY: Record<Role, { title: string; blurb: string }> = {
  admin: {
    title: "Admin",
    blurb: "Upload or download the Excel sheet, add contracts and validate data.",
  },
  manager: {
    title: "Service Manager",
    blurb: "PMs that reminders have escalated, and the AMC follow-up pipeline.",
  },
  validator: {
    title: "Service Coordinator",
    blurb: "Confirm customer and contract data, then keep validation moving.",
  },
  service: {
    title: "Service Engineer",
    blurb: "Acknowledge, delay or close your PM visits. Closing records the visit done date.",
  },
};

export const ROLE_REGISTRY: Record<Role, RoleDefinition> = {
  admin: {
    label: "Admin",
    homePath: "/",
    nav: [
      { id: "home", label: "Data and validation", hint: "Upload or download Excel", icon: "home", path: "/" },
      { id: "records", label: "Contracts", hint: "All imported rows", icon: "rows", path: "/records" },
      { id: "datasets", label: "Excel sheets", hint: "Workbooks", icon: "table", path: "/datasets" },
      { id: "schema", label: "Schema", hint: "Groups and columns", icon: "schema", path: "/schema" },
      { id: "team", label: "Team", hint: "People and workload", icon: "users", path: "/team" },
      { id: "access", label: "Access", hint: "Who can edit each group", icon: "shield", path: "/access" },
      { id: "activity", label: "Activity", hint: "What changed", icon: "activity", path: "/activity" },
      { id: "trash", label: "Trash", hint: "Restore deleted items", icon: "trash", path: "/trash" },
    ],
  },
  manager: {
    label: "Service Manager",
    homePath: "/",
    nav: [
      { id: "home", label: "Escalations", hint: "PMs and AMC follow-up", icon: "home", path: "/" },
      { id: "records", label: "Contracts", hint: "All imported rows", icon: "rows", path: "/records" },
      { id: "datasets", label: "Excel sheets", hint: "Workbooks", icon: "table", path: "/datasets" },
      { id: "schema", label: "Schema", hint: "Groups and columns", icon: "schema", path: "/schema" },
      { id: "activity", label: "Activity", hint: "What changed", icon: "activity", path: "/activity" },
      { id: "trash", label: "Trash", hint: "Restore deleted items", icon: "trash", path: "/trash" },
    ],
  },
  validator: {
    label: "Service Coordinator",
    homePath: "/",
    nav: [
      { id: "home", label: "Validation desk", hint: "Confirm contract data", icon: "home", path: "/" },
      { id: "records", label: "Contracts", hint: "All imported rows", icon: "rows", path: "/records" },
    ],
  },
  service: {
    label: "Service Engineer",
    homePath: "/",
    nav: [
      { id: "home", label: "My PMs and AMC", hint: "Acknowledge and close visits", icon: "home", path: "/" },
      { id: "records", label: "Contracts", hint: "All imported rows", icon: "rows", path: "/records" },
    ],
  },
};
