import type { CellHistoryEntry, DatasetColumn, DatasetGroup, RecentEdit, RowProjection, StoredCell } from "@app/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDistanceToNow } from "date-fns";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, Pill, Popover, PopoverContent, PopoverTrigger } from "../../components/ui";
import { api } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import { cn } from "../../lib/utils";
import { CellEditor } from "./editors";
import { bannerSegments, displayText, distinctCounts, statusTone, type ColumnFilter, type SortState } from "./model";

const CHECK_W = 44;
const INDEX_W = 76;
const COL_W = 168;

type ActiveCell = { rowId: string; columnKey: string };

type GridProps = {
  datasetId: string;
  rows: RowProjection[];
  allRows: RowProjection[];
  pinned: DatasetColumn[];
  scrollColumns: DatasetColumn[];
  groups: DatasetGroup[];
  advanced: boolean;
  rowHeight: number;
  selectedRows: ReadonlySet<string>;
  activeCell: ActiveCell | null;
  editor: { rowId: string; columnKey: string; draft: string } | null;
  flashKey: string | null;
  scrollRowId?: string | null;
  pulseKeys?: readonly string[];
  recent: Map<string, RecentEdit>;
  filters: Record<string, ColumnFilter>;
  sort: SortState;
  search: string;
  canManage: boolean;
  canRestore: boolean;
  canEditColumn: (column: DatasetColumn) => boolean;
  optionsFor: (column: DatasetColumn) => string[];
  onActiveCell: (cell: ActiveCell) => void;
  onStartEdit: (row: RowProjection, column: DatasetColumn) => void;
  onDraft: (draft: string) => void;
  onCommit: (draft: string, move?: "next" | "prev") => void;
  onCancel: () => void;
  onToggleRow: (rowId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onFilter: (key: string, filter: ColumnFilter | null) => void;
  onSort: (key: string, direction: "asc" | "desc") => void;
  onInsert: (rowId: string, place: "above" | "below") => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  onRestoreValue: (row: RowProjection, column: DatasetColumn, value: StoredCell) => void;
  onReadOnly: (column: DatasetColumn) => void;
  onRange: (start: number, end: number) => void;
  onOpenRow?: (row: RowProjection) => void;
  onWorkflow?: (row: RowProjection) => void;
  canStructure?: boolean;
  onRenameColumn?: (column: DatasetColumn, label: string) => void;
  onInsertColumn?: (column: DatasetColumn, side: "left" | "right") => void;
  onMoveColumn?: (column: DatasetColumn, direction: "left" | "right") => void;
  onHideColumn?: (column: DatasetColumn) => void;
  onDeleteColumn?: (column: DatasetColumn) => void;
};

export function RecordsGrid(props: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = [...props.pinned, ...props.scrollColumns];
  const pinnedWidth = CHECK_W + INDEX_W + props.pinned.length * COL_W;
  const rowVirtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => props.rowHeight,
    overscan: 8,
  });
  useEffect(() => {
    if (!props.scrollRowId) return;
    const index = props.rows.findIndex((row) => row.id === props.scrollRowId);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: "center" });
  }, [props.rows, props.scrollRowId, rowVirtualizer]);
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: props.scrollColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    paddingStart: pinnedWidth,
    overscan: 3,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const width = Math.max(pinnedWidth + props.scrollColumns.length * COL_W, columnVirtualizer.getTotalSize());
  const { onRange } = props;
  const rangeStart = virtualRows[0]?.index;
  const rangeEnd = virtualRows[virtualRows.length - 1]?.index;

  useEffect(() => {
    onRange(rangeStart == null ? 0 : rangeStart + 1, rangeEnd == null ? 0 : rangeEnd + 1);
  }, [onRange, rangeStart, rangeEnd]);

  function move(direction: "left" | "right" | "up" | "down" | "next" | "prev") {
    if (!props.activeCell || columns.length === 0 || props.rows.length === 0) return;
    const rowIndex = Math.max(0, props.rows.findIndex((row) => row.id === props.activeCell?.rowId));
    const columnIndex = Math.max(0, columns.findIndex((column) => column.key === props.activeCell?.columnKey));
    let nextRow = rowIndex;
    let nextColumn = columnIndex;
    if (direction === "left" || direction === "prev") nextColumn -= 1;
    if (direction === "right" || direction === "next") nextColumn += 1;
    if (direction === "up") nextRow -= 1;
    if (direction === "down") nextRow += 1;
    if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    }
    nextRow = Math.min(props.rows.length - 1, Math.max(0, nextRow));
    const row = props.rows[nextRow];
    const column = columns[nextColumn];
    if (!row || !column) return;
    props.onActiveCell({ rowId: row.id, columnKey: column.key });
  }

  const allChecked = props.rows.length > 0 && props.rows.every((row) => props.selectedRows.has(row.id));
  const headerColumns = props.advanced ? columns : columns;

  return (
    <div
      ref={scrollRef}
      data-records-grid
      tabIndex={0}
      className="h-full min-h-0 min-w-0 flex-1 overflow-auto rounded-card border border-hairline bg-surface outline-none"
      onKeyDown={(event) => {
        if (props.editor) return;
        if (!props.activeCell) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move("left");
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          move("right");
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          move("up");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          move("down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          move(event.shiftKey ? "prev" : "next");
        } else if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          const row = props.rows.find((item) => item.id === props.activeCell?.rowId);
          const column = columns.find((item) => item.key === props.activeCell?.columnKey);
          if (!row || !column) return;
          if (!props.canEditColumn(column)) props.onReadOnly(column);
          else props.onStartEdit(row, column);
        } else if (event.key === "Escape") {
          props.onCancel();
        }
      }}
    >
      <div style={{ width, minHeight: "100%" }}>
        <div className="sticky top-0 z-sticky border-b border-hairline bg-surface">
          {props.advanced ? (
            <div className="relative h-7" style={{ width }}>
              <div className="sticky left-0 z-sticky float-left flex h-7 bg-surface" style={{ width: CHECK_W + INDEX_W }} />
              {bannerSegments(props.pinned, props.groups).map((segment, index) => (
                <div
                  key={`${segment.label}-${index}`}
                  className="group-label sticky z-sticky float-left flex h-7 items-center truncate px-2 text-ink"
                  style={{ width: segment.span * COL_W, backgroundColor: segment.tint, left: CHECK_W + INDEX_W }}
                >
                  {segment.label}
                </div>
              ))}
              {virtualColumns.map((virtualColumn) => {
                const column = props.scrollColumns[virtualColumn.index];
                if (!column) return null;
                const group = props.groups.find((item) => item.id === column.groupId);
                const previous = props.scrollColumns[virtualColumn.index - 1];
                if (previous && previous.groupId === column.groupId) return null;
                let span = 1;
                for (let cursor = virtualColumn.index + 1; cursor < props.scrollColumns.length; cursor += 1) {
                  if (props.scrollColumns[cursor]?.groupId !== column.groupId) break;
                  span += 1;
                }
                return (
                  <div
                    key={column.groupId}
                    className="group-label absolute top-0 flex h-7 items-center truncate px-2 text-ink"
                    style={{ left: virtualColumn.start, width: span * COL_W, backgroundColor: group?.tint ?? "#F1EEE8" }}
                  >
                    {group?.label ?? "General"}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="relative flex h-8" style={{ width }}>
            <div
              className="sticky left-0 z-sticky flex h-8 shrink-0 border-r border-hairline bg-surface shadow-[4px_0_8px_rgba(20,23,31,0.06)]"
              style={{ width: pinnedWidth }}
            >
              <div className="flex items-center justify-center" style={{ width: CHECK_W }}>
                <CheckBox
                  label="Select all rows"
                  checked={allChecked}
                  onChange={(checked) => props.onToggleAll(checked)}
                />
              </div>
              <HeaderCell label="Row" width={INDEX_W} />
              {props.pinned.map((column) => (
                <ColumnHeader
                  key={column.key}
                  column={column}
                  width={COL_W}
                  rows={props.allRows}
                  filters={props.filters}
                  sort={props.sort}
                  onFilter={props.onFilter}
                  onSort={props.onSort}
                  canStructure={props.canStructure}
                  onRename={props.onRenameColumn}
                  onInsert={props.onInsertColumn}
                  onMove={props.onMoveColumn}
                  onHide={props.onHideColumn}
                  onDelete={props.onDeleteColumn}
                />
              ))}
            </div>
            <div className="relative h-8" style={{ width: width - pinnedWidth }}>
              {virtualColumns.map((virtualColumn) => {
                const column = props.scrollColumns[virtualColumn.index];
                if (!column) return null;
                return (
                  <div key={column.key} className="absolute top-0 h-8" style={{ left: virtualColumn.start - pinnedWidth, width: virtualColumn.size }}>
                    <ColumnHeader
                      column={column}
                      width={virtualColumn.size}
                      rows={props.allRows}
                      filters={props.filters}
                      sort={props.sort}
                      onFilter={props.onFilter}
                      onSort={props.onSort}
                      canStructure={props.canStructure}
                      onRename={props.onRenameColumn}
                      onInsert={props.onInsertColumn}
                      onMove={props.onMoveColumn}
                      onHide={props.onHideColumn}
                      onDelete={props.onDeleteColumn}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="relative" style={{ height: rowVirtualizer.getTotalSize(), width }}>
          {virtualRows.map((virtualRow) => {
            const row = props.rows[virtualRow.index];
            if (!row) return null;
            return (
              <div key={row.id} className="absolute left-0 top-0 flex border-b border-hairline" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)`, width }}>
                <div
                  className="sticky left-0 z-sticky flex shrink-0 border-r border-hairline bg-surface shadow-[4px_0_8px_rgba(20,23,31,0.06)]"
                  style={{ width: pinnedWidth, height: virtualRow.size }}
                >
                  <div className="flex items-center justify-center" style={{ width: CHECK_W }}>
                    <CheckBox
                      label={`Select row ${row.position}`}
                      checked={props.selectedRows.has(row.id)}
                      onChange={(checked) => props.onToggleRow(row.id, checked)}
                    />
                  </div>
                  <RowIndex row={props.rows[virtualRow.index] ?? row} width={INDEX_W} canManage={props.canManage} onInsert={props.onInsert} onDuplicate={props.onDuplicate} onDelete={props.onDelete} onOpen={props.onOpenRow} />
                  {props.pinned.map((column) => (
                    <DataCell key={column.key} row={row} column={column} width={COL_W} grid={props} />
                  ))}
                </div>
                {virtualColumns.map((virtualColumn) => {
                  const column = props.scrollColumns[virtualColumn.index];
                  if (!column) return null;
                  return (
                    <div key={column.key} className="absolute top-0" style={{ left: virtualColumn.start, width: virtualColumn.size, height: virtualRow.size }}>
                      <DataCell row={row} column={column} width={virtualColumn.size} grid={props} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {props.rows.length === 0 ? <p className="px-4 py-8 text-sm text-ink-2">No rows match.</p> : null}
      </div>
      <span className="sr-only">{headerColumns.length} columns</span>
    </div>
  );
}

function ColumnHeader({
  column,
  width,
  rows,
  filters,
  sort,
  onFilter,
  onSort,
  canStructure,
  onRename,
  onInsert,
  onMove,
  onHide,
  onDelete,
}: {
  column: DatasetColumn;
  width: number;
  rows: RowProjection[];
  filters: Record<string, ColumnFilter>;
  sort: SortState;
  onFilter: (key: string, filter: ColumnFilter | null) => void;
  onSort: (key: string, direction: "asc" | "desc") => void;
  canStructure?: boolean;
  onRename?: (column: DatasetColumn, label: string) => void;
  onInsert?: (column: DatasetColumn, side: "left" | "right") => void;
  onMove?: (column: DatasetColumn, direction: "left" | "right") => void;
  onHide?: (column: DatasetColumn) => void;
  onDelete?: (column: DatasetColumn) => void;
}) {
  const active = filters[column.key];
  const counts = distinctCounts(rows, column);
  const [contains, setContains] = useState(active?.kind === "contains" ? active.text : "");
  const [from, setFrom] = useState(active?.kind === "dates" ? active.from : "");
  const [to, setTo] = useState(active?.kind === "dates" ? active.to : "");
  const [picked, setPicked] = useState<string[]>(active?.kind === "values" ? active.selected : counts.map((item) => item.value));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(column.label);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function commitRename() {
    const label = draft.trim();
    setEditing(false);
    if (label && label !== column.label) onRename?.(column, label);
    else setDraft(column.label);
  }

  return (
    <div
      className="flex h-8 min-w-0 items-center border-r border-hairline"
      style={{ width }}
      onContextMenu={(event) => {
        if (!canStructure) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          aria-label={`Rename ${column.label}`}
          className="h-7 min-w-0 flex-1 bg-transparent px-2 text-xs font-semibold text-ink outline-none"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              setDraft(column.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-1 px-2 text-left text-xs font-semibold text-ink"
          onDoubleClick={(event) => {
            if (!canStructure) return;
            event.preventDefault();
            setDraft(column.label);
            setEditing(true);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{column.label}</span>
          {sort?.key === column.key ? <span className="text-gold">{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
        </button>
      )}
      <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="h-8 shrink-0 px-1 text-xs text-ink" aria-label={`${column.label} filter`}>
          ▾
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-2">
          <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => onSort(column.key, "asc")}>
            Sort ascending
          </button>
          <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => onSort(column.key, "desc")}>
            Sort descending
          </button>
          {column.type === "date" ? (
            <div className="flex gap-2">
              <input value={from} placeholder="From" className="h-11 min-w-0 flex-1 rounded-control border border-hairline px-2 text-sm" onChange={(event) => setFrom(event.target.value)} />
              <input value={to} placeholder="To" className="h-11 min-w-0 flex-1 rounded-control border border-hairline px-2 text-sm" onChange={(event) => setTo(event.target.value)} />
            </div>
          ) : (
            <input
              value={contains}
              placeholder="Contains"
              className="h-11 w-full rounded-control border border-hairline px-2 text-sm"
              onChange={(event) => setContains(event.target.value)}
            />
          )}
          <div className="max-h-40 overflow-auto">
            {counts.map((item) => (
              <label key={item.value} className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.includes(item.value)}
                  aria-label={item.value}
                  onCheckedChange={(state) => {
                    setPicked((current) =>
                      state === true ? [...current, item.value] : current.filter((value) => value !== item.value),
                    );
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{item.value}</span>
                <span className="tabular-nums text-muted">{item.count}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (column.type === "date" && (from.trim() || to.trim())) onFilter(column.key, { kind: "dates", from: from.trim(), to: to.trim() });
                else if (contains.trim()) onFilter(column.key, { kind: "contains", text: contains.trim() });
                else if (picked.length !== counts.length) onFilter(column.key, { kind: "values", selected: picked });
                else onFilter(column.key, null);
              }}
            >
              Apply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onFilter(column.key, null)}>
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
      {menu
        ? createPortal(
            <>
              <button type="button" aria-label="Close column menu" className="fixed inset-0 z-popover cursor-default" onClick={() => setMenu(null)} />
              <div className="fixed z-popover w-56 rounded-control border border-hairline bg-surface p-1 text-sm shadow-float" style={{ left: menu.x, top: menu.y }}>
                <HeaderMenuButton label="Insert column left" onClick={() => { setMenu(null); onInsert?.(column, "left"); }} />
                <HeaderMenuButton label="Insert column right" onClick={() => { setMenu(null); onInsert?.(column, "right"); }} />
                <HeaderMenuButton label="Move left" onClick={() => { setMenu(null); onMove?.(column, "left"); }} />
                <HeaderMenuButton label="Move right" onClick={() => { setMenu(null); onMove?.(column, "right"); }} />
                <HeaderMenuButton label="Hide column" onClick={() => { setMenu(null); onHide?.(column); }} />
                <HeaderMenuButton label="Delete column" danger onClick={() => { setMenu(null); onDelete?.(column); }} />
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function HeaderMenuButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={cn("flex min-h-11 w-full items-center rounded-control px-2 text-left hover:bg-surface-2", danger && "text-ruby")} onClick={onClick}>
      {label}
    </button>
  );
}

function HeaderCell({ label, width }: { label: string; width: number }) {
  return (
    <div className="flex h-8 items-center px-2 text-xs font-semibold text-ink" style={{ width }}>
      {label}
    </div>
  );
}

function DataCell({ row, column, width, grid }: { row: RowProjection; column: DatasetColumn; width: number; grid: GridProps }) {
  const value = row.values[column.key];
  const text = displayText(column, value);
  const editing = grid.editor?.rowId === row.id && grid.editor.columnKey === column.key;
  const selected = grid.activeCell?.rowId === row.id && grid.activeCell.columnKey === column.key;
  const recent = grid.recent.get(`${row.id}:${column.key}`);
  const editable = grid.canEditColumn(column);
  const highlighted = grid.search.trim() !== "" && text.toLowerCase().includes(grid.search.trim().toLowerCase());
  const negative = typeof value === "number" && value < 0 && (column.key === "days" || column.semantic === "days");
  return (
    <div
      className={cn(
        "relative h-full min-w-0 border-r border-hairline px-2",
        editable ? "cursor-cell" : "cursor-default text-muted",
        selected && "ring-2 ring-inset ring-gold",
        highlighted && "bg-gold-soft",
        grid.flashKey === `${row.id}:${column.key}` && "cell-flash",
        grid.scrollRowId === row.id && grid.pulseKeys?.includes(column.key) && "cell-pulse",
        recent && "edit-mark",
      )}
      style={{ width }}
      onMouseDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("input, button, a")) return;
        const gridNode = event.currentTarget.closest("[data-records-grid]");
        if (gridNode instanceof HTMLElement) gridNode.focus();
      }}
      onClick={() => {
        grid.onActiveCell({ rowId: row.id, columnKey: column.key });
        if (isValidatedColumn(column)) grid.onWorkflow?.(row);
      }}
      onDoubleClick={() => {
        if (isValidatedColumn(column)) {
          grid.onWorkflow?.(row);
          return;
        }
        if (!editable) grid.onReadOnly(column);
        else grid.onStartEdit(row, column);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        grid.onActiveCell({ rowId: row.id, columnKey: column.key });
        openCellMenu(event.clientX, event.clientY, row, column, grid);
      }}
    >
      {editing && grid.editor ? (
        <div className="absolute inset-0 z-base bg-surface">
          <CellEditor
            column={column}
            draft={grid.editor.draft}
            options={grid.optionsFor(column)}
            onDraft={grid.onDraft}
            onCommit={grid.onCommit}
            onCancel={grid.onCancel}
          />
        </div>
      ) : (
        <CellValue column={column} value={value} text={text} negative={negative} recent={recent} />
      )}
    </div>
  );
}

function CellValue({
  column,
  value,
  text,
  negative,
  recent,
}: {
  column: DatasetColumn;
  value: StoredCell | undefined;
  text: string;
  negative: boolean;
  recent: RecentEdit | undefined;
}) {
  const body = (() => {
    if (!text) return <span className="text-muted"> </span>;
    if (column.type === "date" && text === "NA") return <span className="text-muted">NA</span>;
    if (column.type === "email" && typeof value === "string") {
      return (
        <a href={`mailto:${value}`} className="block truncate text-sapphire" onClick={(event) => event.stopPropagation()}>
          {text}
        </a>
      );
    }
    if (column.type === "status" || column.type === "category" || column.type === "yesno") {
      return <Pill tone={statusTone(text)}>{text}</Pill>;
    }
    return <span className={cn("block truncate tabular-nums", negative && "text-ruby")}>{text}</span>;
  })();
  if (!recent) return <div className="flex h-full min-w-0 items-center">{body}</div>;
  const when = formatDistanceToNow(new Date(recent.at), { addSuffix: true });
  const previous = recent.from == null || recent.from === "" ? "blank" : String(recent.from);
  return (
    <div className="flex h-full min-w-0 items-center" title={`Edited by ${recent.byName}, ${when}, was ${previous}`}>
      {body}
    </div>
  );
}

function isValidatedColumn(column: DatasetColumn): boolean {
  return column.key === "validated" || column.semantic === "validated";
}

function RowIndex({
  row,
  width,
  canManage,
  onInsert,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  row: RowProjection;
  width: number;
  canManage: boolean;
  onInsert: (rowId: string, place: "above" | "below") => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  onOpen?: (row: RowProjection) => void;
}) {
  const when = formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true });
  const badge = `Updated ${when}${row.updatedByName ? ` by ${row.updatedByName}` : ""}`;
  return (
    <div className="flex h-full min-w-0 items-center gap-1 px-1 tabular-nums text-[13px] text-ink-2" style={{ width }} title={badge}>
      <button type="button" className="min-w-0 flex-1 truncate text-left" onDoubleClick={() => onOpen?.(row)}>
        {row.position}
      </button>
      {canManage ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="shrink-0 text-xs text-ink" aria-label={`Row ${row.position} actions`}>
              ···
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52">
            <div className="flex flex-col">
              <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => onInsert(row.id, "above")}>
                Insert row above
              </button>
              <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => onInsert(row.id, "below")}>
                Insert row below
              </button>
              <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm hover:bg-surface-2" onClick={() => onDuplicate(row.id)}>
                Duplicate row
              </button>
              <button type="button" className="min-h-11 rounded-control px-2 text-left text-sm text-ruby hover:bg-surface-2" onClick={() => onDelete(row.id)}>
                Delete row
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="flex size-8 items-center justify-center"
      onClick={() => onChange(!checked)}
    >
      <span className={cn("flex size-4 items-center justify-center rounded-[4px] border border-hairline", checked && "border-navy bg-navy text-canvas")}>
        {checked ? <Check className="size-3 text-canvas" strokeWidth={1.5} /> : null}
      </span>
    </button>
  );
}

type MenuState = { x: number; y: number; row: RowProjection; column: DatasetColumn; grid: GridProps };

let menuListener: ((menu: MenuState | null) => void) | null = null;

function openCellMenu(x: number, y: number, row: RowProjection, column: DatasetColumn, grid: GridProps): void {
  menuListener?.({ x, y, row, column, grid });
}

export function CellMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [history, setHistory] = useState<CellHistoryEntry[] | null>(null);
  useEffect(() => {
    menuListener = setMenu;
    return () => {
      menuListener = null;
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    let cancelled = false;
    setHistory(null);
    void api<CellHistoryEntry[]>(
      `/api/datasets/${menu.grid.datasetId}/rows/${menu.row.id}/history?columnKey=${encodeURIComponent(menu.column.key)}`,
    )
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [menu]);
  if (!menu) return null;
  return createPortal(
    <>
      <button type="button" aria-label="Close history" className="fixed inset-0 z-popover cursor-default" onClick={() => setMenu(null)} />
      <div className="fixed z-popover w-72 rounded-control border border-hairline bg-surface p-3 text-sm shadow-float" style={{ left: menu.x, top: menu.y }}>
        <div className="mb-2 flex items-center justify-between">
          <p className="truncate font-medium text-ink">History</p>
          <button type="button" className="min-h-11 px-2 text-ink-2" onClick={() => setMenu(null)}>
            Close
          </button>
        </div>
        {history == null ? (
          <p className="text-ink-2">Loading history.</p>
        ) : history.length === 0 ? (
          <p className="text-ink-2">No changes yet.</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-auto">
            {history.map((entry, index) => (
              <li key={`${entry.when}-${index}`} className="rounded-control border border-hairline p-2">
                <p className="truncate text-ink">{entry.who}</p>
                <p className="text-xs text-ink-2">{formatWhen(entry.when)}</p>
                <p className="truncate text-xs text-ink-2">
                  {entry.from == null ? "blank" : String(entry.from)} → {entry.to == null ? "blank" : String(entry.to)}
                </p>
                {menu.grid.canRestore ? (
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => menu.grid.onRestoreValue(menu.row, menu.column, entry.to)}>
                    Restore this value
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}
