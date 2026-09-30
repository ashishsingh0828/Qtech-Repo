import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { rememberDataset } from "../records/storage";
import { useAuth } from "../auth/auth-gate";

type SearchHit = {
  pages: Array<{ label: string; path: string }>;
  datasets: Array<{ id: string; name: string }>;
  records: Array<{ datasetId: string; rowId: string; label: string; hint: string }>;
  columns: Array<{ datasetId: string; key: string; label: string }>;
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["search", q],
    enabled: open,
    queryFn: () => api<SearchHit>(`/api/search?q=${encodeURIComponent(q)}`),
  });

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  function go(path: string, datasetId?: string) {
    if (datasetId) rememberDataset(user.id, datasetId);
    onOpenChange(false);
    void navigate(path);
  }

  const hit = query.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Go to</DialogTitle>
        </DialogHeader>
        <div className="px-5 pb-4">
          <Input autoFocus aria-label="Command palette" placeholder="Records, datasets, pages" value={q} onChange={(event) => setQ(event.target.value)} />
          <div className="mt-3 flex max-h-80 flex-col overflow-auto">
            {hit?.pages.map((page) => (
              <Hit key={page.path} label={page.label} hint="Page" onClick={() => go(page.path)} />
            ))}
            {hit?.datasets.map((dataset) => (
              <Hit key={dataset.id} label={dataset.name} hint="Dataset" onClick={() => go(`/records/${dataset.id}`, dataset.id)} />
            ))}
            {hit?.records.map((record) => (
              <Hit
                key={`${record.datasetId}:${record.rowId}`}
                label={record.label}
                hint={record.hint}
                onClick={() => go(`/records/${record.datasetId}?row=${record.rowId}`, record.datasetId)}
              />
            ))}
            {hit?.columns.map((column) => (
              <Hit
                key={`${column.datasetId}:${column.key}`}
                label={column.label}
                hint="Column"
                onClick={() => go("/schema", column.datasetId)}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Hit({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" className="flex min-h-11 items-center justify-between gap-3 rounded-control px-2 text-left hover:bg-surface-2" onClick={onClick}>
      <span className="truncate text-sm text-ink">{label}</span>
      <span className="shrink-0 text-xs text-ink-2">{hint}</span>
    </button>
  );
}
