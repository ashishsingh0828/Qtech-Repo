import { UNDO_SECONDS } from "@app/shared";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { queryClient } from "../../lib/query";

export async function refreshWorkspace(datasetId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["workspace", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["kpis", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["health", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["workload", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["activity-feed"] }),
    queryClient.invalidateQueries({ queryKey: ["boards"] }),
    queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["dataset-summary", datasetId] }),
    queryClient.invalidateQueries({ queryKey: ["dataset", datasetId] }),
  ]);
}

export async function rowAction(datasetId: string, rowId: string, path: string, body: unknown, undo = true): Promise<void> {
  const result = await api<{ actionId?: string }>(`/api/datasets/${datasetId}/rows/${rowId}${path}`, {
    method: "POST",
    body,
  });
  await refreshWorkspace(datasetId);
  if (undo && result.actionId) {
    const actionId = result.actionId;
    toast("Saved", {
      duration: UNDO_SECONDS * 1000,
      action: {
        label: "Undo",
        onClick: () => {
          void api(`/api/datasets/${datasetId}/rows/${rowId}/undo`, { method: "POST", body: { actionId } }).then(async () => {
            await refreshWorkspace(datasetId);
            toast.success("Undone.");
          });
        },
      },
    });
    return;
  }
  toast.success("Saved.");
}

export async function bulkAction(datasetId: string, path: string, body: unknown): Promise<void> {
  const result = await api<{ results: Array<{ ok: boolean }> }>(`/api/datasets/${datasetId}${path}`, { method: "POST", body });
  await refreshWorkspace(datasetId);
  const saved = result.results.filter((item) => item.ok).length;
  toast("Saved", { duration: UNDO_SECONDS * 1000, description: `${saved} of ${result.results.length} rows updated.` });
}
