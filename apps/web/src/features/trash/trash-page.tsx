import { hasCapability } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { formatWhen } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";

type TrashKind = "datasets" | "rows" | "columns" | "groups";
type TrashTab = "datasets" | "rows" | "columns";

type TrashItem = {
  id: string;
  kind: TrashKind;
  name: string;
  datasetName: string;
  datasetId: string | null;
  deletedByName: string;
  deletedAt: string;
  daysLeft: number;
};

const EMPTY: Record<TrashTab, string> = {
  datasets: "No datasets in Trash.",
  rows: "No rows in Trash.",
  columns: "No columns or groups in Trash.",
};

export function TrashPage() {
  const { user } = useAuth();
  const canPurge = hasCapability(user.role, "purgeTrash");
  const [tab, setTab] = useState<TrashTab>("datasets");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purge, setPurge] = useState<TrashItem | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["trash", tab],
    queryFn: () => api<{ items: TrashItem[] }>(`/api/trash?type=${tab}`),
  });

  async function restore(items: TrashItem[]) {
    if (items.length === 0) return;
    setBusy(true);
    try {
      const kinds = [...new Set(items.map((item) => item.kind))];
      for (const kind of kinds) {
        const ids = items.filter((item) => item.kind === kind).map((item) => item.id);
        await api("/api/trash/restore", { method: "POST", body: { kind, ids } });
      }
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(items.length === 1 ? "Restored." : "Selected items restored.");
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not restore."));
    } finally {
      setBusy(false);
    }
  }

  async function purgeItem() {
    if (!purge || confirmText !== "DELETE") return;
    setBusy(true);
    try {
      await api(`/api/trash/${purge.kind}/${encodeURIComponent(purge.id)}`, {
        method: "DELETE",
        body: { confirm: "DELETE" },
      });
      setPurge(null);
      setConfirmText("");
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      toast.success("Deleted permanently.");
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not delete permanently."));
    } finally {
      setBusy(false);
    }
  }

  const items = query.data?.items ?? [];
  const chosen = items.filter((item) => selected.has(item.id));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Trash" subtitle="Items stay here for 30 days." />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as TrashTab);
          setSelected(new Set());
        }}
      >
        <TabsList>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="rows">Rows</TabsTrigger>
          <TabsTrigger value="columns">Columns & Groups</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {query.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : query.isError ? (
            <div className="rounded-card border border-hairline bg-surface p-6">
              <p className="text-sm text-ink-2">Could not load Trash.</p>
              <Button className="mt-4" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-card border border-hairline bg-surface">
              <EmptyState message={EMPTY[tab]} />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={busy || chosen.length === 0} onClick={() => void restore(chosen)}>
                  {busy ? <Spinner /> : null}
                  Restore selected
                </Button>
              </div>
              <div className="hidden min-w-0 overflow-x-auto rounded-card border border-hairline bg-surface md:block">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline text-left text-xs font-medium text-muted">
                      <th className="px-2 py-3">
                        <Checkbox
                          checked={items.every((item) => selected.has(item.id))}
                          aria-label="Select all"
                          onCheckedChange={(state) => setSelected(state === true ? new Set(items.map((item) => item.id)) : new Set())}
                        />
                      </th>
                      <th className="px-3 py-3 font-medium">Item</th>
                      <th className="px-3 py-3 font-medium">Deleted by</th>
                      <th className="px-3 py-3 font-medium">Deleted</th>
                      <th className="px-3 py-3 font-medium">Days left</th>
                      <th className="px-3 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <TrashRow
                        key={item.id}
                        item={item}
                        selected={selected.has(item.id)}
                        canPurge={canPurge}
                        busy={busy}
                        onSelect={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        onRestore={() => void restore([item])}
                        onPurge={() => {
                          setConfirmText("");
                          setPurge(item);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 md:hidden">
                {items.map((item) => (
                  <article key={item.id} className="flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4">
                    <label className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={selected.has(item.id)}
                        aria-label={`Select ${item.name}`}
                        onCheckedChange={(state) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (state === true) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 truncate font-medium text-ink">{item.name}</span>
                    </label>
                    <p className="truncate text-sm text-ink-2">{item.datasetName}</p>
                    <p className="text-sm text-ink-2">{item.deletedByName}</p>
                    <p className="text-sm text-ink-2">{formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })}</p>
                    <Badge>{item.daysLeft} days left</Badge>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void restore([item])}>
                        Restore
                      </Button>
                      {canPurge ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-ruby"
                          onClick={() => {
                            setConfirmText("");
                            setPurge(item);
                          }}
                        >
                          Delete permanently
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
      <Dialog
        open={purge != null}
        onOpenChange={(open) => {
          if (!open) {
            setPurge(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete permanently</DialogTitle>
            <DialogDescription>This cannot be undone. Type DELETE to confirm.</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2">
            <Input value={confirmText} aria-label="Type DELETE" onChange={(event) => setConfirmText(event.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setPurge(null);
                setConfirmText("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button className="bg-ruby text-canvas hover:bg-ruby" disabled={busy || confirmText !== "DELETE"} onClick={() => void purgeItem()}>
              {busy ? <Spinner /> : null}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrashRow({
  item,
  selected,
  canPurge,
  busy,
  onSelect,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  selected: boolean;
  canPurge: boolean;
  busy: boolean;
  onSelect: (checked: boolean) => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="px-2 py-2">
        <Checkbox checked={selected} aria-label={`Select ${item.name}`} onCheckedChange={(state) => onSelect(state === true)} />
      </td>
      <td className="max-w-[16rem] px-3 py-3">
        <span className="block truncate font-medium text-ink">{item.name}</span>
        <span className="block truncate text-xs text-muted">{item.datasetName}</span>
      </td>
      <td className="px-3 py-3 text-ink-2">{item.deletedByName}</td>
      <td className="whitespace-nowrap px-3 py-3 text-ink-2" title={formatWhen(item.deletedAt)}>
        {formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })}
      </td>
      <td className="px-3 py-3">
        <Badge>{item.daysLeft} days left</Badge>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={onRestore}>
            Restore
          </Button>
          {canPurge ? (
            <Button size="sm" variant="secondary" className="text-ruby" onClick={onPurge}>
              Delete permanently
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
