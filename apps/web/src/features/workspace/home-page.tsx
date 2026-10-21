import { useAuth } from "../auth/auth-gate";
import { AccountsDesk } from "./accounts-desk";
import { AdminDesk } from "./admin-desk";
import { isAccountsUser } from "./desk-kit";
import { ManagerDesk } from "./manager-desk";
import { ServiceDesk } from "./service-desk";
import { ValidatorDesk } from "./validator-desk";

export function HomePage() {
  const { user } = useAuth();
  if (isAccountsUser(user)) return <AccountsDesk />;
  if (user.role === "admin") return <AdminDesk />;
  if (user.role === "manager") return <ManagerDesk />;
  if (user.role === "validator") return <ValidatorDesk />;
  return <ServiceDesk />;
}
