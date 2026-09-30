import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

const tones = {
  emerald: "bg-emerald-bg text-emerald",
  amber: "bg-amber-bg text-amber",
  ruby: "bg-ruby-bg text-ruby",
  sapphire: "bg-sapphire-bg text-sapphire",
  stone: "bg-stone-bg text-stone",
  navy: "bg-navy text-canvas",
} as const;

export type PillTone = keyof typeof tones;

export function Pill({
  tone = "stone",
  className,
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
