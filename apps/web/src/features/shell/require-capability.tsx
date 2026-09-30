import type { Capability, Role } from "@app/shared";
import { hasCapability } from "@app/shared";
import type { ReactNode } from "react";
import { useAuth } from "../auth/auth-gate";
import { ForbiddenPage } from "./forbidden-page";

export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasCapability(user.role, capability)) return <ForbiddenPage />;
  return children;
}

export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <ForbiddenPage />;
  return children;
}
