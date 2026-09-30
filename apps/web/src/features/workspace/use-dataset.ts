import type { DatasetSummary } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { lastDataset, subscribeDataset } from "../records/storage";

const emptySnapshot = (): string => "";

export function useSelectedDataset(): {
  id: string | null;
  name: string;
  datasets: DatasetSummary[];
  loading: boolean;
} {
  const { user } = useAuth();
  const params = useParams();
  const stored = useSyncExternalStore(subscribeDataset, () => lastDataset(user.id) ?? "", emptySnapshot);
  const query = useQuery({
    queryKey: ["datasets"],
    queryFn: async () => {
      try {
        return await api<{ datasets: DatasetSummary[] }>("/api/datasets");
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
  });
  const datasets = query.data?.datasets ?? [];
  const routeId = typeof params.datasetId === "string" ? params.datasetId : "";
  const known = (candidate: string) => datasets.some((dataset) => dataset.id === candidate);
  const id = (known(routeId) ? routeId : "") || (known(stored) ? stored : "") || datasets[0]?.id || "";
  return {
    id: id || null,
    name: datasets.find((dataset) => dataset.id === id)?.name ?? "",
    datasets,
    loading: query.isPending,
  };
}
