import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-control bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
