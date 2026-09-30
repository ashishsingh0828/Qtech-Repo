import {
  DEFAULT_ROLE_GROUP_ACCESS,
  labelForGroupKey,
  normalizeAccess,
} from "@app/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
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
  PageHeader,
  Skeleton,
  Spinner,
  Switch,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";

type StoredRole = "validator" | "service";
type Cell = { view: boolean; edit: boolean };
type Draft = Record<StoredRole, Record<string, Cell>>;

type AccessGroup = { groupKey: string; label: string };
type AccessRow = { role: StoredRole; groupKey: string; canView: boolean; canEdit: boolean };
type AccessMatrix = { groups: AccessGroup[]; rows: AccessRow[] };

const ROLES: StoredRole[] = ["validator", "service"];
const accessKey = ["access"] as const;

export function AccessPage() {
  const query = useQuery({
    queryKey: accessKey,
    queryFn: async () => {
      try {
        return await api<AccessMatrix>("/api/access");
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
  });
  const matrix = query.data ?? null;
  const groups = matrix ? groupsFor(matrix) : [];
  const nextStamp = matrix ? stamp(matrix) : "";
  const [state, setState] = useState<{ stamp: string; baseline: Draft; draft: Draft } | null>(null);

  if (matrix) {
    const dirtyNow = state !== null && serialize(state.draft) !== serialize(state.baseline);
    if (!state || (state.stamp !== nextStamp && !dirtyNow)) {
      const draft = toDraft(matrix);
      setState({ stamp: nextStamp, baseline: draft, draft });
    }
  }

  const dirty = state !== null && serialize(state.draft) !== serialize(state.baseline);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (rows: AccessRow[]) => api<AccessMatrix>("/api/access", { method: "PUT", body: { rows } }),
    onSuccess: (result) => {
      const draft = toDraft(result);
      setState({ stamp: stamp(result), baseline: draft, draft });
      queryClient.setQueryData<AccessMatrix | null>(accessKey, result);
      toast.success("Access saved.");
    },
    onError: (error) => {
      if (isUnauthenticated(error)) return;
      toast.error(errorText(error, "Could not save access."));
    },
  });

  function updateCell(role: StoredRole, groupKey: string, patch: Partial<Cell>) {
    setState((current) => {
      if (!current) return current;
      const existing = current.draft[role][groupKey] ?? { view: false, edit: false };
      const next: Cell = { ...existing, ...patch };
      if (patch.edit === true) next.view = true;
      if (patch.view === false) next.edit = false;
      return {
        ...current,
        draft: {
          ...current.draft,
          [role]: { ...current.draft[role], [groupKey]: next },
        },
      };
    });
  }

  if (query.isPending || (matrix && !state)) return <AccessSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Access" subtitle="Admin and Manager always have full access." />
        <div className="rounded-card border border-hairline bg-surface p-6">
          <p className="text-sm text-ink-2">Could not load access.</p>
          <Button className="mt-4" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!matrix || !state) return null;

  const draft = state.draft;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Access"
        subtitle="Admin and Manager always have full access."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setState((current) => (current ? { ...current, draft: defaultsFor(groups) } : current))}
            >
              Reset to defaults
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(rowsFrom(groups, draft))}
            >
              {save.isPending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
          </>
        }
      />
      {groups.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface">
          <EmptyState message="No groups to configure." />
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-card border border-hairline bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs font-medium text-muted">
                <th className="px-4 py-3 font-medium" rowSpan={2}>
                  Group
                </th>
                <th className="px-4 py-3 text-center font-medium" colSpan={2}>
                  Validator
                </th>
                <th className="px-4 py-3 text-center font-medium" colSpan={2}>
                  Service
                </th>
              </tr>
              <tr className="border-b border-hairline text-center text-xs font-medium text-muted">
                <th className="px-3 py-2 font-medium">View</th>
                <th className="px-3 py-2 font-medium">Edit</th>
                <th className="px-3 py-2 font-medium">View</th>
                <th className="px-3 py-2 font-medium">Edit</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.groupKey} className="border-b border-hairline last:border-b-0">
                  <th className="min-w-0 px-4 py-2 text-left text-sm font-medium text-ink">
                    <span className="block truncate">{group.label}</span>
                  </th>
                  {ROLES.map((role) => {
                    const cell = draft[role][group.groupKey] ?? { view: false, edit: false };
                    return (
                      <RoleCells
                        key={role}
                        role={role}
                        label={group.label}
                        cell={cell}
                        disabled={save.isPending}
                        onView={(checked) => updateCell(role, group.groupKey, { view: checked })}
                        onEdit={(checked) => updateCell(role, group.groupKey, { edit: checked })}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>Access changes have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              Stay
            </Button>
            <Button
              onClick={() => {
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleCells({
  role,
  label,
  cell,
  disabled,
  onView,
  onEdit,
}: {
  role: StoredRole;
  label: string;
  cell: Cell;
  disabled: boolean;
  onView: (checked: boolean) => void;
  onEdit: (checked: boolean) => void;
}) {
  const roleLabel = role === "validator" ? "Validator" : "Service";
  return (
    <>
      <td className="px-3 py-1 text-center">
        <Switch
          checked={cell.view}
          disabled={disabled}
          aria-label={`${label} ${roleLabel} view`}
          onCheckedChange={(checked) => onView(checked === true)}
        />
      </td>
      <td className="px-3 py-1 text-center">
        <Switch
          checked={cell.edit}
          disabled={disabled}
          aria-label={`${label} ${roleLabel} edit`}
          onCheckedChange={(checked) => onEdit(checked === true)}
        />
      </td>
    </>
  );
}

function groupsFor(matrix: AccessMatrix): AccessGroup[] {
  const known = new Set(matrix.groups.map((group) => group.groupKey));
  const extras = [...new Set(matrix.rows.map((row) => row.groupKey).filter((key) => !known.has(key)))].sort((a, b) =>
    a.localeCompare(b),
  );
  return [
    ...matrix.groups,
    ...extras.map((groupKey) => ({ groupKey, label: labelForGroupKey(groupKey) })),
  ];
}

function emptyDraft(groups: AccessGroup[]): Draft {
  const draft: Draft = { validator: {}, service: {} };
  for (const group of groups) {
    draft.validator[group.groupKey] = { view: false, edit: false };
    draft.service[group.groupKey] = { view: false, edit: false };
  }
  return draft;
}

function toDraft(matrix: AccessMatrix): Draft {
  const draft = emptyDraft(groupsFor(matrix));
  for (const row of matrix.rows) {
    if (!draft[row.role][row.groupKey]) {
      draft[row.role][row.groupKey] = { view: false, edit: false };
    }
    const normalized = normalizeAccess(row.canView, row.canEdit);
    draft[row.role][row.groupKey] = { view: normalized.canView, edit: normalized.canEdit };
  }
  return draft;
}

function defaultsFor(groups: AccessGroup[]): Draft {
  const draft = emptyDraft(groups);
  for (const row of DEFAULT_ROLE_GROUP_ACCESS) {
    if (!draft[row.role][row.groupKey]) continue;
    draft[row.role][row.groupKey] = { view: row.canView, edit: row.canEdit };
  }
  return draft;
}

function rowsFrom(groups: AccessGroup[], draft: Draft): AccessRow[] {
  const rows: AccessRow[] = [];
  for (const group of groups) {
    for (const role of ROLES) {
      const cell = draft[role][group.groupKey] ?? { view: false, edit: false };
      const normalized = normalizeAccess(cell.view, cell.edit);
      rows.push({
        role,
        groupKey: group.groupKey,
        canView: normalized.canView,
        canEdit: normalized.canEdit,
      });
    }
  }
  return rows;
}

function serialize(draft: Draft): string {
  return JSON.stringify(draft);
}

function stamp(matrix: AccessMatrix): string {
  return JSON.stringify({
    groups: matrix.groups.map((group) => `${group.groupKey}:${group.label}`),
    rows: matrix.rows.map((row) => [row.role, row.groupKey, row.canView, row.canEdit]),
  });
}

function AccessSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
