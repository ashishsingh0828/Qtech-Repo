import type { DatasetSummary } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { api } from "../../lib/api";
import { isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { rememberDataset } from "./storage";

export function DatasetSwitcher() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
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
  const current = params.datasetId && datasets.some((dataset) => dataset.id === params.datasetId) ? params.datasetId : undefined;

  return (
    <div className="hidden min-w-0 max-w-[16rem] flex-1 sm:block">
      <Select
        value={current}
        onValueChange={(datasetId) => {
          rememberDataset(user.id, datasetId);
          void navigate(`/records/${datasetId}`);
        }}
      >
        <SelectTrigger aria-label="Dataset">
          <SelectValue placeholder={datasets.length === 0 ? "No datasets" : "Choose a dataset"} />
        </SelectTrigger>
        <SelectContent>
          {datasets.map((dataset) => (
            <SelectItem key={dataset.id} value={dataset.id}>
              {dataset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
