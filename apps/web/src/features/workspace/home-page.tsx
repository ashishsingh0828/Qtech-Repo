import { useAuth } from "../auth/auth-gate";
import { AdminDesk } from "./admin-desk";
import { ManagerDesk } from "./manager-desk";
import { ServiceDesk } from "./service-desk";
import { ValidatorDesk } from "./validator-desk";

export function HomePage() {
  const { user } = useAuth();
  if (user.role === "admin") return <AdminDesk />;
  if (user.role === "manager") return <ManagerDesk />;
  if (user.role === "validator") return <ValidatorDesk />;
  return <ServiceDesk />;
}
