import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../../components/ui";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { readWorkspace, writeWorkspace } from "../records/storage";
import { rowAction } from "./actions";
import { KpiRow, QuietEmpty, WorkList, WorkspaceHeader } from "./parts";
import { CALL_TYPES, type WorkCardItem } from "./types";
import { useCards } from "./use-cards";
import { useSelectedDataset } from "./use-dataset";

const TABS = ["agenda", "amc", "calls", "followups"] as const;
const BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
] as const;

export function ServiceDesk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const selected = useSelectedDataset();
  const saved = readWorkspace(user.id);
  const initial = (TABS as readonly string[]).includes(saved.tab) ? (saved.tab as (typeof TABS)[number]) : "agenda";
  const [tab, setTab] = useState<(typeof TABS)[number]>(initial);
  const [reschedule, setReschedule] = useState<WorkCardItem | null>(null);
  const [date, setDate] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [resolveItem, setResolveItem] = useState<WorkCardItem | null>(null);
  const [note, setNote] = useState("");
  const [agendaQuery, setAgendaQuery] = useState("");
  const datasetId = selected.id;
  const agenda = useCards(datasetId, "agenda");
  const calls = useCards(datasetId, "calls");
  const followups = useCards(datasetId, "followups");

  useEffect(() => {
    writeWorkspace(user.id, { tab, mine: false, city: "", contract: "" });
  }, [user.id, tab]);

  function open(rowId: string) {
    if (datasetId) void navigate(`/records/${datasetId}?row=${rowId}`);
  }

  async function act(item: WorkCardItem, path: string, body: unknown) {
    if (!datasetId) return;
    try {
      await rowAction(datasetId, item.rowId, path, body);
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not save."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceHeader />
      <KpiRow datasetId={datasetId} />
      {!selected.loading && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
        <Tabs value={tab} onValueChange={(value) => { if ((TABS as readonly string[]).includes(value)) setTab(value as (typeof TABS)[number]); }}>
          <TabsList>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
            <TabsTrigger value="amc">AMC leads</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          </TabsList>
          <TabsContent value="agenda">
            <div className="flex flex-col gap-6">
              <Input data-search="" aria-label="Search" placeholder="Search" value={agendaQuery} onChange={(event) => setAgendaQuery(event.target.value)} />
              {BUCKETS.map((bucket) => (
                <section key={bucket.key} className="flex flex-col gap-3">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-ink-2">{bucket.label}</h2>
                  <WorkList
                    datasetId={datasetId}
                    {...agenda}
                    searchable={false}
                    items={agenda.items.filter((item) => item.bucket === bucket.key && matches(item, agendaQuery))}
                    hasMore={false}
                    total={agenda.total}
                    onOpen={open}
                    empty="None here."
                    renderActions={(item) => (
                      <>
                        <Button size="sm" disabled={item.pmsN == null} onClick={() => void act(item, "/actions/pms", { action: "markDone", n: item.pmsN })}>
                          Mark done
                        </Button>
                        <Button size="sm" variant="secondary" disabled={item.pmsN == null} onClick={() => { setReschedule(item); setDate(item.scheduled ?? ""); }}>
                          Reschedule
                        </Button>
                      </>
                    )}
                  />
                </section>
              ))}
              {agenda.hasMore ? (
                <Button variant="secondary" onClick={agenda.onLoadMore} disabled={agenda.loadingMore}>
                  Load more
                </Button>
              ) : null}
            </div>
          </TabsContent>
          <TabsContent value="amc">
            <div className="flex flex-col gap-6">
              <LeadColumn datasetId={datasetId} queue="amc_due" label="AMC due" onOpen={open} />
              <LeadColumn datasetId={datasetId} queue="amc_proposal" label="Proposal sent" onOpen={open} />
              <LeadColumn datasetId={datasetId} queue="amc_acknowledged" label="Acknowledged" onOpen={open} />
              <LeadColumn datasetId={datasetId} queue="amc_declined" label="Declined" onOpen={open} />
            </div>
          </TabsContent>
          <TabsContent value="calls">
            <WorkList
              datasetId={datasetId}
              {...calls}
              onOpen={open}
              renderActions={(item) =>
                item.callId ? (
                  <Button size="sm" onClick={() => { setResolveItem(item); setNote(""); }}>
                    Resolve call
                  </Button>
                ) : null
              }
            />
            <Button className="fixed bottom-20 right-4 z-topbar shadow-float md:bottom-6" onClick={() => setLogOpen(true)}>
              Log call
            </Button>
          </TabsContent>
          <TabsContent value="followups">
            <WorkList
              datasetId={datasetId}
              {...followups}
              onOpen={open}
              renderActions={(item) => (
                <Input
                  type="date"
                  aria-label={`Next follow-up for ${item.customer}`}
                  onChange={(event) => {
                    if (event.target.value) void act(item, "/actions/followup", { date: event.target.value });
                  }}
                />
              )}
            />
          </TabsContent>
        </Tabs>
      ) : null}
      <Dialog open={reschedule != null} onOpenChange={(openDialog) => { if (!openDialog) setReschedule(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule PMS</DialogTitle>
            <DialogDescription>{reschedule?.customer}</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-2">
            <Label htmlFor="pms-date">Date</Label>
            <Input id="pms-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReschedule(null)}>
              Cancel
            </Button>
            <Button
              disabled={!date || reschedule?.pmsN == null}
              onClick={() => {
                if (!reschedule || reschedule.pmsN == null) return;
                void act(reschedule, "/actions/pms", { action: "reschedule", n: reschedule.pmsN, date }).then(() => setReschedule(null));
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LogCallDialog
        open={logOpen}
        datasetId={datasetId}
        options={agenda.items}
        onClose={() => setLogOpen(false)}
      />
      <Dialog open={resolveItem != null} onOpenChange={(openDialog) => { if (!openDialog) setResolveItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve call</DialogTitle>
            <DialogDescription>{resolveItem?.customer}</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-2">
            <Label htmlFor="resolve-note">Note</Label>
            <Textarea id="resolve-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResolveItem(null)}>
              Cancel
            </Button>
            <Button
              disabled={!resolveItem?.callId}
              onClick={() => {
                if (!resolveItem?.callId) return;
                void act(resolveItem, `/calls/${resolveItem.callId}/resolve`, { note }).then(() => setResolveItem(null));
              }}
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function matches(item: WorkCardItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${item.customer} ${item.equipment} ${item.serial} ${item.summary}`.toLowerCase().includes(needle);
}

function LeadColumn({
  datasetId,
  queue,
  label,
  onOpen,
}: {
  datasetId: string;
  queue: string;
  label: string;
  onOpen: (rowId: string) => void;
}) {
  const cards = useCards(datasetId, queue);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-2">{label}</h2>
      <WorkList
        datasetId={datasetId}
        {...cards}
        onOpen={onOpen}
        renderActions={(item) => <AmcLeadActions datasetId={datasetId} item={item} queue={queue} />}
      />
    </section>
  );
}

function AmcLeadActions({ datasetId, item, queue }: { datasetId: string; item: WorkCardItem; queue: string }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  if (queue !== "amc_due" && queue !== "amc_proposal") return null;
  return (
    <div className="flex w-full flex-col gap-2">
      <Input aria-label="Note" placeholder="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      <Input aria-label="Follow-up date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        {queue === "amc_due" ? (
          <Button size="sm" onClick={() => void save(datasetId, item, "proposal_sent", note, date)}>
            Send proposal
          </Button>
        ) : null}
        {queue === "amc_proposal" ? (
          <Button size="sm" onClick={() => void save(datasetId, item, "acknowledge", note, date)}>
            Acknowledge
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => void save(datasetId, item, "decline", note, date)}>
          Decline
        </Button>
      </div>
    </div>
  );
}

function save(datasetId: string, item: WorkCardItem, action: "proposal_sent" | "acknowledge" | "decline", note: string, date: string) {
  void rowAction(datasetId, item.rowId, "/actions/amc", {
    action,
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(date ? { date } : {}),
  }).catch((error: unknown) => {
    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not update AMC."));
  });
}

function LogCallDialog({
  open,
  datasetId,
  options,
  onClose,
}: {
  open: boolean;
  datasetId: string | null;
  options: WorkCardItem[];
  onClose: () => void;
}) {
  const [rowId, setRowId] = useState("");
  const [type, setType] = useState<(typeof CALL_TYPES)[number]>("Complaint");
  const [description, setDescription] = useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log call</DialogTitle>
          <DialogDescription>Attach the call to a live contract on the agenda.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 pb-2">
          <Select value={rowId || "none"} onValueChange={(value) => setRowId(value === "none" ? "" : value)}>
            <SelectTrigger aria-label="Record">
              <SelectValue placeholder="Choose a record" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose a record</SelectItem>
              {options.map((item) => (
                <SelectItem key={item.rowId} value={item.rowId}>
                  {item.customer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(value) => { if ((CALL_TYPES as readonly string[]).includes(value)) setType(value as (typeof CALL_TYPES)[number]); }}>
            <SelectTrigger aria-label="Call type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CALL_TYPES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea aria-label="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!datasetId || !rowId || description.trim().length === 0}
            onClick={() => {
              if (!datasetId || !rowId) return;
              void rowAction(datasetId, rowId, "/calls", { type, description: description.trim() })
                .then(() => onClose())
                .catch((error: unknown) => {
                  if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not log the call."));
                });
            }}
          >
            Log call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
