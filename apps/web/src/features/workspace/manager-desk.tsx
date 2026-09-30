import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { readWorkspace, writeWorkspace } from "../records/storage";
import { bulkAction, rowAction } from "./actions";
import { KpiRow, NoteDialog, SelectionBar, UploadDropzone, WorkList, WorkspaceHeader } from "./parts";
import type { WorkCardItem } from "./types";
import { useCards } from "./use-cards";
import { useSelectedDataset } from "./use-dataset";

const TABS = ["verification", "amc", "overdue", "team"] as const;
const AMC = [
  { queue: "amc_unverified", label: "Unverified expiries", action: null },
  { queue: "amc_due", label: "AMC due", action: "proposal_sent" as const },
  { queue: "amc_proposal", label: "Proposal sent", action: "acknowledge" as const },
  { queue: "amc_acknowledged", label: "Acknowledged", action: null },
  { queue: "amc_declined", label: "Declined", action: null },
];

export function ManagerDesk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const selected = useSelectedDataset();
  const saved = readWorkspace(user.id);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS.includes(saved.tab as (typeof TABS)[number]) ? (saved.tab as (typeof TABS)[number]) : "verification");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendBack, setSendBack] = useState<string | null>(null);
  const [slot, setSlot] = useState<"validator" | "service">("validator");
  const [assignee, setAssignee] = useState("");
  const datasetId = selected.id;
  const verification = useCards(datasetId, "verification");
  const overdueValidation = useCards(datasetId, "validation_overdue");
  const overduePms = useCards(datasetId, "pms_overdue");
  const overdueFollow = useCards(datasetId, "followup_overdue");
  const unassigned = useCards(datasetId, "unassigned", { slot });
  const workload = useQuery({
    queryKey: ["workload", datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ members: Array<{ id: string; name: string; role: string; doneToday: number }> }>(`/api/team/workload?datasetId=${datasetId}`),
  });
  const assignees = useQuery({
    queryKey: ["assignees", datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ users: Array<{ id: string; name: string; role: "validator" | "service" }> }>(`/api/datasets/${datasetId}/assignees`),
  });

  useEffect(() => {
    writeWorkspace(user.id, { tab, mine: false, city: "", contract: "" });
  }, [user.id, tab]);

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

  async function act(item: WorkCardItem, path: string, body: unknown) {
    if (!datasetId) return;
    try {
      await rowAction(datasetId, item.rowId, path, body);
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not save."));
    }
  }

  const people = (assignees.data?.users ?? []).filter((person) => person.role === slot);

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceHeader />
      <KpiRow datasetId={datasetId} />
      {!selected.loading && selected.datasets.length === 0 ? <UploadDropzone /> : null}
      {datasetId ? (
        <Tabs value={tab} onValueChange={(value) => { if (TABS.includes(value as (typeof TABS)[number])) setTab(value as (typeof TABS)[number]); }}>
          <TabsList>
            <TabsTrigger value="verification">Verification queue</TabsTrigger>
            <TabsTrigger value="amc">AMC pipeline</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>
          <TabsContent value="verification">
            <WorkList
              datasetId={datasetId}
              {...verification}
              onOpen={open}
              selected={selectedIds}
              onToggle={toggle}
              renderActions={(item) => (
                <>
                  <Button size="sm" onClick={() => void act(item, "/actions/verify", { verified: true })}>
                    Verify OK
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setSendBack(item.rowId)}>
                    Send back
                  </Button>
                </>
              )}
            />
            <SelectionBar
              count={selectedIds.size}
              label="Bulk verify"
              onClear={() => setSelectedIds(new Set())}
              onAction={() => {
                const rowIds = [...selectedIds];
                void bulkAction(datasetId, "/bulk/verify", { rowIds, verified: true })
                  .then(() => setSelectedIds(new Set()))
                  .catch((error: unknown) => {
                    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not verify the rows."));
                  });
              }}
            />
          </TabsContent>
          <TabsContent value="amc">
            <div className="grid gap-4 md:grid-cols-5">
              {AMC.map((column) => (
                <AmcColumn key={column.queue} datasetId={datasetId} queue={column.queue} label={column.label} action={column.action} onOpen={open} />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="overdue">
            <div className="grid gap-6 xl:grid-cols-2">
              <QueueBlock title="Validation overdue" datasetId={datasetId} cards={overdueValidation} onOpen={open} />
              <QueueBlock title="PMS overdue" datasetId={datasetId} cards={overduePms} onOpen={open} />
              <QueueBlock title="Follow-ups overdue" datasetId={datasetId} cards={overdueFollow} onOpen={open} />
            </div>
          </TabsContent>
          <TabsContent value="team">
            <div className="grid gap-6 xl:grid-cols-2">
              <section>
                <h2 className="mb-3 font-serif text-2xl text-ink">Done today</h2>
                {workload.data?.members.map((member) => (
                  <p key={member.id} className="flex justify-between border-b border-hairline py-2 text-sm">
                    <span>{member.name}</span>
                    <span className="text-ink-2">{member.doneToday}</span>
                  </p>
                ))}
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="font-serif text-2xl text-ink">Assign unassigned</h2>
                <div className="flex flex-wrap gap-2">
                  <Button variant={slot === "validator" ? "primary" : "secondary"} onClick={() => { setSlot("validator"); setAssignee(""); setSelectedIds(new Set()); }}>
                    Validator
                  </Button>
                  <Button variant={slot === "service" ? "primary" : "secondary"} onClick={() => { setSlot("service"); setAssignee(""); setSelectedIds(new Set()); }}>
                    Service
                  </Button>
                </div>
                <Select value={assignee || undefined} onValueChange={setAssignee}>
                  <SelectTrigger aria-label="Assignee">
                    <SelectValue placeholder="Choose a person" />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <WorkList datasetId={datasetId} {...unassigned} onOpen={open} selected={selectedIds} onToggle={toggle} />
                <SelectionBar
                  count={selectedIds.size}
                  label="Assign"
                  onClear={() => setSelectedIds(new Set())}
                  onAction={() => {
                    if (!assignee) {
                      toast.error("Choose a person first.");
                      return;
                    }
                    const body = slot === "service" ? { rowIds: [...selectedIds], serviceId: assignee } : { rowIds: [...selectedIds], validatorId: assignee };
                    void bulkAction(datasetId, "/bulk/assign", body)
                      .then(() => setSelectedIds(new Set()))
                      .catch((error: unknown) => {
                        if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not assign the rows."));
                      });
                  }}
                />
              </section>
            </div>
          </TabsContent>
        </Tabs>
      ) : null}
      <NoteDialog
        open={sendBack != null}
        title="Send back"
        description="Add a note of at least 5 characters."
        confirmLabel="Send back"
        onClose={() => setSendBack(null)}
        onConfirm={async (note) => {
          if (!datasetId || !sendBack) return;
          try {
            await rowAction(datasetId, sendBack, "/actions/verify", { verified: false, note });
            setSendBack(null);
          } catch (error) {
            if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not send the record back."));
          }
        }}
      />
    </div>
  );
}

function AmcColumn({
  datasetId,
  queue,
  label,
  action,
  onOpen,
}: {
  datasetId: string;
  queue: string;
  label: string;
  action: "proposal_sent" | "acknowledge" | null;
  onOpen: (rowId: string) => void;
}) {
  const cards = useCards(datasetId, queue);
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-2">{label}</h2>
      <WorkList
        datasetId={datasetId}
        {...cards}
        onOpen={onOpen}
              renderActions={(item) => (
                <>
                  {action ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        void rowAction(datasetId, item.rowId, "/actions/amc", { action }).catch((error: unknown) => {
                          if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update AMC."));
                        });
                      }}
                    >
                      {action === "proposal_sent" ? "Send proposal" : "Acknowledge"}
                    </Button>
                  ) : null}
                  {queue === "amc_proposal" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void rowAction(datasetId, item.rowId, "/actions/amc", { action: "decline" }).catch((error: unknown) => {
                          if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update AMC."));
                        });
                      }}
                    >
                      Decline
                    </Button>
                  ) : null}
                </>
              )}
      />
    </section>
  );
}

function QueueBlock({
  title,
  datasetId,
  cards,
  onOpen,
}: {
  title: string;
  datasetId: string;
  cards: ReturnType<typeof useCards>;
  onOpen: (rowId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      <WorkList datasetId={datasetId} {...cards} onOpen={onOpen} />
    </section>
  );
}
