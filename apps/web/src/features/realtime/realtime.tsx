import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { queryClient } from "../../lib/query";

type SseEvent = {
  type?: string;
  datasetId?: string;
  rowId?: string;
  actorName?: string;
};

type RealtimeValue = {
  connected: boolean;
  revision: number;
  deletedName: (datasetId: string) => string | null;
  dismissDeleted: (datasetId: string) => void;
};

const RealtimeContext = createContext<RealtimeValue | null>(null);

function invalidateWorkspace(): void {
  void queryClient.invalidateQueries({ queryKey: ["kpis"] });
  void queryClient.invalidateQueries({ queryKey: ["workspace"] });
  void queryClient.invalidateQueries({ queryKey: ["health"] });
  void queryClient.invalidateQueries({ queryKey: ["workload"] });
  void queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
  void queryClient.invalidateQueries({ queryKey: ["boards"] });
}

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error("useRealtime must be used within RealtimeProvider");
  return value;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [deleted, setDeleted] = useState<Record<string, string>>({});

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let attempt = 0;
    let timer = 0;

    const connect = (): void => {
      if (stopped) return;
      const next = new EventSource("/api/events", { withCredentials: true });
      source = next;
      next.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      next.onmessage = (message) => {
        let event: SseEvent;
        try {
          event = JSON.parse(message.data) as SseEvent;
        } catch {
          return;
        }
        applyEvent(event);
      };
      next.onerror = () => {
        setConnected(false);
        next.close();
        if (source === next) source = null;
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      };
    };

    const applyEvent = (event: SseEvent): void => {
      const type = event.type ?? "";
      if (type === "access.changed") {
        void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
      if (type === "notification" || type === "access.changed") {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
      if (type.includes("trash") || type.includes("deleted") || type.includes("restored") || type.includes("purged") || type.includes("import") || type.includes("merged")) {
        void queryClient.invalidateQueries({ queryKey: ["trash"] });
        void queryClient.invalidateQueries({ queryKey: ["datasets"] });
      }
      if (event.datasetId) {
        void queryClient.invalidateQueries({ queryKey: ["dataset", event.datasetId] });
        void queryClient.invalidateQueries({ queryKey: ["dataset-rows", event.datasetId] });
        void queryClient.invalidateQueries({ queryKey: ["dataset-summary", event.datasetId] });
        void queryClient.invalidateQueries({ queryKey: ["recent-edits", event.datasetId] });
        void queryClient.invalidateQueries({ queryKey: ["datasets"] });
        void queryClient.invalidateQueries({ queryKey: ["drawer", event.datasetId] });
        void queryClient.invalidateQueries({ queryKey: ["schema", event.datasetId] });
        setRevision((current) => current + 1);
      }
      if (type === "notification" || event.datasetId || type.includes("import") || type.includes("merged") || type.includes("access")) {
        invalidateWorkspace();
      }
      if (type === "dataset.deleted" && event.datasetId) {
        setDeleted((current) => ({ ...current, [event.datasetId as string]: event.actorName || "someone" }));
      }
      if (type === "dataset.restored" && event.datasetId) {
        setDeleted((current) => {
          const nextDeleted = { ...current };
          delete nextDeleted[event.datasetId as string];
          return nextDeleted;
        });
      }
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      source?.close();
      setConnected(false);
    };
  }, []);

  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["datasets"] });
      void queryClient.invalidateQueries({ queryKey: ["dataset-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["dataset-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      void queryClient.invalidateQueries({ queryKey: ["dataset"] });
      invalidateWorkspace();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const value = useMemo<RealtimeValue>(
    () => ({
      connected,
      revision,
      deletedName: (datasetId: string) => deleted[datasetId] ?? null,
      dismissDeleted: (datasetId: string) => {
        setDeleted((current) => {
          const next = { ...current };
          delete next[datasetId];
          return next;
        });
      },
    }),
    [connected, deleted, revision],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function LiveStatus() {
  const { connected } = useRealtime();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" aria-live="polite" aria-label={connected ? "Live" : "Offline"}>
      <span className={`size-2 rounded-full ${connected ? "bg-emerald" : "bg-amber"}`} />
      <span className="hidden sm:inline">{connected ? "Live" : "Offline"}</span>
    </span>
  );
}
