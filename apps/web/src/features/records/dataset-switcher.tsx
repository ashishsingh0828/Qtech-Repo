import { useLocation, useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { useAuth } from "../auth/auth-gate";
import { useSelectedDataset } from "../workspace/use-dataset";
import { rememberDataset } from "./storage";

export function DatasetSwitcher() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const selected = useSelectedDataset();

  return (
    <div className="min-w-0 w-full max-w-[10rem] flex-1 sm:max-w-[16rem]">
      <Select
        value={selected.id ?? ""}
        onValueChange={(datasetId) => {
          rememberDataset(user.id, datasetId);
          const onRecords = location.pathname === "/records" || location.pathname.startsWith("/records/");
          if (onRecords) void navigate(`/records/${datasetId}`);
        }}
      >
        <SelectTrigger aria-label="Dataset">
          <SelectValue placeholder={selected.datasets.length === 0 ? "No datasets" : "Choose a dataset"} />
        </SelectTrigger>
        <SelectContent>
          {selected.datasets.map((dataset) => (
            <SelectItem key={dataset.id} value={dataset.id}>
              {dataset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
