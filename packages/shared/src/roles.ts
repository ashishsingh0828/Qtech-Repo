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
      { id: "home", label: "Command Center", icon: "home", path: "/" },
      { id: "records", label: "Records", icon: "rows", path: "/records" },
      { id: "datasets", label: "Datasets", icon: "table", path: "/datasets" },
      { id: "schema", label: "Schema", icon: "schema", path: "/schema" },
      { id: "team", label: "Team", icon: "users", path: "/team" },
      { id: "access", label: "Access", icon: "shield", path: "/access" },
      { id: "activity", label: "Activity", icon: "activity", path: "/activity" },
      { id: "trash", label: "Trash", icon: "trash", path: "/trash" },
    ],
  },
  manager: {
    label: "Manager",
    homePath: "/",
    nav: [
      { id: "home", label: "Control Room", icon: "home", path: "/" },
      { id: "records", label: "Records", icon: "rows", path: "/records" },
      { id: "datasets", label: "Datasets", icon: "table", path: "/datasets" },
      { id: "schema", label: "Schema", icon: "schema", path: "/schema" },
      { id: "activity", label: "Activity", icon: "activity", path: "/activity" },
      { id: "trash", label: "Trash", icon: "trash", path: "/trash" },
    ],
  },
  validator: {
    label: "Validator",
    homePath: "/",
    nav: [
      { id: "home", label: "My Desk", icon: "home", path: "/" },
      { id: "records", label: "Records", icon: "rows", path: "/records" },
    ],
  },
  service: {
    label: "Service",
    homePath: "/",
    nav: [
      { id: "home", label: "Service Desk", icon: "home", path: "/" },
      { id: "records", label: "Records", icon: "rows", path: "/records" },
    ],
  },
};
