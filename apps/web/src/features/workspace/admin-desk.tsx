import { formatDisplayDateTime, hasCapability } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { initials } from "../../lib/initials";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";
import { downloadWorkbook } from "../records/download";
import { bulkAction } from "./actions";
import { KpiRow, QuietEmpty, UploadDropzone, WorkspaceHeader } from "./parts";
import { useSelectedDataset } from "./use-dataset";

type Member = { id: string; name: string; role: "validator" | "service"; open: number; doneToday: number };
type FeedItem = {
  id: string;
  actorName: string;
  action: string;
  summary: string;
  datasetId: string | null;
  datasetName: string | null;
  rowId: string | null;
  createdAt: string;
};
type Board = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  updatedAt: string;
  uploadedByName: string;
  stages: Array<{ key: string; label: string; count: number }>;
};
type Health = {
  duplicateSerials: number;
  missingEndDate: number;
  autoNamedColumns: number;
  historicalPms: number;
  historicalRowIds: string[];
};

const STAGE_COLOR = ["bg-stone", "bg-amber", "bg-gold", "bg-ruby"];

export function AdminDesk() {
  const { user, timeZone } = useAuth();
  const navigate = useNavigate();
  const selected = useSelectedDataset();
  const datasetId = selected.id;
  const workload = useQuery({
    queryKey: ["workload", datasetId],
    queryFn: () => api<{ members: Member[] }>(`/api/team/workload${datasetId ? `?datasetId=${datasetId}` : ""}`),
  });
  const feed = useQuery({
    queryKey: ["activity-feed", "home", datasetId],
    queryFn: () => api<{ items: FeedItem[] }>(`/api/activity?limit=15${datasetId ? `&datasetId=${datasetId}` : ""}`),
  });
  const boards = useQuery({
    queryKey: ["boards"],
    queryFn: () => api<{ boards: Board[] }>("/api/workspace/boards"),
  });
  const health = useQuery({
    queryKey: ["health", datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<Health>(`/api/datasets/${datasetId}/health`),
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const peak = Math.max(1, ...(workload.data?.members.map((member) => member.open) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceHeader />
      <KpiRow datasetId={datasetId} />
      {selected.loading ? <Skeleton className="h-40" /> : null}
      {!selected.loading && selected.datasets.length === 0 ? <UploadDropzone /> : null}
      {!selected.loading && selected.datasets.length > 0 && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl text-ink">Team workload</h2>
            {workload.isPending ? <Skeleton className="h-24" /> : null}
            {workload.data?.members.map((member) => (
              <div key={member.id} className="rounded-card border border-hairline bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm text-ink">{member.name}</p>
                  <p className="shrink-0 text-xs uppercase tracking-wide text-ink-2">{member.role}</p>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-gold" style={{ width: `${Math.round((member.open / peak) * 100)}%` }} />
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  {member.open} open · {member.doneToday} done today
                </p>
              </div>
            ))}
            {workload.data && workload.data.members.length === 0 ? <QuietEmpty /> : null}
            <h2 className="mt-4 font-serif text-2xl text-ink">Live activity</h2>
            {feed.isPending ? <Skeleton className="h-24" /> : null}
            <ul className="flex flex-col">
              {feed.data?.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full min-h-11 flex-col items-start border-b border-hairline py-2 text-left"
                    onClick={() => {
                      if (item.datasetId && item.rowId) void navigate(`/records/${item.datasetId}?row=${item.rowId}`);
                    }}
                  >
                    <span className="truncate text-sm text-ink">
                      {item.actorName} · {item.summary}
                    </span>
                    <span className="truncate text-xs text-ink-2">
                      {item.datasetName ? `${item.datasetName} · ` : ""}
                      {formatDisplayDateTime(item.createdAt, timeZone || "UTC")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl text-ink">Datasets</h2>
            {boards.isPending ? <Skeleton className="h-32" /> : null}
            {boards.data?.boards.map((board) => {
              const total = board.stages.reduce((sum, stage) => sum + stage.count, 0);
              return (
                <article key={board.id} className="rounded-card border border-hairline bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs text-canvas">
                      {initials(board.uploadedByName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-xl text-ink">{board.name}</p>
                      <p className="text-sm text-ink-2">
                        {board.rowCount} × {board.columnCount} · {formatDisplayDateTime(board.updatedAt, timeZone || "UTC")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
                    {board.stages.map((stage, index) => (
                      <span
                        key={stage.key}
                        className={STAGE_COLOR[index] ?? "bg-stone"}
                        style={{ width: total > 0 ? `${(stage.count / total) * 100}%` : "0%" }}
                        title={`${stage.label}: ${stage.count}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-2">{board.stages.map((stage) => `${stage.label} ${stage.count}`).join(" · ")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <Link to={`/records/${board.id}`}>Open in Records</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void downloadWorkbook(board.id, board.name).then(
                          () => toast.success("Workbook exported."),
                          (error: unknown) => {
                            if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not export the workbook."));
                          },
                        );
                      }}
                    >
                      Export Excel
                    </Button>
                    {hasCapability(user.role, "deleteDataset") ? (
                      <Button size="sm" variant="secondary" className="text-ruby" onClick={() => setDeleteId(board.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
            <h2 className="mt-4 font-serif text-2xl text-ink">Data health</h2>
            {health.isPending ? <Skeleton className="h-24" /> : null}
            {health.data ? (
              <div className="rounded-card border border-hairline bg-surface p-4 text-sm text-ink">
                <p>{health.data.duplicateSerials} duplicate serial numbers</p>
                <p className="mt-2">{health.data.missingEndDate} rows missing a contract end date</p>
                <p className="mt-2">
                  {health.data.autoNamedColumns} auto-named columns{" "}
                  <Link to="/schema" className="text-gold">
                    Fix
                  </Link>
                </p>
                <p className="mt-2">{health.data.historicalPms} historical PMS rows</p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  disabled={health.data.historicalRowIds.length === 0}
                  onClick={() => {
                    const ids = health.data?.historicalRowIds ?? [];
                    if (!datasetId || ids.length === 0) return;
                    void bulkAction(datasetId, "/bulk/closeHistorical", { rowIds: ids }).catch((error: unknown) => {
                      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not close historical PMS."));
                    });
                  }}
                >
                  Close historical PMS
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
      <Dialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this dataset?</DialogTitle>
            <DialogDescription>It moves to Trash. You can restore it from there.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" disabled={deleting} onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              disabled={deleting || !deleteId}
              onClick={() => {
                if (!deleteId) return;
                setDeleting(true);
                void api(`/api/datasets/${deleteId}`, { method: "DELETE" })
                  .then(async () => {
                    setDeleteId(null);
                    await queryClient.invalidateQueries({ queryKey: ["datasets"] });
                    await queryClient.invalidateQueries({ queryKey: ["boards"] });
                    toast.success("Dataset moved to Trash.");
                  })
                  .catch((error: unknown) => {
                    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not delete the dataset."));
                  })
                  .finally(() => setDeleting(false));
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
