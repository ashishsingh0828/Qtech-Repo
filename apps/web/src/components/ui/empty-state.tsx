import type { ReactNode } from "react";

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" className="text-muted">
        <rect x="10" y="8" width="28" height="32" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 18h16M16 24h16M16 30h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="max-w-sm text-sm text-ink-2">{message}</p>
      {action}
    </div>
  );
}
