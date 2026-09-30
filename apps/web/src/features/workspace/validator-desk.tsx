import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { readWorkspace, writeWorkspace } from "../records/storage";
import { bulkAction, rowAction } from "./actions";
import { KpiRow, NoteDialog, QuietEmpty, SelectionBar, WorkList, WorkspaceHeader } from "./parts";
import { useCards } from "./use-cards";
import { useSelectedDataset } from "./use-dataset";

export function ValidatorDesk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const selected = useSelectedDataset();
  const saved = readWorkspace(user.id);
  const [tab, setTab] = useState(saved.tab === "rejected" ? "rejected" : "queue");
  const [mine, setMine] = useState(saved.mine);
  const [city, setCity] = useState(saved.city);
  const [contract, setContract] = useState(saved.contract);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectId, setRejectId] = useState<string | null>(null);
  const datasetId = selected.id;
  const queue = useCards(datasetId, "validate_queue", { mine, city: city || undefined, contract: contract || undefined });
  const rejected = useCards(datasetId, "rejected", { mine, city: city || undefined, contract: contract || undefined });

  useEffect(() => {
    writeWorkspace(user.id, { tab, mine, city, contract });
  }, [user.id, tab, mine, city, contract]);

  function open(rowId: string) {
    if (datasetId) void navigate(`/records/${datasetId}?row=${rowId}`);
  }

  function toggle(rowId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const cities = queue.cities.length > 0 ? queue.cities : rejected.cities;
  const contracts = queue.contracts.length > 0 ? queue.contracts : rejected.contracts;

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceHeader />
      <KpiRow datasetId={datasetId} />
      {!selected.loading && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={mine ? "primary" : "secondary"} onClick={() => setMine(true)}>
              Mine
            </Button>
            <Button variant={mine ? "secondary" : "primary"} onClick={() => setMine(false)}>
              All
            </Button>
            <Select value={city || "all"} onValueChange={(value) => setCity(value === "all" ? "" : value)}>
              <SelectTrigger aria-label="City" className="w-40">
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {cities.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={contract || "all"} onValueChange={(value) => setContract(value === "all" ? "" : value)}>
              <SelectTrigger aria-label="Contract type" className="w-44">
                <SelectValue placeholder="Contract type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All contract types</SelectItem>
                {contracts.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="queue">To validate</TabsTrigger>
              <TabsTrigger value="rejected">Follow up on rejected</TabsTrigger>
            </TabsList>
            <TabsContent value="queue">
              <WorkList
                datasetId={datasetId}
                {...queue}
                onOpen={open}
                selected={selectedIds}
                onToggle={toggle}
                renderActions={(item) => (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        void rowAction(datasetId, item.rowId, "/actions/validate", { result: "Yes" }).catch((error: unknown) => {
                          if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not validate."));
                        });
                      }}
                    >
                      Yes
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRejectId(item.rowId)}>
                      No
                    </Button>
                  </>
                )}
              />
              <SelectionBar
                count={selectedIds.size}
                label="Mark selected Yes"
                onClear={() => setSelectedIds(new Set())}
                onAction={() => {
                  void bulkAction(datasetId, "/bulk/validate", { rowIds: [...selectedIds], result: "Yes" })
                    .then(() => setSelectedIds(new Set()))
                    .catch((error: unknown) => {
                      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not validate the rows."));
                    });
                }}
              />
            </TabsContent>
            <TabsContent value="rejected">
              <WorkList datasetId={datasetId} {...rejected} onOpen={open} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
      <NoteDialog
        open={rejectId != null}
        title="Needs a recheck"
        description="Give a reason of at least 5 characters and the expected date."
        confirmLabel="Save No"
        requireDate
        onClose={() => setRejectId(null)}
        onConfirm={async (note, date) => {
          if (!datasetId || !rejectId) return;
          try {
            await rowAction(datasetId, rejectId, "/actions/validate", { result: "No", reason: note, expectedDate: date });
            setRejectId(null);
          } catch (error) {
            if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not save the rejection."));
          }
        }}
      />
    </div>
  );
}
