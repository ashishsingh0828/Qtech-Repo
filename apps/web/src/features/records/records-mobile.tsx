import type { DatasetColumn, RowProjection } from "@app/shared";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "../../components/ui";
import { cn } from "../../lib/utils";
import { CellEditor } from "./editors";
import { displayText } from "./model";

export function MobileCards({
  rows,
  pinned,
  groupColumns,
  selected,
  canEditColumn,
  optionsFor,
  onToggle,
  onSave,
  saving,
  onOpen,
}: {
  rows: RowProjection[];
  pinned: DatasetColumn[];
  groupColumns: DatasetColumn[];
  selected: ReadonlySet<string>;
  canEditColumn: (column: DatasetColumn) => boolean;
  optionsFor: (column: DatasetColumn) => string[];
  onToggle: (rowId: string, checked: boolean) => void;
  onSave: (row: RowProjection, changes: Record<string, string | null>) => Promise<boolean>;
  saving: boolean;
  onOpen?: (row: RowProjection) => void;
}) {
  const [editing, setEditing] = useState<RowProjection | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fields = [...pinned, ...groupColumns.filter((column) => !pinned.some((item) => item.key === column.key))];
  const editable = groupColumns.filter(canEditColumn);

  function open(row: RowProjection) {
    const next: Record<string, string> = {};
    for (const column of editable) {
      const value = row.values[column.key];
      next[column.key] = value == null ? "" : String(value);
    }
    setDrafts(next);
    setEditing(row);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto md:hidden">
      {rows.length === 0 ? <p className="text-sm text-ink-2">No rows match.</p> : null}
      {rows.map((row) => {
        const when = formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true });
        return (
          <article
            key={row.id}
            className="flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-surface p-5"
            onClick={() => onOpen?.(row)}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={selected.has(row.id)}
                aria-label={`Select row ${row.position}`}
                className={cn("size-4 rounded-[4px] border border-hairline", selected.has(row.id) && "border-navy bg-navy")}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(row.id, !selected.has(row.id));
                }}
              />
              <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
                Updated {when}
                {row.updatedByName ? ` by ${row.updatedByName}` : ""}
              </p>
            </div>
            {fields.map((column) => (
              <p key={column.key} className="min-w-0 truncate text-sm text-ink">
                <span className="text-ink-2">{column.label}: </span>
                {displayText(column, row.values[column.key]) || "—"}
              </p>
            ))}
            {editable.length > 0 ? (
              <Button variant="secondary" onClick={() => open(row)}>
                Edit
              </Button>
            ) : null}
          </article>
        );
      })}
      <Sheet open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit row {editing?.position}</SheetTitle>
            <SheetDescription>Changes save together.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-2">
            {editing
              ? editable.map((column) => (
                  <label key={column.key} className="flex min-w-0 flex-col gap-1 text-sm text-ink">
                    <span className="truncate">{column.label}</span>
                    <div className="h-11 rounded-control border border-hairline">
                      <CellEditor
                        column={column}
                        draft={drafts[column.key] ?? ""}
                        options={optionsFor(column)}
                        onDraft={(draft) => setDrafts((current) => ({ ...current, [column.key]: draft }))}
                        onCommit={(draft) => setDrafts((current) => ({ ...current, [column.key]: draft }))}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  </label>
                ))
              : null}
          </div>
          <SheetFooter>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              disabled={saving || !editing}
              onClick={() => {
                if (!editing) return;
                const changes: Record<string, string | null> = {};
                for (const column of editable) {
                  const next = (drafts[column.key] ?? "").trim();
                  const previous = editing.values[column.key];
                  const previousText = previous == null ? "" : String(previous);
                  if (next !== previousText) changes[column.key] = next === "" ? null : next;
                }
                void onSave(editing, changes).then((saved) => {
                  if (saved) setEditing(null);
                });
              }}
            >
              {saving ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
