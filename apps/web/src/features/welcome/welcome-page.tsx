import type { Role } from "@app/shared";
import { ROLE_REGISTRY } from "@app/shared";
import { PageHeader } from "../../components/ui";
import { useAuth } from "../auth/auth-gate";

const SENTENCES: Record<Role, string> = {
  admin: "You can manage the team and who can see each group.",
  manager: "Datasets and daily work will appear here.",
  validator: "Validation work will appear here.",
  service: "Service work will appear here.",
};

export function WelcomePage() {
  const { user } = useAuth();
  const role = ROLE_REGISTRY[user.role];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Welcome, ${user.name}`} subtitle={role.label} />
      <p className="max-w-xl text-sm text-ink-2">{SENTENCES[user.role]}</p>
    </div>
  );
}
