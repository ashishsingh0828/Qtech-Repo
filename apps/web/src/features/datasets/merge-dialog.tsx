import type { StoredCell } from "@app/shared";
import { MAX_UPLOAD_MB } from "@app/shared";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";

type MergeChange = {
  rowIdentifier: string;
  columnLabel: string;
  from: StoredCell;
  to: StoredCell;
};

type MergePreview = {
  token: string;
  newRows: number;
  updatedRows: number;
  skippedRows: number;
  changes: MergeChange[];
  duplicates: string[];
  ignoredColumns: string[];
  blankSerials: number;
};

export function MergeDialog({
  datasetId,
  datasetName,
  open,
  onOpenChange,
}: {
  datasetId: string | null;
  datasetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setFile(null);
      setPreview(null);
      setError("");
      if (inputRef.current) inputRef.current.value = "";
    }
    onOpenChange(next);
  }

  async function upload() {
    if (!datasetId || !file) {
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
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<MergePreview>(`/api/datasets/${datasetId}/import/preview`, { method: "POST", body });
      setPreview(result);
    } catch (caught) {
      if (!isUnauthenticated(caught)) setError(errorText(caught, "Could not preview the workbook."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!datasetId || !preview) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/datasets/${datasetId}/import/confirm`, { method: "POST", body: { token: preview.token } });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      await queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
      await queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] });
      toast.success("Workbook merged.");
      close(false);
    } catch (caught) {
      if (!isUnauthenticated(caught)) setError(errorText(caught, "Could not merge the workbook."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="md:w-[min(40rem,92vw)]">
        <DialogHeader>
          <DialogTitle>Update from Excel</DialogTitle>
          <DialogDescription>Merge changed cells into {datasetName || "this dataset"}. Existing rows are never deleted.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto px-5 py-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setError("");
            }}
          />
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose file
          </Button>
          <p className="min-w-0 truncate text-sm text-ink-2">{file ? file.name : "No file chosen"}</p>
          {preview ? (
            <div className="flex flex-col gap-3 text-sm text-ink">
              <p>New rows: {preview.newRows}</p>
              <p>Updated rows: {preview.updatedRows}</p>
              <p>Skipped rows: {preview.skippedRows}</p>
              <p>Duplicates: {preview.duplicates.length}</p>
              {preview.blankSerials > 0 ? <p>{preview.blankSerials} rows have a blank Serial NO and will be added as new rows.</p> : null}
              {preview.duplicates.length > 0 ? (
                <ul className="max-h-24 overflow-auto text-ink-2">
                  {preview.duplicates.map((item) => (
                    <li key={item} className="truncate">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p>Ignored columns: {preview.ignoredColumns.length === 0 ? "None" : preview.ignoredColumns.join(", ")}</p>
              {preview.changes.length > 0 ? (
                <div className="min-w-0 overflow-x-auto rounded-control border border-hairline">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-hairline text-muted">
                        <th className="px-2 py-2 font-medium">Row</th>
                        <th className="px-2 py-2 font-medium">Column</th>
                        <th className="px-2 py-2 font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((change, index) => (
                        <tr key={`${change.rowIdentifier}-${change.columnLabel}-${index}`} className="border-b border-hairline last:border-b-0">
                          <td className="max-w-[8rem] truncate px-2 py-2">{change.rowIdentifier}</td>
                          <td className="max-w-[8rem] truncate px-2 py-2">{change.columnLabel}</td>
                          <td className="px-2 py-2">
                            {showCell(change.from)} → {showCell(change.to)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-ink-2">No sample value changes.</p>
              )}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-ruby">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? <Spinner /> : null}
              Confirm merge
            </Button>
          ) : (
            <Button onClick={() => void upload()} disabled={busy || !file}>
              {busy ? <Spinner /> : null}
              Preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function showCell(value: StoredCell): string {
  if (value == null || value === "") return "blank";
  return String(value);
}
