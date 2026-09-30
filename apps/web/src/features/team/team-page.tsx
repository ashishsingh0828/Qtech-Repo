import type { PublicUser, Role } from "@app/shared";
import { ROLE_REGISTRY, ROLES, isRole } from "@app/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Pill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
} from "../../components/ui";
import type { PillTone } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { formatWhen } from "../../lib/format";
import { initials } from "../../lib/initials";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";
import { PasswordField } from "../auth/password-field";
import { endSession, meQueryKey, type SessionState } from "../auth/session";

const ROLE_TONE: Record<Role, PillTone> = {
  admin: "navy",
  manager: "sapphire",
  validator: "amber",
  service: "emerald",
};

type UsersResponse = { users: PublicUser[] };

export function TeamPage() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [resetUser, setResetUser] = useState<PublicUser | null>(null);
  const query = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      try {
        return await api<UsersResponse>("/api/users");
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: string; body: { name?: string; role?: Role; active?: boolean }; kind: "role" | "active" }) =>
      api<{ user: PublicUser }>(`/api/users/${input.id}`, { method: "PATCH", body: input.body }),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<UsersResponse | null>(["users"], (current) => {
        if (!current) return current;
        return { users: current.users.map((user) => (user.id === result.user.id ? result.user : user)) };
      });
      if (result.user.id === currentUser.id) {
        queryClient.setQueryData<SessionState | null>(meQueryKey, (current) =>
          current ? { ...current, user: result.user } : current,
        );
      }
      toast.success(
        variables.kind === "role" ? "Role updated." : result.user.active ? "User activated." : "User deactivated.",
      );
    },
    onError: (error) => {
      if (isUnauthenticated(error)) return;
      toast.error(errorText(error, "Could not update the user."));
    },
  });

  if (query.isPending) return <TeamSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Team" subtitle="Manage who can sign in." />
        <div className="rounded-card border border-hairline bg-surface p-6">
          <p className="text-sm text-ink-2">Could not load the team.</p>
          <Button className="mt-4" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!query.data) return null;

  const users = query.data.users;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Team"
        subtitle="Manage who can sign in."
        actions={
          <Button onClick={() => setAddOpen(true)}>Add user</Button>
        }
      />
      {users.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface">
          <EmptyState message="No team members yet." action={<Button onClick={() => setAddOpen(true)}>Add user</Button>} />
        </div>
      ) : (
        <>
          <div className="hidden min-w-0 overflow-x-auto rounded-card border border-hairline bg-surface md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-xs font-medium text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last login</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-hairline last:border-b-0">
                    <td className="min-w-0 px-4 py-3">
                      <Person user={user} />
                    </td>
                    <td className="min-w-0 max-w-[16rem] px-4 py-3">
                      <span className="block truncate text-ink-2">{user.email}</span>
                    </td>
                    <td className="min-w-0 px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-2">
                        <Pill tone={ROLE_TONE[user.role]}>{ROLE_REGISTRY[user.role].label}</Pill>
                        <RoleSelect
                          user={user}
                          disabled={update.isPending && update.variables?.id === user.id}
                          onChange={(role) => update.mutate({ id: user.id, body: { role }, kind: "role" })}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusControl
                        user={user}
                        pending={update.isPending && update.variables?.id === user.id && update.variables.kind === "active"}
                        onToggle={() =>
                          update.mutate({ id: user.id, body: { active: !user.active }, kind: "active" })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{formatWhen(user.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => setResetUser(user)}>
                        Reset password
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {users.map((user) => (
              <article key={user.id} className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
                <Person user={user} />
                <p className="truncate text-sm text-ink-2">{user.email}</p>
                <Pill tone={ROLE_TONE[user.role]}>{ROLE_REGISTRY[user.role].label}</Pill>
                <RoleSelect
                  user={user}
                  disabled={update.isPending && update.variables?.id === user.id}
                  onChange={(role) => update.mutate({ id: user.id, body: { role }, kind: "role" })}
                />
                <StatusControl
                  user={user}
                  pending={update.isPending && update.variables?.id === user.id && update.variables.kind === "active"}
                  onToggle={() => update.mutate({ id: user.id, body: { active: !user.active }, kind: "active" })}
                />
                <p className="text-sm tabular-nums text-ink-2">Last login {formatWhen(user.lastLoginAt)}</p>
                <Button variant="secondary" onClick={() => setResetUser(user)}>
                  Reset password
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <ResetPasswordDialog
        user={resetUser}
        onOpenChange={(open) => {
          if (!open) setResetUser(null);
        }}
        onResetSelf={async () => {
          await endSession();
          toast.success("Password reset. Sign in with the new password.");
          await navigate("/login", { replace: true });
        }}
      />
    </div>
  );
}

function Person({ user }: { user: PublicUser }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-ink">
        {initials(user.name)}
      </span>
      <span className="truncate font-medium text-ink">{user.name}</span>
    </div>
  );
}

function RoleSelect({
  user,
  disabled,
  onChange,
}: {
  user: PublicUser;
  disabled: boolean;
  onChange: (role: Role) => void;
}) {
  return (
    <Select
      value={user.role}
      disabled={disabled}
      onValueChange={(value) => {
        if (isRole(value) && value !== user.role) onChange(value);
      }}
    >
      <SelectTrigger aria-label={`Role for ${user.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_REGISTRY[role].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusControl({ user, pending, onToggle }: { user: PublicUser; pending: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Pill tone={user.active ? "emerald" : "stone"}>{user.active ? "Active" : "Inactive"}</Pill>
      <Button size="sm" variant="secondary" onClick={onToggle} disabled={pending}>
        {pending ? <Spinner /> : null}
        {user.active ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}

function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("service");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function close(next: boolean) {
    if (!next) {
      setName("");
      setEmail("");
      setRole("service");
      setPassword("");
      setError("");
    }
    onOpenChange(next);
  }

  const create = useMutation({
    mutationFn: () =>
      api<{ user: PublicUser }>("/api/users", {
        method: "POST",
        body: { name, email, role, password },
      }),
    onSuccess: async () => {
      toast.success("User added.");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      close(false);
    },
    onError: (caught) => {
      if (isUnauthenticated(caught)) return;
      setError(errorText(caught, "Could not add the user."));
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    if (email.trim().length === 0) {
      setError("Email is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form noValidate onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>They can sign in with this email and password.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-5 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-name">Name</Label>
              <Input id="new-user-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-role">Role</Label>
              <Select value={role} onValueChange={(value) => { if (isRole(value)) setRole(value); }}>
                <SelectTrigger id="new-user-role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {ROLE_REGISTRY[item].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PasswordField
              id="new-user-password"
              label="Initial password"
              value={password}
              autoComplete="new-password"
              onChange={setPassword}
            />
            {error ? (
              <p role="alert" className="text-sm text-ruby">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
  onResetSelf,
}: {
  user: PublicUser | null;
  onOpenChange: (open: boolean) => void;
  onResetSelf: () => Promise<void>;
}) {
  const { user: currentUser } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function close() {
    setPassword("");
    setError("");
    onOpenChange(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await api(`/api/users/${user.id}/reset-password`, { method: "POST", body: { password } });
      if (user.id === currentUser.id) {
        close();
        await onResetSelf();
        return;
      }
      toast.success("Password reset.");
      close();
    } catch (caught) {
      if (!isUnauthenticated(caught)) setError(errorText(caught, "Could not reset the password."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <form noValidate onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {user ? `Set a new password for ${user.name}.` : "Set a new password."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-5 py-2">
            <PasswordField
              id="reset-password"
              label="New password"
              value={password}
              autoComplete="new-password"
              onChange={setPassword}
            />
            {error ? (
              <p role="alert" className="text-sm text-ruby">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-11 w-28" />
      </div>
      <div className="hidden flex-col gap-3 rounded-card border border-hairline bg-surface p-4 md:flex">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
