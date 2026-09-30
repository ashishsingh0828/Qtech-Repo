import { Navigate, useNavigate } from "react-router-dom";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { useAuth } from "../auth/auth-gate";
import { lastDataset } from "./storage";

export function RecordsIndexPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const datasetId = lastDataset(user.id);
  if (datasetId) return <Navigate to={`/records/${datasetId}`} replace />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Records" subtitle="Open a dataset to work with its rows." />
      <div className="rounded-card border border-hairline bg-surface">
        <EmptyState message="No dataset selected yet." action={<Button onClick={() => void navigate("/datasets")}>Browse datasets</Button>} />
      </div>
    </div>
  );
}
