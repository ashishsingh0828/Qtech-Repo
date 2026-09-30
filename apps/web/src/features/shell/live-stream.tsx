import { useEffect } from "react";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";

type LiveEvent = {
  type?: string;
  datasetId?: string;
};

export function LiveStream() {
  const { user } = useAuth();
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: number | undefined;

    function connect(): void {
      source = new EventSource("/api/events");
      source.onmessage = (message) => {
        const event = parseEvent(message.data);
        if (!event) return;
        if (event.datasetId) {
          void queryClient.invalidateQueries({ queryKey: ["dataset", event.datasetId] });
          void queryClient.invalidateQueries({ queryKey: ["dataset-rows", event.datasetId] });
          void queryClient.invalidateQueries({ queryKey: ["dataset-summary", event.datasetId] });
          void queryClient.invalidateQueries({ queryKey: ["recent-edits", event.datasetId] });
        }
        if (
          event.type === "dataset.imported" ||
          event.type === "dataset.purged" ||
          event.type === "dataset.restored" ||
          event.type === "dataset.merged"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["datasets"] });
          void queryClient.invalidateQueries({ queryKey: ["trash"] });
        }
      };
      source.onerror = () => {
        source?.close();
        if (closed) return;
        retry = window.setTimeout(connect, 5_000);
      };
    }

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, [user.id]);
  return null;
}

function parseEvent(raw: string): LiveEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    return {
      type: typeof record.type === "string" ? record.type : undefined,
      datasetId: typeof record.datasetId === "string" ? record.datasetId : undefined,
    };
  } catch {
    return null;
  }
}
