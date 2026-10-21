import type { DatasetColumn, DatasetDetail, RowProjection } from "@app/shared";
import { formatDisplayDateTime, hasCapability } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Pill, Skeleton, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { initials } from "../../lib/initials";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";
import { downloadWorkbook } from "../records/download";
import { rememberDataset } from "../records/storage";
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
  const detail = useQuery({
    queryKey: ["dataset", datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ dataset: DatasetDetail }>(`/api/datasets/${datasetId}`),
  });
  const contracts = useQuery({
    queryKey: ["dataset-rows", datasetId, "admin-preview"],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ total: number; rows: RowProjection[] }>(`/api/datasets/${datasetId}/rows?limit=12`),
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const peak = Math.max(1, ...(workload.data?.members.map((member) => member.open) ?? [1]));
  const columns = detail.data?.dataset.schema.columns ?? [];

  return (
    <div className="flex flex-col gap-4">
      <WorkspaceHeader />
      <KpiRow datasetId={datasetId} />
      <section className="rounded-card border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-end gap-2">
          {hasCapability(user.role, "importData") ? (
            <Button disabled={uploading} onClick={() => document.getElementById("admin-excel-upload")?.click()}>
              {uploading ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Upload Excel
            </Button>
          ) : null}
          {datasetId ? (
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                void downloadWorkbook(datasetId, "Engineer_Service_Data")
                  .then(() => toast.success("Workbook exported."))
                  .catch((error: unknown) => {
                    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not export the workbook."));
                  })
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? <Spinner /> : null}
              Download Excel
            </Button>
          ) : null}
          {datasetId && hasCapability(user.role, "manageRows") ? (
            <Button
              variant="secondary"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                void api<{ row: RowProjection }>(`/api/datasets/${datasetId}/rows`, { method: "POST", body: { atEnd: true } })
                  .then(async (result) => {
                    await queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] });
                    await queryClient.invalidateQueries({ queryKey: ["boards"] });
                    toast.success("Contract added.");
                    void navigate(`/records/${datasetId}?row=${result.row.id}`);
                  })
                  .catch((error: unknown) => {
                    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not add a contract."));
                  })
                  .finally(() => setAdding(false));
              }}
            >
              {adding ? <Spinner /> : null}
              Add contract
            </Button>
          ) : null}
          {datasetId ? (
            <Button variant="secondary" asChild>
              <Link to={`/records/${datasetId}`}>Open contracts</Link>
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-[13px] text-ink-2">
          Upload reads the same columns as your data handling sheet, with PMS 1 to 15 as scheduled dates and PM Date as the date done. Download writes the same layout.
        </p>
        <input
          id="admin-excel-upload"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;
            if (!file.name.toLowerCase().endsWith(".xlsx")) {
              toast.error("Please save the file as .xlsx");
              return;
            }
            const body = new FormData();
            body.append("file", file);
            setUploading(true);
            void api<{ dataset: { id: string } }>("/api/datasets/import", { method: "POST", body })
              .then(async (result) => {
                rememberDataset(user.id, result.dataset.id);
                await queryClient.invalidateQueries({ queryKey: ["datasets"] });
                await queryClient.invalidateQueries({ queryKey: ["boards"] });
                toast.success("Workbook imported.");
                void navigate(`/records/${result.dataset.id}`);
              })
              .catch((error: unknown) => {
                if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not import the workbook."));
              })
              .finally(() => setUploading(false));
          }}
        />
      </section>
      {datasetId ? (
        <section className="rounded-card border border-hairline bg-surface p-4">
          <h2 className="text-[15px] font-semibold text-ink">Contracts and data validation</h2>
          {contracts.isPending || detail.isPending ? <Skeleton className="mt-3 h-40" /> : null}
          {contracts.isError ? <p className="mt-3 text-sm text-ruby">Could not load contracts.</p> : null}
          {!contracts.isPending && !contracts.isError && (contracts.data?.rows.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No contracts in this sheet yet.</p>
          ) : null}
          {(contracts.data?.rows.length ?? 0) > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Sr</th>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Customer</th>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Machine</th>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Contract</th>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Validated</th>
                    <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2" />
                  </tr>
                </thead>
                <tbody>
                  {contracts.data?.rows.map((row, index) => {
                    const customer = cellText(row, columns, "customer_name") || filledValue(row, columns, 0);
                    const city = cellText(row, columns, "city");
                    const equipment = cellText(row, columns, "equipment", /euipment|equipment|instrument|model/i) || filledValue(row, columns, 1);
                    const serial = cellText(row, columns, "serial");
                    const type = cellText(row, columns, "contract_type");
                    const start = cellText(row, columns, "start_date");
                    const end = cellText(row, columns, "end_date");
                    const validated = cellText(row, columns, "validated") || row.values.validated;
                    const validatedLabel = validated == null || validated === "" ? "No" : String(validated);
                    return (
                      <tr key={row.id} className="border-b border-hairline align-top last:border-b-0">
                        <td className="px-2.5 py-2 tabular-nums text-ink-2">{row.position || index + 1}</td>
                        <td className="px-2.5 py-2">
                          <div className="font-medium text-ink">{customer || "—"}</div>
                          {city ? <div className="text-[13px] text-ink-2">{city}</div> : null}
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="font-medium text-ink">{equipment || "—"}</div>
                          {serial ? <div className="text-[13px] text-ink-2">{serial}</div> : null}
                        </td>
                        <td className="px-2.5 py-2">
                          <div>{type || "—"}</div>
                          {start || end ? <div className="text-[13px] text-ink-2">{[start, end].filter(Boolean).join(" to ")}</div> : null}
                        </td>
                        <td className="px-2.5 py-2">
                          <Pill tone={validatedLabel === "Yes" ? "emerald" : "amber"}>{validatedLabel}</Pill>
                        </td>
                        <td className="px-2.5 py-2">
                          <Button size="sm" variant="secondary" asChild>
                            <Link to={`/records/${datasetId}?row=${row.id}`}>Open</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {(contracts.data?.total ?? 0) > (contracts.data?.rows.length ?? 0) ? (
            <Button className="mt-3" variant="secondary" asChild>
              <Link to={`/records/${datasetId}`}>Open all {contracts.data?.total} contracts</Link>
            </Button>
          ) : null}
        </section>
      ) : null}
      {selected.loading ? <Skeleton className="h-40" /> : null}
      {!selected.loading && selected.datasets.length === 0 ? <UploadDropzone /> : null}
      {!selected.loading && selected.datasets.length > 0 && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-ink">Team workload</h2>
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
            <h2 className="mt-4 text-[15px] font-semibold text-ink">Live activity</h2>
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
            <h2 className="text-[15px] font-semibold text-ink">Excel sheets</h2>
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
                      <p className="truncate text-lg font-semibold text-ink">{board.name}</p>
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
                        void downloadWorkbook(board.id, "Engineer_Service_Data").then(
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
            <h2 className="mt-4 text-[15px] font-semibold text-ink">Data health</h2>
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

function cellText(row: RowProjection, columns: DatasetColumn[], semantic: string, fallback?: RegExp): string {
  const column =
    columns.find((item) => item.semantic === semantic || item.key === semantic) ??
    (fallback ? columns.find((item) => fallback.test(item.label) || fallback.test(item.key)) : undefined);
  if (!column) return "";
  const value = row.values[column.key];
  return value == null || value === "" ? "" : String(value);
}

function filledValue(row: RowProjection, columns: DatasetColumn[], offset: number): string {
  const values = columns
    .map((column) => row.values[column.key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return values[offset] ?? "";
}
