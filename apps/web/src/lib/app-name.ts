import type { HealthResponse } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function useAppName(): string {
  const query = useQuery({
    queryKey: ["health", "app-name"],
    queryFn: () => api<HealthResponse>("/api/health", { tolerate: [503] }),
    staleTime: 60_000,
  });
  return query.data?.appName || "Qtech Service Hub";
}
