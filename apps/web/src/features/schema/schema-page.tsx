import type { ColumnType, DatasetColumn, DatasetDetail, DatasetGroup } from "@app/shared";
import { COLUMN_TYPES } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Switch,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { useSelectedDataset } from "../workspace/use-dataset";

const TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  integer: "Integer",
  decimal: "Decimal",
  date: "Date",
  phone: "Phone",
  email: "Email",
  status: "Status",
  yesno: "Yes / No",
  category: "Category",
};

export function SchemaEntry() {
  const selected = useSelectedDataset();
  if (selected.loading) return <Skeleton className="h-40" />;
  if (!selected.id) return <EmptyState message="Import a dataset before editing its schema." />;
  return <SchemaPage datasetId={selected.id} />;
}

export function SchemaPage({ datasetId }: { datasetId?: string }) {
  const params = useParams();
  const id = datasetId || params.id || "";
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DatasetColumn | null>(null);
  const [pendingGroup, setPendingGroup] = useState<DatasetGroup | null>(null);
  const query = useQuery({
    queryKey: ["dataset", id],
    queryFn: () => api<{ dataset: DatasetDetail }>(`/api/datasets/${id}`),
  });

  async function refresh(message: string) {
    await queryClient.invalidateQueries({ queryKey: ["dataset", id] });
    await queryClient.invalidateQueries({ queryKey: ["dataset-rows", id] });
    toast.success(message);
  }

  async function run(path: string, method: string, body: unknown, message: string) {
    try {
      await api(`/api/datasets/${id}${path}`, { method, body });
      await refresh(message);
      return true;
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update the structure."));
      return false;
    }
  }

  if (query.isPending) return <SchemaSkeleton />;
  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Structure" subtitle="Columns and groups." />
        <div className="rounded-card border border-hairline bg-surface p-6">
          <p className="text-sm text-ink-2">Could not load this dataset.</p>
          <Button className="mt-4" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const schema = query.data.dataset.schema;
  const groups = [...schema.groups].sort((left, right) => left.order - right.order);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Structure"
        subtitle={query.data.dataset.name}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to={`/records/${id}`}>Records</Link>
            </Button>
            <Button variant="secondary" onClick={() => setAddGroupOpen(true)}>
              Add Group
            </Button>
            <Button onClick={() => setAddColumnOpen(true)}>Add Column</Button>
          </>
        }
      />
      {groups.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface">
          <EmptyState message="This dataset has no groups." action={<Button onClick={() => setAddGroupOpen(true)}>Add Group</Button>} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group, groupIndex) => {
            const columns = schema.columns.filter((column) => column.groupId === group.id).sort((left, right) => left.order - right.order);
            return (
              <details key={group.id} open className="min-w-0 rounded-card border border-hairline bg-surface">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: group.tint }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{group.label}</span>
                  <span className="text-xs tabular-nums text-muted">{columns.length}</span>
                </summary>
                <div className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
                  <div className="flex min-w-0 flex-wrap items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
                      Group name
                      <Input
                        defaultValue={group.label}
                        aria-label={`${group.label} name`}
                        onBlur={(event) => {
                          const label = event.target.value.trim();
                          if (label && label !== group.label) void run(`/groups/${group.id}`, "PATCH", { label }, "Group renamed.");
                        }}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Tint
                      <input
                        type="color"
                        aria-label={`${group.label} tint`}
                        defaultValue={group.tint}
                        className="h-11 w-14 cursor-pointer rounded-control border border-hairline bg-surface"
                        onChange={(event) => void run(`/groups/${group.id}`, "PATCH", { tint: event.target.value }, "Tint updated.")}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={groupIndex === 0}
                      onClick={() => {
                        const previous = groups[groupIndex - 1];
                        if (previous) void run(`/groups/${group.id}/move`, "POST", { beforeGroupId: previous.id }, "Group moved.");
                      }}
                    >
                      Move up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={groupIndex === groups.length - 1}
                      onClick={() => {
                        const next = groups[groupIndex + 1];
                        if (next) void run(`/groups/${group.id}/move`, "POST", { afterGroupId: next.id }, "Group moved.");
                      }}
                    >
                      Move down
                    </Button>
                    <Button size="sm" variant="secondary" className="text-ruby" onClick={() => setPendingGroup(group)}>
                      Delete group
                    </Button>
                  </div>
                  {columns.length === 0 ? (
                    <p className="text-sm text-ink-2">This group has no columns, so it stays off the records page.</p>
                  ) : (
                    <>
                      <div className="hidden min-w-0 flex-col gap-2 md:flex">
                        {columns.map((column, index) => (
                          <ColumnRow
                            key={column.key}
                            column={column}
                            first={index === 0}
                            last={index === columns.length - 1}
                            onPatch={(body, message) => run(`/columns/${encodeURIComponent(column.key)}`, "PATCH", body, message)}
                            onMove={(body) => run(`/columns/${encodeURIComponent(column.key)}/move`, "POST", body, "Column moved.")}
                            previousKey={columns[index - 1]?.key}
                            nextKey={columns[index + 1]?.key}
                            onDelete={() => setPendingDelete(column)}
                          />
                        ))}
                      </div>
                      <div className="flex flex-col gap-3 md:hidden">
                        {columns.map((column, index) => (
                          <article key={column.key} className="flex flex-col gap-3 rounded-control border border-hairline p-3">
                            <ColumnRow
                              column={column}
                              first={index === 0}
                              last={index === columns.length - 1}
                              onPatch={(body, message) => run(`/columns/${encodeURIComponent(column.key)}`, "PATCH", body, message)}
                              onMove={(body) => run(`/columns/${encodeURIComponent(column.key)}/move`, "POST", body, "Column moved.")}
                              previousKey={columns[index - 1]?.key}
                              nextKey={columns[index + 1]?.key}
                              onDelete={() => setPendingDelete(column)}
                            />
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
      <AddColumnDialog
        open={addColumnOpen}
        groups={groups}
        onOpenChange={setAddColumnOpen}
        onCreate={async (body) => {
          const saved = await run("/columns", "POST", body, "Column added.");
          if (saved) setAddColumnOpen(false);
        }}
      />
      <AddGroupDialog
        open={addGroupOpen}
        onOpenChange={setAddGroupOpen}
        onCreate={async (label) => {
          const saved = await run("/groups", "POST", { label }, "Group added.");
          if (saved) setAddGroupOpen(false);
        }}
      />
      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete column"
        description="Values stay in each row for 30 days. You can restore this column from Trash."
        confirmLabel="Delete column"
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const saved = await run(`/columns/${encodeURIComponent(pendingDelete.key)}`, "DELETE", undefined, "Column moved to Trash.");
          if (saved) setPendingDelete(null);
        }}
      />
      <ConfirmDialog
        open={pendingGroup != null}
        title="Delete group"
        description="The group and its columns move to Trash together. Stored values stay for 30 days."
        confirmLabel="Delete group"
        onOpenChange={(open) => {
          if (!open) setPendingGroup(null);
        }}
        onConfirm={async () => {
          if (!pendingGroup) return;
          const saved = await run(`/groups/${pendingGroup.id}`, "DELETE", undefined, "Group moved to Trash.");
          if (saved) setPendingGroup(null);
        }}
      />
    </div>
  );
}

function ColumnRow({
  column,
  first,
  last,
  previousKey,
  nextKey,
  onPatch,
  onMove,
  onDelete,
}: {
  column: DatasetColumn;
  first: boolean;
  last: boolean;
  previousKey?: string;
  nextKey?: string;
  onPatch: (body: { label?: string; type?: ColumnType; hidden?: boolean }, message: string) => Promise<boolean>;
  onMove: (body: { beforeKey?: string; afterKey?: string }) => Promise<boolean>;
  onDelete: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
      <Input
        key={column.label}
        defaultValue={column.label}
        aria-label={`Rename ${column.label}`}
        className="md:max-w-xs"
        onBlur={(event) => {
          const label = event.target.value.trim();
          if (label && label !== column.label) void onPatch({ label }, "Column renamed.");
        }}
      />
      <Select value={column.type} onValueChange={(type) => void onPatch({ type: type as ColumnType }, "Column type updated.")}>
        <SelectTrigger className="md:w-40" aria-label={`Type for ${column.label}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLUMN_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {TYPE_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
        <Switch checked={column.hidden} aria-label={`Hide ${column.label}`} onCheckedChange={(hidden) => void onPatch({ hidden }, hidden ? "Column hidden." : "Column shown.")} />
        Hidden
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={first || !previousKey} onClick={() => previousKey && void onMove({ beforeKey: previousKey })}>
          Move up
        </Button>
        <Button size="sm" variant="secondary" disabled={last || !nextKey} onClick={() => nextKey && void onMove({ afterKey: nextKey })}>
          Move down
        </Button>
        <Button size="sm" variant="secondary" className="text-ruby" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function AddColumnDialog({
  open,
  groups,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  groups: DatasetGroup[];
  onOpenChange: (open: boolean) => void;
  onCreate: (body: {
    label: string;
    type: ColumnType;
    groupId?: string;
    newGroup?: { label: string };
    options?: string[];
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "__new__");
  const [newGroup, setNewGroup] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState<string[]>(["Yes", "No"]);
  const [saving, setSaving] = useState(false);
  const needsOptions = type === "yesno" || type === "status" || type === "category";

  async function submit() {
    setSaving(true);
    try {
      await onCreate({
        label,
        type,
        groupId: groupId === "__new__" ? undefined : groupId,
        newGroup: groupId === "__new__" ? { label: newGroup } : undefined,
        options: needsOptions ? options.map((option) => option.trim()).filter(Boolean) : undefined,
      });
      setLabel("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
          <DialogDescription>The column is added to the chosen group.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 py-2">
          <Label htmlFor="column-label">Label</Label>
          <Input id="column-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <Label>Group</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger aria-label="Target group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.label}
                </SelectItem>
              ))}
              <SelectItem value="__new__">New group...</SelectItem>
            </SelectContent>
          </Select>
          {groupId === "__new__" ? (
            <Input value={newGroup} placeholder="New group name" aria-label="New group name" onChange={(event) => setNewGroup(event.target.value)} />
          ) : null}
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              const next = value as ColumnType;
              setType(next);
              if (next === "yesno") setOptions(["Yes", "No"]);
            }}
          >
            <SelectTrigger aria-label="Column type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_TYPES.map((item) => (
                <SelectItem key={item} value={item}>
                  {TYPE_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsOptions ? <OptionsEditor options={options} onChange={setOptions} /> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !label.trim()}>
            {saving ? <Spinner /> : null}
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Options</Label>
      {options.map((option, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={option}
            aria-label={`Option ${index + 1}`}
            onChange={(event) => onChange(options.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
          />
          <Button variant="secondary" onClick={() => onChange(options.filter((_, itemIndex) => itemIndex !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...options, ""])}>
        Add option
      </Button>
    </div>
  );
}

function AddGroupDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add group</DialogTitle>
          <DialogDescription>Validator and service roles cannot see a new group until Access allows it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 py-2">
          <Label htmlFor="group-label">Label</Label>
          <Input id="group-label" value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || !label.trim()}
            onClick={() => {
              setSaving(true);
              void onCreate(label).finally(() => {
                setSaving(false);
                setLabel("");
              });
            }}
          >
            {saving ? <Spinner /> : null}
            Add group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-ruby text-canvas hover:bg-ruby"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onConfirm().finally(() => setSaving(false));
            }}
          >
            {saving ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SchemaSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
