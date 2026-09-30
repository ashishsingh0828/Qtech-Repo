import type { ColumnType, DatasetColumn, DatasetDetail, RecentEdit, RowProjection } from "@app/shared";
import {
  COLUMN_TYPES,
  RECENT_EDIT_HOURS,
  ROLE_REGISTRY,
  UNDO_SECONDS,
  canEditGroup,
  canPerformAction,
  hasCapability,
  isServerManagedField,
} from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  Label,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";
import { useRealtime } from "../realtime/realtime";
import { downloadWorkbook } from "./download";
import { MobileCards } from "./records-mobile";
import { CellMenuHost, RecordsGrid } from "./records-grid";
import { RecordDrawer } from "./record-drawer";
import {
  applyView,
  defaultHidden,
  distinctCounts,
  editText,
  layoutColumns,
  type ColumnFilter,
  type SortState,
} from "./model";
import { readDensity, readHiddenColumns, rememberDataset, writeDensity, writeHiddenColumns, type Density } from "./storage";

type RowsResponse = { total: number; rows: RowProjection[] };
type ActiveCell = { rowId: string; columnKey: string };
type EditorState = ActiveCell & { draft: string };
type ConflictState = EditorState & { byName: string; version: number };

export function RecordsPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { revision, deletedName, dismissDeleted } = useRealtime();
  const linkRow = searchParams.get("row") ?? "";
  const linkFocus = searchParams.get("focus") ?? "";
  const linkHandled = useRef("");
  const { user, permissions, countryCode } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const [groupId, setGroupId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [density, setDensity] = useState<Density>(() => readDensity(user.id));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenFor, setHiddenFor] = useState("");
  const [search, setSearch] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [saving, setSaving] = useState(false);
  const [columnQuery, setColumnQuery] = useState("");
  const canManage = hasCapability(user.role, "manageRows");
  const canStructure = hasCapability(user.role, "manageStructure");
  const canRestore = user.role === "admin" || user.role === "manager";
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [insertAt, setInsertAt] = useState<{ column: DatasetColumn; side: "left" | "right" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetColumn | null>(null);
  const [tab, setTab] = useState(() => searchParams.get("tab") ?? "");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerFocus, setDrawerFocus] = useState("");
  const [editedKeys, setEditedKeys] = useState<string[]>([]);
  const [scrollRowId, setScrollRowId] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [validatorId, setValidatorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const showAdvanced = canRestore;

  const datasetQuery = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => api<{ dataset: DatasetDetail }>(`/api/datasets/${datasetId}`),
  });
  const rowsQuery = useQuery({
    queryKey: ["dataset-rows", datasetId, tab],
    queryFn: () => api<RowsResponse>(`/api/datasets/${datasetId}/rows${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`),
  });
  const summaryQuery = useQuery({
    queryKey: ["dataset-summary", datasetId],
    queryFn: () => api<{ filters: Array<{ key: string; label: string; count: number }> }>(`/api/datasets/${datasetId}/summary`),
  });
  const assigneesQuery = useQuery({
    queryKey: ["assignees", datasetId],
    enabled: canStructure || user.role === "admin" || user.role === "manager",
    queryFn: () => api<{ users: Array<{ id: string; name: string; role: string }> }>(`/api/datasets/${datasetId}/assignees`),
  });
  const editsQuery = useQuery({
    queryKey: ["recent-edits", datasetId],
    queryFn: () => api<RecentEdit[]>(`/api/datasets/${datasetId}/recent-edits`),
  });

  const detail = datasetQuery.data?.dataset;
  const sourceRows = rowsQuery.data?.rows ?? [];

  useEffect(() => {
    rememberDataset(user.id, datasetId);
  }, [user.id, datasetId]);

  function chooseTab(next: string) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set("tab", next);
    else params.delete("tab");
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    setTab(searchParams.get("tab") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (!linkRow) return;
    const token = `${linkRow}|${linkFocus}`;
    if (linkHandled.current === token) return;
    linkHandled.current = token;
    setSearch("");
    setRecentOnly(false);
    setFilters({});
    setDrawerId(linkRow);
    setEditedKeys(linkFocus.split(",").map((key) => key.trim()).filter(Boolean));
    setScrollRowId(linkRow);
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 3000);
    return () => window.clearTimeout(timer);
  }, [linkFocus, linkRow]);

  useEffect(() => {
    if (!linkRow || rowsQuery.isFetching || sourceRows.some((row) => row.id === linkRow) || !tab) return;
    chooseTab("");
  }, [linkRow, rowsQuery.isFetching, sourceRows, tab]);

  useEffect(() => {
    if (!detail) return;
    const usable = detail.schema.groups.filter((group) => detail.schema.columns.some((column) => column.groupId === group.id));
    if (usable.some((group) => group.id === groupId)) return;
    const editable = usable.find((group) => canEditGroup(permissions.groupAccess, group.groupKey));
    setGroupId(editable?.id ?? usable[0]?.id ?? "");
  }, [detail, groupId, permissions.groupAccess]);

  useEffect(() => {
    if (!detail || hiddenFor === detail.id) return;
    const stored = readHiddenColumns(user.id, detail.id);
    setHidden(new Set(stored ?? defaultHidden(detail.schema)));
    setHiddenFor(detail.id);
  }, [detail, hiddenFor, user.id]);

  useEffect(() => {
    if (!detail || hiddenFor !== detail.id) return;
    writeHiddenColumns(user.id, detail.id, [...hidden]);
  }, [detail, hidden, hiddenFor, user.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea")) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 160);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const onRange = useCallback((start: number, end: number) => {
    setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  const recentSince = Date.now() - RECENT_EDIT_HOURS * 60 * 60 * 1000;
  const layout = useMemo(
    () => (detail ? layoutColumns(detail.schema, groupId, advanced, hidden) : { pinned: [], scroll: [] }),
    [detail, groupId, advanced, hidden],
  );
  const viewColumns = useMemo(() => {
    if (!detail) return [];
    return detail.schema.columns.filter((column) => !hidden.has(column.key));
  }, [detail, hidden]);
  const filtered = useMemo(
    () => applyView(sourceRows, viewColumns, filters, sort, search, recentOnly, recentSince),
    [sourceRows, viewColumns, filters, sort, search, recentOnly, recentSince],
  );
  const recent = useMemo(() => {
    const map = new Map<string, RecentEdit>();
    for (const edit of editsQuery.data ?? []) {
      const key = `${edit.rowId}:${edit.columnKey}`;
      if (!map.has(key)) map.set(key, edit);
    }
    return map;
  }, [editsQuery.data]);

  function canEditColumn(column: DatasetColumn): boolean {
    if (!detail) return false;
    if (isServerManagedField(column.key) || (column.semantic != null && isServerManagedField(column.semantic))) return false;
    const group = detail.schema.groups.find((item) => item.id === column.groupId);
    return group != null && canEditGroup(permissions.groupAccess, group.groupKey);
  }

  function deny(column: DatasetColumn) {
    if (isServerManagedField(column.key) || (column.semantic != null && isServerManagedField(column.semantic))) {
      toast.error("This field is updated by the system.");
      return;
    }
    const names =
      detail?.schema.groups
        .filter((group) => canEditGroup(permissions.groupAccess, group.groupKey))
        .map((group) => group.label)
        .join(", ") || "none";
    toast.error(`Your role (${ROLE_REGISTRY[user.role].label}) can edit ${names} only.`);
  }

  async function saveChanges(row: RowProjection, changes: Record<string, string | null>, version = row.version): Promise<boolean> {
    const keys = Object.keys(changes);
    if (keys.length === 0) return true;
    const key = ["dataset-rows", datasetId] as const;
    const snapshot = queryClient.getQueryData<RowsResponse>(key);
    setSaving(true);
    try {
      const result = await api<{ row: RowProjection }>(`/api/datasets/${datasetId}/rows/${row.id}`, {
        method: "PATCH",
        body: { version, changes },
      });
      queryClient.setQueryData<RowsResponse>(key, (current) =>
        current ? { ...current, rows: current.rows.map((item) => (item.id === row.id ? result.row : item)) } : current,
      );
      if (keys.length === 1 && keys[0]) setFlash(`${row.id}:${keys[0]}`);
      setConflict(null);
      void queryClient.invalidateQueries({ queryKey: ["recent-edits", datasetId] });
      void queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
      return true;
    } catch (error) {
      if (snapshot) queryClient.setQueryData(key, snapshot);
      if (error instanceof ApiError && error.status === 409 && isProjection(error.body?.current)) {
        const current = error.body.current;
        queryClient.setQueryData<RowsResponse>(key, (existing) =>
          existing ? { ...existing, rows: existing.rows.map((item) => (item.id === row.id ? current : item)) } : existing,
        );
        const columnKey = keys[0] ?? "";
        const draft = columnKey ? String(changes[columnKey] ?? "") : "";
        setConflict({ rowId: row.id, columnKey, draft, byName: current.updatedByName, version: current.version });
        setEditor({ rowId: row.id, columnKey, draft });
        return false;
      }
      if (error instanceof ApiError && error.status === 403) {
        const blocked = Array.isArray(error.body?.blockedFields)
          ? error.body.blockedFields.filter((item): item is string => typeof item === "string")
          : [];
        toast.error(blocked.length > 0 ? `${error.message} ${blocked.join(", ")}` : error.message);
        return false;
      }
      if (!isUnauthenticated(error)) {
        toast.error(errorText(error, "Could not save the cell."), {
          action: { label: "Retry", onClick: () => void saveChanges(row, changes, version) },
        });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  function commit(draft: string, move?: "next" | "prev") {
    if (!editor || !detail) return;
    const row = sourceRows.find((item) => item.id === editor.rowId);
    const column = detail.schema.columns.find((item) => item.key === editor.columnKey);
    setEditor(null);
    if (move) shift(editor, move);
    if (!row || !column) return;
    const next = draft.trim() === "" ? null : draft;
    const previous = editText(column, row.values[column.key]);
    if ((next ?? "") === previous && !(conflict?.rowId === row.id && conflict.columnKey === column.key)) return;
    const version = conflict?.rowId === row.id && conflict.columnKey === column.key ? conflict.version : row.version;
    void saveChanges(row, { [column.key]: next }, version);
  }

  function shift(cell: ActiveCell, move: "next" | "prev") {
    const columns = [...layout.pinned, ...layout.scroll];
    const rowIndex = filtered.findIndex((row) => row.id === cell.rowId);
    const columnIndex = columns.findIndex((column) => column.key === cell.columnKey);
    if (rowIndex < 0 || columnIndex < 0) return;
    let nextColumn = columnIndex + (move === "next" ? 1 : -1);
    let nextRow = rowIndex;
    if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    }
    const row = filtered[nextRow];
    const column = columns[nextColumn];
    if (!row || !column) return;
    setActive({ rowId: row.id, columnKey: column.key });
  }

  async function mutateRow(path: string, method: string, body?: unknown, success?: string): Promise<boolean> {
    setSaving(true);
    try {
      await api(path, { method, body });
      if (success) toast.success(success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] }),
        queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] }),
      ]);
      return true;
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update the row."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function removeFilter(key: string) {
    setFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  if (datasetQuery.isPending || rowsQuery.isPending) return <RecordsSkeleton />;
  if (datasetQuery.isError || rowsQuery.isError || !detail) {
    const removedBy = deletedName(datasetId);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Records" subtitle="Imported rows." />
        {removedBy ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-gold-soft px-4 py-3">
            <p className="text-sm text-ink">This dataset was deleted by {removedBy}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate("/records")}>Back</Button>
              {canRestore ? (
                <Button
                  onClick={() => {
                    void api("/api/trash/restore", { method: "POST", body: { kind: "datasets", ids: [datasetId] } })
                      .then(async () => {
                        dismissDeleted(datasetId);
                        await queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
                        toast.success("Dataset restored.");
                      })
                      .catch((error: unknown) => toast.error(errorText(error, "Could not restore the dataset.")));
                  }}
                >
                  Restore
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="rounded-card border border-hairline bg-surface p-6">
          <p className="text-sm text-ink-2">{removedBy ? "This dataset is in Trash." : "Could not load this dataset."}</p>
          <Button
            className="mt-4"
            onClick={() => {
              void datasetQuery.refetch();
              void rowsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const activeRow = sourceRows.find((row) => row.id === active?.rowId);
  const displayGroups = detail.schema.groups.filter((group) => detail.schema.columns.some((column) => column.groupId === group.id));
  const autoNamedCount = detail.schema.columns.filter((column) => column.autoNamed).length;
  const groupColumns = detail.schema.columns.filter((column) => column.groupId === groupId && !hidden.has(column.key));
  const visibleGroups = displayGroups.length;
  const visibleColumnCount = detail.schema.columns.filter((column) => !hidden.has(column.key)).length;

  return (
    <div className="flex min-w-0 flex-col gap-3 md:h-[calc(100dvh-var(--topbar-h)-3rem)] md:max-h-[calc(100dvh-var(--topbar-h)-3rem)] md:min-h-0 md:overflow-hidden xl:h-[calc(100dvh-var(--topbar-h)-4rem)] xl:max-h-[calc(100dvh-var(--topbar-h)-4rem)]">
      {deletedName(datasetId) ? (
        <div className="fixed inset-x-0 top-[var(--topbar-h)] z-popover flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-gold-soft px-4 py-3">
          <p className="text-sm text-ink">This dataset was deleted by {deletedName(datasetId)}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate("/records")}>Back</Button>
            {canRestore ? (
              <Button
                onClick={() => {
                  void api("/api/trash/restore", { method: "POST", body: { kind: "datasets", ids: [datasetId] } })
                    .then(async () => {
                      dismissDeleted(datasetId);
                      await queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
                      toast.success("Dataset restored.");
                    })
                    .catch((error: unknown) => toast.error(errorText(error, "Could not restore the dataset.")));
                }}
              >
                Restore
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <PageHeader
        title={detail.name}
        subtitle="Records"
        actions={
          <>
            <Badge>{detail.rowCount} rows</Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Export</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="flex flex-col">
                  <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => void exportRows(detail.name)}>
                    All rows
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2"
                    onClick={() => void exportRows(detail.name, filtered.map((row) => row.id))}
                  >
                    Current view ({filtered.length} rows)
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
                    disabled={selected.size === 0}
                    onClick={() => void exportRows(detail.name, [...selected])}
                  >
                    Selected ({selected.size} rows)
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            {showAdvanced ? (
              <Button variant={advanced ? "primary" : "secondary"} className="hidden md:inline-flex" onClick={() => setAdvanced((value) => !value)}>
                All columns
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-hairline">
        <button
          type="button"
          className={`min-h-11 shrink-0 border-b-2 px-3 text-sm ${tab === "" ? "border-gold text-ink" : "border-transparent text-ink-2"}`}
          onClick={() => chooseTab("")}
        >
          All
        </button>
        {(summaryQuery.data?.filters ?? []).map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm ${tab === filter.key ? "border-gold text-ink" : "border-transparent text-ink-2"}`}
            onClick={() => chooseTab(tab === filter.key ? "" : filter.key)}
          >
            {filter.label}
            <Badge>{filter.count}</Badge>
          </button>
        ))}
      </div>
      {canStructure && autoNamedCount > 0 && !bannerDismissed ? (
        <div className="flex min-w-0 items-start justify-between gap-3 rounded-control border border-hairline bg-gold-soft px-3 py-2 text-sm text-ink">
          <p>
            {autoNamedCount} {autoNamedCount === 1 ? "column" : "columns"} had no header and {autoNamedCount === 1 ? "was" : "were"} auto-named. Rename it from the column header.
          </p>
          <button type="button" className="min-h-11 shrink-0 px-2" onClick={() => setBannerDismissed(true)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {displayGroups.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface">
          <EmptyState message="Nothing in this dataset is visible to your role." />
        </div>
      ) : (
        <>
          <Tabs value={groupId} onValueChange={setGroupId}>
            <TabsList>
              {displayGroups.map((group) => {
                const count = detail.schema.columns.filter((column) => column.groupId === group.id).length;
                const locked = !canEditGroup(permissions.groupAccess, group.groupKey);
                return (
                  <TabsTrigger key={group.id} value={group.id}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      {locked ? <Lock className="size-3.5 text-gold" strokeWidth={1.5} /> : null}
                      <span className="truncate">{group.label}</span>
                      <Badge>{count}</Badge>
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              ref={searchRef}
              value={search}
              placeholder="Search visible columns"
              aria-label="Search"
              data-search=""
              className="max-w-xs"
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant={recentOnly ? "primary" : "secondary"} onClick={() => setRecentOnly((value) => !value)}>
              Recently updated
            </Button>
            <Button variant={density === "comfortable" ? "primary" : "secondary"} className="hidden md:inline-flex" onClick={() => chooseDensity("comfortable")}>
              Comfortable
            </Button>
            <Button variant={density === "compact" ? "primary" : "secondary"} className="hidden md:inline-flex" onClick={() => chooseDensity("compact")}>
              Compact
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Columns</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <Input value={columnQuery} placeholder="Search columns" aria-label="Search columns" onChange={(event) => setColumnQuery(event.target.value)} />
                <div className="mt-2 flex max-h-64 flex-col overflow-auto">
                  {detail.schema.columns
                    .filter((column) => column.label.toLowerCase().includes(columnQuery.trim().toLowerCase()))
                    .map((column) => (
                      <label key={column.key} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
                        <Checkbox
                          checked={!hidden.has(column.key)}
                          aria-label={column.label}
                          onCheckedChange={(state) => {
                            setHidden((current) => {
                              const next = new Set(current);
                              if (state === true) next.delete(column.key);
                              else next.add(column.key);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 truncate">{column.label}</span>
                      </label>
                    ))}
                </div>
                <Button
                  className="mt-2"
                  variant="secondary"
                  onClick={() => setHidden(new Set(defaultHidden(detail.schema)))}
                >
                  Reset to default
                </Button>
              </PopoverContent>
            </Popover>
            {canManage ? (
              <Button onClick={() => void mutateRow(`/api/datasets/${datasetId}/rows`, "POST", { atEnd: true }, "Row added.")} disabled={saving}>
                {saving ? <Spinner /> : null}
                + New row
              </Button>
            ) : null}
          </div>
          <FilterBar
            filters={filters}
            sort={sort}
            search={search}
            recentOnly={recentOnly}
            columns={detail.schema.columns}
            onRemove={removeFilter}
            onClear={() => {
              setFilters({});
              setSort(null);
              setSearch("");
              setRecentOnly(false);
            }}
            onClearSort={() => setSort(null)}
            onClearSearch={() => setSearch("")}
            onClearRecent={() => setRecentOnly(false)}
          />
          {conflict ? (
            <p className="rounded-control border border-hairline bg-gold-soft px-3 py-2 text-sm text-ink">
              Updated by {conflict.byName || "someone"} —{" "}
              <button type="button" className="font-medium underline" onClick={() => { setConflict(null); setEditor(null); }}>
                Reload
              </button>
              {" / "}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  const row = sourceRows.find((item) => item.id === conflict.rowId);
                  if (!row) return;
                  void saveChanges(row, { [conflict.columnKey]: conflict.draft.trim() === "" ? null : conflict.draft }, conflict.version);
                }}
              >
                Overwrite
              </button>
            </p>
          ) : null}
          {activeRow ? (
            <p className="truncate text-sm text-ink-2">
              Updated {formatDistanceToNow(new Date(activeRow.updatedAt), { addSuffix: true })}
              {activeRow.updatedByName ? ` by ${activeRow.updatedByName}` : ""}
            </p>
          ) : null}
          <div className="hidden min-h-48 min-w-0 flex-1 md:flex">
            <RecordsGrid
              datasetId={datasetId}
              rows={filtered}
              allRows={sourceRows}
              pinned={layout.pinned}
              scrollColumns={layout.scroll}
              groups={displayGroups}
              advanced={advanced}
              rowHeight={density === "compact" ? 32 : 40}
              selectedRows={selected}
              activeCell={active}
              editor={editor}
              flashKey={flash}
              scrollRowId={scrollRowId}
              pulseKeys={pulse ? editedKeys : []}
              recent={recent}
              filters={filters}
              sort={sort}
              search={search}
              canManage={canManage}
              canRestore={canRestore}
              canEditColumn={canEditColumn}
              optionsFor={(column) => distinctCounts(sourceRows, column).map((item) => item.value).filter((value) => value !== "(Blank)")}
              onActiveCell={setActive}
              onStartEdit={(row, column) => {
                const draft = conflict?.rowId === row.id && conflict.columnKey === column.key ? conflict.draft : editText(column, row.values[column.key]);
                setActive({ rowId: row.id, columnKey: column.key });
                setEditor({ rowId: row.id, columnKey: column.key, draft });
              }}
              onDraft={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
              onCommit={commit}
              onCancel={() => setEditor(null)}
              onToggleRow={(rowId, checked) => {
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(rowId);
                  else next.delete(rowId);
                  return next;
                });
              }}
              onToggleAll={(checked) => setSelected(checked ? new Set(filtered.map((row) => row.id)) : new Set())}
              onFilter={(key, filter) => {
                setFilters((current) => {
                  const next = { ...current };
                  if (filter) next[key] = filter;
                  else delete next[key];
                  return next;
                });
              }}
              onSort={(key, direction) => setSort({ key, direction })}
              onInsert={(rowId, place) =>
                void mutateRow(
                  `/api/datasets/${datasetId}/rows`,
                  "POST",
                  place === "above" ? { beforeRowId: rowId } : { afterRowId: rowId },
                  "Row added.",
                )
              }
              onDuplicate={(rowId) => void mutateRow(`/api/datasets/${datasetId}/rows/${rowId}/duplicate`, "POST", undefined, "Row duplicated.")}
              onDelete={(rowId) => {
                void mutateRow(`/api/datasets/${datasetId}/rows/${rowId}`, "DELETE", undefined).then((deleted) => {
                  if (!deleted) return;
                  setSelected((current) => {
                    const next = new Set(current);
                    next.delete(rowId);
                    return next;
                  });
                  toast("Row deleted.", {
                    duration: 10_000,
                    action: {
                      label: "Undo",
                      onClick: () => void mutateRow(`/api/datasets/${datasetId}/rows/${rowId}/restore`, "POST", undefined, "Row restored."),
                    },
                  });
                });
              }}
              onRestoreValue={(row, column, value) => {
                const draft = value == null ? "" : String(value);
                void saveChanges(row, { [column.key]: draft === "" ? null : draft }, row.version);
              }}
              onReadOnly={deny}
              onRange={onRange}
              canStructure={canStructure}
              onRenameColumn={(column, label) => void structure(`/columns/${encodeURIComponent(column.key)}`, "PATCH", { label }, "Column renamed.")}
              onInsertColumn={(column, side) => setInsertAt({ column, side })}
              onMoveColumn={(column, direction) => {
                const ordered = [...detail.schema.columns].sort((left, right) => left.order - right.order);
                const index = ordered.findIndex((item) => item.key === column.key);
                const neighbor = ordered[direction === "left" ? index - 1 : index + 1];
                if (!neighbor) return;
                const body = direction === "left" ? { beforeKey: neighbor.key } : { afterKey: neighbor.key };
                void structure(`/columns/${encodeURIComponent(column.key)}/move`, "POST", body, "Column moved.");
              }}
              onHideColumn={(column) => {
                setHidden((current) => {
                  const next = new Set(current);
                  next.add(column.key);
                  return next;
                });
                void structure(`/columns/${encodeURIComponent(column.key)}`, "PATCH", { hidden: true }, "Column hidden.");
              }}
              onDeleteColumn={setDeleteTarget}
              onOpenRow={(row) => {
                setDrawerFocus("");
                setEditedKeys([]);
                setDrawerId(row.id);
              }}
              onWorkflow={(row) => {
                setDrawerFocus("data_validation");
                setDrawerId(row.id);
              }}
            />
          </div>
          <MobileCards
            rows={filtered}
            pinned={layout.pinned}
            groupColumns={groupColumns}
            selected={selected}
            canEditColumn={canEditColumn}
            optionsFor={(column) => distinctCounts(sourceRows, column).map((item) => item.value).filter((value) => value !== "(Blank)")}
            onToggle={(rowId, checked) => {
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(rowId);
                else next.delete(rowId);
                return next;
              });
            }}
            saving={saving}
            onSave={(row, changes) => saveChanges(row, changes, row.version)}
            onOpen={(row) => {
              setDrawerFocus("");
              setEditedKeys([]);
              setDrawerId(row.id);
            }}
            scrollRowId={scrollRowId}
            pulseKeys={pulse ? editedKeys : []}
          />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
            <p className="tabular-nums">
              Showing {filtered.length === 0 ? "0-0" : `${range.end > 0 ? range.start : 1}-${range.end > 0 ? range.end : filtered.length}`} of {filtered.length}
            </p>
            <p className="tabular-nums">
              {visibleColumnCount} columns · {visibleGroups} groups
            </p>
          </div>
        </>
      )}
      {selected.size > 0 ? (
        <div className="fixed inset-x-4 bottom-20 z-popover flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-surface px-4 py-3 shadow-float md:bottom-6">
          <p className="text-sm text-ink">{selected.size} rows selected</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const first = [...selected][0];
                if (!first) return;
                setDrawerFocus("");
                setDrawerId(first);
              }}
            >
              Open
            </Button>
            {canPerformAction(user.role, "validate", (key) => canEditGroup(permissions.groupAccess, key)) ? (
              <Button variant="secondary" onClick={() => void bulk("/bulk/validate", { rowIds: [...selected], result: "Yes" })}>
                Validate Yes
              </Button>
            ) : null}
            {hasCapability(user.role, "verify") ? (
              <Button variant="secondary" onClick={() => void bulk("/bulk/verify", { rowIds: [...selected], verified: true })}>
                Verify
              </Button>
            ) : null}
            {hasCapability(user.role, "assign") ? (
              <Button variant="secondary" onClick={() => setAssignOpen(true)}>
                Assign
              </Button>
            ) : null}
            {user.role === "admin" || user.role === "manager" ? (
              <Button variant="secondary" onClick={() => void bulk("/bulk/closeHistorical", { rowIds: [...selected] })}>
                Close historical PMS
              </Button>
            ) : null}
            <Button onClick={() => void exportRows(detail.name, [...selected])}>Export selected</Button>
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              Deselect all
            </Button>
          </div>
        </div>
      ) : null}
      <CellMenuHost />
      <RecordDrawer
        datasetId={datasetId}
        row={sourceRows.find((row) => row.id === drawerId) ?? null}
        schema={detail.schema}
        role={user.role}
        groupAccess={permissions.groupAccess}
        countryCode={countryCode ?? "+91"}
        focusGroupKey={drawerFocus}
        focusKeys={editedKeys}
        revision={revision}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerId(null);
            setEditedKeys([]);
            const next = new URLSearchParams(searchParams);
            next.delete("row");
            next.delete("focus");
            setSearchParams(next, { replace: true });
            linkHandled.current = "";
          }
        }}
      />
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign</DialogTitle>
            <DialogDescription>Choose a validator, a service user, or both.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5">
            <Label>Validator</Label>
            <Select value={validatorId || "none"} onValueChange={setValidatorId}>
              <SelectTrigger aria-label="Validator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {(assigneesQuery.data?.users ?? [])
                  .filter((person) => person.role === "validator")
                  .map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Label>Service</Label>
            <Select value={serviceId || "none"} onValueChange={setServiceId}>
              <SelectTrigger aria-label="Service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {(assigneesQuery.data?.users ?? [])
                  .filter((person) => person.role === "service")
                  .map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void bulk("/bulk/assign", {
                  rowIds: [...selected],
                  validatorId: validatorId && validatorId !== "none" ? validatorId : null,
                  serviceId: serviceId && serviceId !== "none" ? serviceId : null,
                }).then(() => setAssignOpen(false));
              }}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InsertColumnDialog
        target={insertAt}
        onOpenChange={(open) => {
          if (!open) setInsertAt(null);
        }}
        onCreate={async (label, type, options) => {
          if (!insertAt) return false;
          const body = {
            label,
            type,
            groupId: insertAt.column.groupId,
            options,
            ...(insertAt.side === "left" ? { beforeKey: insertAt.column.key } : { afterKey: insertAt.column.key }),
          };
          const saved = await structure("/columns", "POST", body, "Column added.");
          if (saved) setInsertAt(null);
          return saved;
        }}
      />
      <Dialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete column</DialogTitle>
            <DialogDescription>Values stay in each row for 30 days. You can restore this column from Trash.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-ruby text-canvas hover:bg-ruby"
              onClick={() => {
                if (!deleteTarget) return;
                const key = deleteTarget.key;
                void structure(`/columns/${encodeURIComponent(key)}`, "DELETE", undefined, "Column moved to Trash.").then((saved) => {
                  if (saved) setDeleteTarget(null);
                });
              }}
            >
              Delete column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  async function bulk(path: string, body: unknown) {
    try {
      const result = await api<{ results: Array<{ ok: boolean }> }>(`/api/datasets/${datasetId}${path}`, { method: "POST", body });
      const saved = result.results.filter((item) => item.ok).length;
      await queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] });
      await queryClient.invalidateQueries({ queryKey: ["dataset-summary", datasetId] });
      toast("Saved", { duration: UNDO_SECONDS * 1000, description: `${saved} of ${result.results.length} rows updated.` });
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update the rows."));
    }
  }

  async function structure(path: string, method: string, body: unknown, message: string): Promise<boolean> {
    try {
      await api(`/api/datasets/${datasetId}${path}`, { method, body });
      await queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] });
      await queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] });
      toast.success(message);
      return true;
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update the column."));
      return false;
    }
  }

  function chooseDensity(next: Density) {
    setDensity(next);
    writeDensity(user.id, next);
  }

  async function exportRows(name: string, rowIds?: string[]) {
    try {
      await downloadWorkbook(datasetId, name, rowIds);
      toast.success("Workbook exported.");
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not export the workbook."));
    }
  }
}

function FilterBar({
  filters,
  sort,
  search,
  recentOnly,
  columns,
  onRemove,
  onClear,
  onClearSort,
  onClearSearch,
  onClearRecent,
}: {
  filters: Record<string, ColumnFilter>;
  sort: SortState;
  search: string;
  recentOnly: boolean;
  columns: DatasetColumn[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onClearSort: () => void;
  onClearSearch: () => void;
  onClearRecent: () => void;
}) {
  const chips: Array<{ id: string; label: string; onRemove: () => void }> = [];
  if (search.trim()) chips.push({ id: "search", label: `Search: ${search.trim()}`, onRemove: onClearSearch });
  if (recentOnly) chips.push({ id: "recent", label: "Recently updated", onRemove: onClearRecent });
  if (sort) {
    const label = columns.find((column) => column.key === sort.key)?.label ?? sort.key;
    chips.push({ id: "sort", label: `${label} ${sort.direction === "asc" ? "ascending" : "descending"}`, onRemove: onClearSort });
  }
  for (const [key, filter] of Object.entries(filters)) {
    const label = columns.find((column) => column.key === key)?.label ?? key;
    chips.push({ id: key, label: `${label}: ${filterLabel(filter)}`, onRemove: () => onRemove(key) });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button key={chip.id} type="button" className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 text-sm text-ink" onClick={chip.onRemove}>
          <span className="min-w-0 truncate">{chip.label}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear all
      </Button>
    </div>
  );
}

function filterLabel(filter: ColumnFilter): string {
  if (filter.kind === "contains") return filter.text;
  if (filter.kind === "dates") return `${filter.from || "…"} to ${filter.to || "…"}`;
  return `${filter.selected.length} values`;
}

function isProjection(value: unknown): value is RowProjection {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.version === "number" && typeof record.values === "object" && record.values !== null && typeof record.updatedByName === "string";
}

function InsertColumnDialog({
  target,
  onOpenChange,
  onCreate,
}: {
  target: { column: DatasetColumn; side: "left" | "right" } | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (label: string, type: ColumnType, options?: string[]) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("Yes, No");
  const [saving, setSaving] = useState(false);
  const needsOptions = type === "yesno" || type === "status" || type === "category";

  return (
    <Dialog
      open={target != null}
      onOpenChange={(open) => {
        if (!open) {
          setLabel("");
          setType("text");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.side === "left" ? "Insert column left" : "Insert column right"}</DialogTitle>
          <DialogDescription>The new column is added beside {target?.column.label ?? "this column"}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 py-2">
          <Label htmlFor="insert-label">Label</Label>
          <Input id="insert-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <Label>Type</Label>
          <Select value={type} onValueChange={(value) => setType(value as ColumnType)}>
            <SelectTrigger aria-label="Column type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_TYPES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsOptions ? (
            <>
              <Label htmlFor="insert-options">Options</Label>
              <Input id="insert-options" value={options} onChange={(event) => setOptions(event.target.value)} />
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !label.trim()}
            onClick={() => {
              setSaving(true);
              const parsed = needsOptions ? options.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
              void onCreate(label, type, parsed).finally(() => setSaving(false));
            }}
          >
            {saving ? <Spinner /> : null}
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
