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
    blurb: "Every open PM by month. Assign engineers and watch the reminder level.",
  },
  service: {
    title: "Service Engineer",
    blurb: "Acknowledge, delay or close your PM visits. Closing needs a report and the customer OTP.",
  },
};

export const ROLE_REGISTRY: Record<Role, RoleDefinition> = {
  admin: {
    label: "Admin",
    homePath: "/",
    nav: [
      { id: "home", label: "Data and validation", hint: "Upload or download Excel", icon: "home", path: "/" },
      { id: "team", label: "Team", hint: "People", icon: "users", path: "/team" },
    ],
  },
  manager: {
    label: "Service Manager",
    homePath: "/",
    nav: [{ id: "home", label: "Escalations and renewals", hint: "Overdue PMs and AMC", icon: "home", path: "/" }],
  },
  validator: {
    label: "Service Coordinator",
    homePath: "/",
    nav: [{ id: "home", label: "Monthly PM calendar", hint: "Assign engineers", icon: "home", path: "/" }],
  },
  service: {
    label: "Service Engineer",
    homePath: "/",
    nav: [{ id: "home", label: "My PMs and AMC calls", hint: "Acknowledge, delay, close", icon: "home", path: "/" }],
  },
};
