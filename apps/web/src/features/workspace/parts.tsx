import { MAX_UPLOAD_MB, ROLE_COPY } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
  Skeleton,
  Textarea,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { cn } from "../../lib/utils";
import { useAuth } from "../auth/auth-gate";
import { rememberDataset } from "../records/storage";
import { getActiveKey, subscribeActive } from "./keyboard";
import type { KpiCard, WorkCardItem } from "./types";

const emptyActive = (): string => "";

export function WorkspaceHeader() {
  const { user } = useAuth();
  const copy = ROLE_COPY[user.role];
  return <PageHeader title={copy.title} subtitle={copy.blurb} />;
}

export function KpiRow({ datasetId }: { datasetId: string | null }) {
  const query = useQuery({
    queryKey: ["kpis", datasetId],
    queryFn: () => api<{ today: string; kpis: KpiCard[] }>(`/api/metrics/kpis${datasetId ? `?datasetId=${datasetId}` : ""}`),
  });
  if (query.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <p className="text-sm text-ink-2">Could not load the summary.</p>;
  }
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {query.data.kpis.map((card) => (
        <KpiTile key={card.key} card={card} />
      ))}
    </div>
  );
}

function KpiTile({ card }: { card: KpiCard }) {
  const late = /overdue|expired|late|unverified|missing/i.test(`${card.key} ${card.label}`);
  const soon = /due|pending|soon|expir/i.test(`${card.key} ${card.label}`);
  const body = (
    <>
      <b className="mb-1 block font-serif text-[40px] font-semibold leading-none text-ink">{card.value}</b>
      <span className="text-[13px] text-ink-2">{card.label}</span>
      {card.hint ? <p className="mt-1 text-xs text-muted">{card.hint}</p> : null}
    </>
  );
  const className = cn(
    "block rounded-card border border-hairline border-l-4 bg-surface px-3.5 py-3 text-left transition-colors duration-motion hover:bg-surface-2",
    late ? "border-l-ruby" : soon ? "border-l-amber" : "border-l-pri",
  );
  if (!card.href) return <div className={className}>{body}</div>;
  return (
    <Link to={card.href} className={className}>
      {body}
    </Link>
  );
}

export function WorkCardView({
  datasetId,
  item,
  selected,
  onToggle,
  onOpen,
  children,
}: {
  datasetId: string;
  item: WorkCardItem;
  selected?: boolean;
  onToggle?: (rowId: string) => void;
  onOpen: (rowId: string) => void;
  children?: ReactNode;
}) {
  const active = useSyncExternalStore(subscribeActive, getActiveKey, emptyActive) === `${datasetId}:${item.rowId}`;
  const equipment = [item.equipment, item.serial].filter(Boolean).join(" · ");
  return (
    <article
      data-work-card=""
      data-card-key={`${datasetId}:${item.rowId}`}
      data-dataset-id={datasetId}
      data-row-id={item.rowId}
      tabIndex={0}
      className={cn("rounded-card border border-hairline bg-surface p-4 outline-none", active && "ring-1 ring-gold")}
    >
      <div className="flex items-start gap-3">
        {onToggle ? (
          <input
            type="checkbox"
            className="mt-1 size-4 accent-navy"
            checked={selected === true}
            aria-label={`Select ${item.customer}`}
            onChange={() => onToggle(item.rowId)}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <button type="button" className="max-w-full truncate text-left text-[15px] font-semibold text-ink" onClick={() => onOpen(item.rowId)}>
            {item.customer}
          </button>
          {equipment ? <p className="truncate text-sm text-ink-2">{equipment}</p> : null}
          {item.engineer ? <p className="truncate text-sm text-ink-2">{item.engineer}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {item.pills.map((pill) => (
              <Pill key={pill.label} tone={pill.tone}>
                {pill.label}
              </Pill>
            ))}
          </div>
          {item.summary ? <p className="mt-2 truncate text-sm text-ink-2">{item.summary}</p> : null}
          {item.pmsLabel || item.scheduled ? (
            <p className="mt-1 text-sm text-ink">
              {[item.pmsLabel, item.scheduled].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {item.address ? <p className="mt-1 truncate text-sm text-ink-2">{item.address}</p> : null}
          {item.callType ? (
            <p className="mt-1 truncate text-sm text-ink-2">
              {item.callType}
              {item.callDescription ? ` · ${item.callDescription}` : ""}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.phone ? (
              <Button size="sm" variant="secondary" asChild>
                <a href={`tel:${item.phone}`}>Call</a>
              </Button>
            ) : null}
            {item.email ? (
              <Button size="sm" variant="secondary" asChild>
                <a href={`mailto:${item.email}`}>Email</a>
              </Button>
            ) : null}
            {item.phone ? (
              <Button size="sm" variant="secondary" asChild>
                <a href={`https://wa.me/${item.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
          {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
        </div>
      </div>
    </article>
  );
}

export function WorkList({
  datasetId,
  items,
  total,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  selected,
  onToggle,
  renderActions,
  empty = "Nothing in this queue.",
  searchable = true,
}: {
  datasetId: string;
  items: WorkCardItem[];
  total: number;
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (rowId: string) => void;
  selected?: Set<string>;
  onToggle?: (rowId: string) => void;
  renderActions?: (item: WorkCardItem) => ReactNode;
  empty?: string;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter((item) => `${item.customer} ${item.equipment} ${item.serial} ${item.engineer ?? ""} ${item.summary}`.toLowerCase().includes(needle))
    : items;
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (error && !isUnauthenticated(error)) {
    return <p className="text-sm text-ruby">{errorText(error, "Could not load records.")}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {searchable ? (
        <Input data-search="" value={q} aria-label="Search" placeholder="Search" onChange={(event) => setQ(event.target.value)} />
      ) : null}
      {shown.length === 0 ? <EmptyState message={empty} /> : null}
      {shown.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-hairline bg-surface md:block">
            <table className="w-full min-w-[720px] border-collapse text-[15px]">
              <thead>
                <tr>
                  {onToggle ? <th className="w-10 border-b-2 border-hairline px-2 py-2" /> : null}
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Date</th>
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Machine</th>
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Customer</th>
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Engineer</th>
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2">Status</th>
                  <th className="border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <WorkTableRow
                    key={item.rowId}
                    datasetId={datasetId}
                    item={item}
                    selected={selected?.has(item.rowId)}
                    onToggle={onToggle}
                    onOpen={onOpen}
                  >
                    {renderActions ? renderActions(item) : null}
                  </WorkTableRow>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {shown.map((item) => (
              <WorkCardView
                key={item.rowId}
                datasetId={datasetId}
                item={item}
                selected={selected?.has(item.rowId)}
                onToggle={onToggle}
                onOpen={onOpen}
              >
                {renderActions ? renderActions(item) : null}
              </WorkCardView>
            ))}
          </div>
        </>
      ) : null}
      {hasMore ? (
        <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : `Load more (${items.length} of ${total})`}
        </Button>
      ) : null}
    </div>
  );
}

function WorkTableRow({
  datasetId,
  item,
  selected,
  onToggle,
  onOpen,
  children,
}: {
  datasetId: string;
  item: WorkCardItem;
  selected?: boolean;
  onToggle?: (rowId: string) => void;
  onOpen: (rowId: string) => void;
  children?: ReactNode;
}) {
  const active = useSyncExternalStore(subscribeActive, getActiveKey, emptyActive) === `${datasetId}:${item.rowId}`;
  const stripe =
    item.bucket === "overdue"
      ? "shadow-[inset_3px_0_0_var(--ruby)]"
      : item.bucket === "today"
        ? "shadow-[inset_3px_0_0_var(--amber)]"
        : item.bucket === "week"
          ? "shadow-[inset_3px_0_0_var(--gold)]"
          : "shadow-[inset_3px_0_0_var(--hairline)]";
  return (
    <tr
      data-work-card=""
      data-card-key={`${datasetId}:${item.rowId}`}
      data-dataset-id={datasetId}
      data-row-id={item.rowId}
      tabIndex={0}
      className={cn("border-b border-hairline align-top last:border-b-0", stripe, active && "bg-gold-soft")}
    >
      {onToggle ? (
        <td className="px-2 py-2">
          <input
            type="checkbox"
            className="size-4 accent-pri"
            checked={selected === true}
            aria-label={`Select ${item.customer}`}
            onChange={() => onToggle(item.rowId)}
          />
        </td>
      ) : null}
      <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">{item.scheduled || "—"}</td>
      <td className="px-2.5 py-2">
        <button type="button" className="text-left font-medium text-ink" onClick={() => onOpen(item.rowId)}>
          {item.equipment || "—"}
        </button>
        {item.serial ? <div className="text-[13px] text-ink-2">{item.serial}{item.pmsLabel ? `, ${item.pmsLabel}` : ""}</div> : null}
      </td>
      <td className="px-2.5 py-2">
        <button type="button" className="text-left font-medium text-ink" onClick={() => onOpen(item.rowId)}>
          {item.customer}
        </button>
        {item.city ? <div className="text-[13px] text-ink-2">{item.city}</div> : null}
      </td>
      <td className="px-2.5 py-2 text-[15px] text-ink">{item.engineer || "Unassigned"}</td>
      <td className="px-2.5 py-2">
        <div className="flex flex-wrap gap-1">
          {item.pills.map((pill) => (
            <Pill key={pill.label} tone={pill.tone}>
              {pill.label}
            </Pill>
          ))}
        </div>
        {item.summary ? <div className="mt-1 text-[13px] text-ink-2">{item.summary}</div> : null}
      </td>
      <td className="px-2.5 py-2">
        <div className="flex flex-wrap gap-2">{children}</div>
      </td>
    </tr>
  );
}

export function UploadDropzone() {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const [over, setOver] = useState(false);

  async function submit(file: File) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Please save the file as .xlsx");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`Files must be ${MAX_UPLOAD_MB} MB or smaller.`);
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ dataset: { id: string } }>("/api/datasets/import", { method: "POST", body });
      rememberDataset(user.id, result.dataset.id);
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Workbook imported.");
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not import the workbook."));
    } finally {
      setPending(false);
    }
  }

  return (
    <label
      className={cn(
        "flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-gold bg-gold-soft px-6 py-10 text-center",
        over && "bg-surface",
        pending && "pointer-events-none opacity-60",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) void submit(file);
      }}
    >
      <span className="font-serif text-[28px] font-semibold text-ink">Upload Excel</span>
      <span className="text-sm text-ink-2">Drop an .xlsx file here, or choose one. Same columns as the data handling sheet.</span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void submit(file);
        }}
      />
    </label>
  );
}

export function QuietEmpty() {
  return <EmptyState message="No data yet" />;
}

export function NoteDialog({
  open,
  title,
  description,
  confirmLabel,
  requireDate,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  requireDate?: boolean;
  onClose: () => void;
  onConfirm: (note: string, date: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) {
      setNote("");
      setDate("");
      setPending(false);
    }
  }, [open]);
  const ready = note.trim().length >= 5 && (!requireDate || date.length > 0);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-2">
          <Label htmlFor="workspace-note">Note</Label>
          <Textarea id="workspace-note" value={note} minLength={5} onChange={(event) => setNote(event.target.value)} />
          {requireDate ? (
            <>
              <Label htmlFor="workspace-date">Expected date</Label>
              <Input id="workspace-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!ready || pending}
            onClick={() => {
              setPending(true);
              void onConfirm(note.trim(), date).finally(() => setPending(false));
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SelectionBar({ count, label, onAction, onClear }: { count: number; label: string; onAction: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-20 z-topbar flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface px-4 py-3 md:bottom-4">
      <span className="text-sm text-ink">{count} selected</span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClear}>
          Clear
        </Button>
        <Button onClick={onAction}>{label}</Button>
      </div>
    </div>
  );
}
