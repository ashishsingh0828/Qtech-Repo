export const ROLES = ["admin", "manager", "validator", "service"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const NAV_ICONS = ["users", "shield"] as const;

export type NavIcon = (typeof NAV_ICONS)[number];

export type NavItem = {
  id: string;
  label: string;
  icon: NavIcon;
  path: string;
};

export type RoleDefinition = {
  label: string;
  homePath: string;
  nav: readonly NavItem[];
};

export const ROLE_REGISTRY: Record<Role, RoleDefinition> = {
  admin: {
    label: "Admin",
    homePath: "/",
    nav: [
      { id: "team", label: "Team", icon: "users", path: "/team" },
      { id: "access", label: "Access", icon: "shield", path: "/access" },
    ],
  },
  manager: {
    label: "Manager",
    homePath: "/",
    nav: [],
  },
  validator: {
    label: "Validator",
    homePath: "/",
    nav: [],
  },
  service: {
    label: "Service",
    homePath: "/",
    nav: [],
  },
};
