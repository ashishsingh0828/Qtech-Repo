import type { DatasetSummary } from "@app/shared";
import { MAX_UPLOAD_MB, hasCapability } from "@app/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
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
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { formatWhen } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";

type DatasetsResponse = { datasets: DatasetSummary[] };

export function DatasetsPage() {
  const { user } = useAuth();
  const canImport = hasCapability(user.role, "importData");
  const [importOpen, setImportOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      try {
        return await api<DatasetsResponse>("/api/datasets");
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
  });

  async function onExport(dataset: DatasetSummary) {
    setExportingId(dataset.id);
    try {
      await downloadDataset(dataset);
      toast.success("Workbook exported.");
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not export the workbook."));
    } finally {
      setExportingId(null);
    }
  }

  if (query.isPending) return <DatasetsSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Datasets" subtitle="Imported workbooks." />
        <div className="rounded-card border border-hairline bg-surface p-6">
          <p className="text-sm text-ink-2">Could not load datasets.</p>
          <Button className="mt-4" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!query.data) return null;
  const datasets = query.data.datasets;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Datasets"
        subtitle="Imported workbooks."
        actions={canImport ? <Button onClick={() => setImportOpen(true)}>Import workbook</Button> : null}
      />
      {datasets.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface">
          <EmptyState
            message="No datasets yet."
            action={canImport ? <Button onClick={() => setImportOpen(true)}>Import workbook</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <div className="hidden min-w-0 overflow-x-auto rounded-card border border-hairline bg-surface md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-xs font-medium text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Rows</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Imported by</th>
                  <th className="px-4 py-3 font-medium">Imported</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.id} className="border-b border-hairline last:border-b-0">
                    <td className="min-w-0 max-w-[16rem] px-4 py-3 font-medium text-ink">
                      <span className="block truncate">{dataset.name}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-2">{dataset.rowCount}</td>
                    <td className="min-w-0 max-w-[16rem] px-4 py-3 text-ink-2">
                      <span className="block truncate">{dataset.sourceFileName}</span>
                    </td>
                    <td className="min-w-0 px-4 py-3 text-ink-2">
                      <span className="block truncate">{dataset.uploadedByName}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{formatWhen(dataset.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="secondary" disabled={exportingId === dataset.id} onClick={() => void onExport(dataset)}>
                        {exportingId === dataset.id ? <Spinner /> : null}
                        Export
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {datasets.map((dataset) => (
              <article key={dataset.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-surface p-5">
                <h2 className="truncate font-medium text-ink">{dataset.name}</h2>
                <p className="truncate text-sm text-ink-2">{dataset.sourceFileName}</p>
                <p className="text-sm tabular-nums text-ink-2">{dataset.rowCount} rows</p>
                <p className="truncate text-sm text-ink-2">{dataset.uploadedByName}</p>
                <p className="text-sm tabular-nums text-ink-2">{formatWhen(dataset.createdAt)}</p>
                <Button variant="secondary" disabled={exportingId === dataset.id} onClick={() => void onExport(dataset)}>
                  {exportingId === dataset.id ? <Spinner /> : null}
                  Export
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
      {canImport ? (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => {
            toast.success("Workbook imported.");
            void queryClient.invalidateQueries({ queryKey: ["datasets"] });
          }}
        />
      ) : null}
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const importFile = useMutation({
    mutationFn: async (chosen: File) => {
      const body = new FormData();
      body.append("file", chosen);
      return api<{ dataset: DatasetSummary }>("/api/datasets/import", { method: "POST", body });
    },
    onSuccess: () => {
      setFile(null);
      setError("");
      if (inputRef.current) inputRef.current.value = "";
      onOpenChange(false);
      onImported();
    },
    onError: (caught) => {
      if (isUnauthenticated(caught)) return;
      setError(errorText(caught, "Could not import the workbook."));
    },
  });

  function close(next: boolean) {
    if (!next) {
      setFile(null);
      setError("");
      if (inputRef.current) inputRef.current.value = "";
    }
    onOpenChange(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose an .xlsx file.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please save the file as .xlsx");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`File is larger than ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setError("");
    importFile.mutate(file);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form noValidate onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Import workbook</DialogTitle>
            <DialogDescription>Use an .xlsx file. The first sheet that contains data is imported.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 py-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError("");
              }}
            />
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <p className="min-w-0 truncate text-sm text-ink-2">{file ? file.name : "No file chosen"}</p>
            {error ? (
              <p role="alert" className="text-sm text-ruby">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => close(false)} disabled={importFile.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={importFile.isPending || !file}>
              {importFile.isPending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function downloadDataset(dataset: DatasetSummary): Promise<void> {
  const response = await fetch(`/api/datasets/${dataset.id}/export`, { credentials: "same-origin" });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("unauthenticated", { detail: { path: `/api/datasets/${dataset.id}/export` } }));
    throw new ApiError("Sign in required", 401, "UNAUTHENTICATED");
  }
  if (!response.ok) {
    let message = "Could not export the workbook.";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.error === "string") message = payload.error;
    } catch {
      message = "Could not export the workbook.";
    }
    throw new ApiError(message, response.status, "UNKNOWN");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dataset.name.toLowerCase().endsWith(".xlsx") ? dataset.name : `${dataset.name}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function DatasetsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-11 w-36" />
      </div>
      <div className="hidden flex-col gap-3 rounded-card border border-hairline bg-surface p-4 md:flex">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    </div>
  );
}
