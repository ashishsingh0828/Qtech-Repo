import type { DatasetColumn } from "@app/shared";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui";
import { cn } from "../../lib/utils";

type EditorProps = {
  column: DatasetColumn;
  draft: string;
  options: string[];
  onDraft: (draft: string) => void;
  onCommit: (draft: string, move?: "next" | "prev") => void;
  onCancel: () => void;
};

export function CellEditor(props: EditorProps) {
  if (props.column.type === "date") return <DateEditor {...props} />;
  if (props.column.type === "yesno") return <ChoiceEditor {...props} choices={["Yes", "No"]} />;
  if (props.column.type === "status" || props.column.type === "category") return <ComboEditor {...props} />;
  return <TextEditor {...props} numeric={props.column.type === "integer" || props.column.type === "decimal"} />;
}

function TextEditor({ draft, onDraft, onCommit, onCancel, numeric }: EditorProps & { numeric: boolean }) {
  return (
    <input
      autoFocus
      value={draft}
      inputMode={numeric ? "decimal" : "text"}
      aria-label="Edit cell"
      className="h-full w-full min-w-0 bg-surface px-2 text-[13px] text-ink outline-none"
      onChange={(event) => onDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Tab") {
          event.preventDefault();
          onCommit(draft, event.shiftKey ? "prev" : "next");
        }
      }}
    />
  );
}

function ChoiceEditor({ draft, choices, onCommit, onCancel }: EditorProps & { choices: string[] }) {
  return (
    <div className="flex h-full items-center gap-1 px-1" onMouseDown={(event) => event.preventDefault()}>
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className={cn(
            "min-h-7 rounded-control px-2 text-xs",
            draft === choice ? "bg-navy text-canvas" : "bg-surface-2 text-ink",
          )}
          onClick={() => onCommit(choice)}
        >
          {choice}
        </button>
      ))}
      <button type="button" className="min-h-7 px-1 text-xs text-ink-2" onClick={onCancel}>
        Esc
      </button>
    </div>
  );
}

function ComboEditor({ draft, options, onDraft, onCommit, onCancel }: EditorProps) {
  const matches = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(needle)).slice(0, 8);
  }, [draft, options]);
  return (
    <div className="relative h-full">
      <input
        autoFocus
        value={draft}
        aria-label="Edit cell"
        className="h-full w-full min-w-0 bg-surface px-2 text-[13px] text-ink outline-none"
        onChange={(event) => onDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Tab") {
            event.preventDefault();
            onCommit(draft, event.shiftKey ? "prev" : "next");
          }
        }}
      />
      {matches.length > 0 ? (
        <div className="absolute left-0 top-full z-popover max-h-48 w-full overflow-auto rounded-control border border-hairline bg-surface shadow-float">
          {matches.map((option) => (
            <button
              key={option}
              type="button"
              className="block w-full min-w-0 truncate px-2 py-2 text-left text-[13px] hover:bg-surface-2"
              onMouseDown={(event) => {
                event.preventDefault();
                onCommit(option);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DateEditor({ draft, onDraft, onCommit, onCancel }: EditorProps) {
  const [open, setOpen] = useState(false);
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(draft) ? draft : todayIso();
  const [cursor, setCursor] = useState(() => initial.slice(0, 7));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex h-full items-center">
        <input
          autoFocus
          value={draft}
          aria-label="Edit date"
          placeholder="YYYY-MM-DD"
          className="h-full min-w-0 flex-1 bg-surface px-2 text-[13px] text-ink outline-none"
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => {
            if (!open) onCommit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit(draft);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (event.key === "Tab") {
              event.preventDefault();
              onCommit(draft, event.shiftKey ? "prev" : "next");
            }
          }}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-full px-2 text-xs text-ink-2"
            aria-label="Open calendar"
            onMouseDown={(event) => event.preventDefault()}
          >
            Date
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        className="w-64"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <CalendarMonth
          cursor={cursor}
          onCursor={setCursor}
          onPick={(iso) => {
            onDraft(iso);
            onCommit(iso);
            setOpen(false);
          }}
        />
        <div className="mt-2 flex gap-2">
          <button type="button" className="min-h-11 flex-1 rounded-control border border-hairline text-sm" onClick={() => onCommit("")}>
            Clear
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-control border border-hairline text-sm"
            onClick={() => onCommit("NA")}
          >
            NA
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CalendarMonth({
  cursor,
  onCursor,
  onPick,
}: {
  cursor: string;
  onCursor: (cursor: string) => void;
  onPick: (iso: string) => void;
}) {
  const [yearText, monthText] = cursor.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const days = useMemo(() => buildMonth(year, month), [year, month]);
  function shift(delta: number) {
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    onCursor(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="min-h-11 px-2 text-sm" onClick={() => shift(-1)} aria-label="Previous month">
          Prev
        </button>
        <p className="text-sm font-medium text-ink">
          {MONTH_NAMES[month - 1] ?? ""} {year}
        </p>
        <button type="button" className="min-h-11 px-2 text-sm" onClick={() => shift(1)} aria-label="Next month">
          Next
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <button
            key={day.iso + (day.outside ? "-o" : "")}
            type="button"
            className={cn("min-h-9 rounded-control text-xs tabular-nums", day.outside ? "text-muted" : "text-ink hover:bg-surface-2")}
            onClick={() => onPick(day.iso)}
          >
            {day.day}
          </button>
        ))}
      </div>
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function buildMonth(year: number, month: number): Array<{ iso: string; day: number; outside: boolean }> {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days: Array<{ iso: string; day: number; outside: boolean }> = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    days.push({ iso, day: date.getUTCDate(), outside: date.getUTCMonth() !== month - 1 });
  }
  return days;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
