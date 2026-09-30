import type { DatasetColumn, DatasetGroup, DatasetSchema, PmsEntryStatus, Role, RowProjection } from "@app/shared";
import {
  UNDO_SECONDS,
  canEditGroup,
  canPerformAction,
  canViewGroup,
  effectiveAmcStatus,
  formatDisplayDate,
  isWarrantyExpired,
  pmsEntryStatus,
  warrantyLiveStatus,
} from "@app/shared";
import { formatDistanceToNow } from "date-fns";
import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { refreshWorkspace } from "../workspace/actions";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Pill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "../../components/ui";
import type { PillTone } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { displayText, statusTone } from "./model";

type CallItem = {
  id: string;
  type: string;
  description: string;
  reportedAt: string;
  status: string;
  resolvedAt: string | null;
  note: string | null;
};

type ActivityItem = { who: string; what: string; when: string };

const AMC_STEPS = ["Not Due", "AMC Due", "Proposal Sent", "Acknowledged"] as const;

export function RecordDrawer({
  datasetId,
  row,
  schema,
  role,
  groupAccess,
  countryCode,
  focusGroupKey,
  focusKeys,
  revision,
  onOpenChange,
}: {
  datasetId: string;
  row: RowProjection | null;
  schema: DatasetSchema;
  role: Role;
  groupAccess: "all" | Record<string, { view: boolean; edit: boolean }>;
  countryCode: string;
  focusGroupKey: string;
  focusKeys: string[];
  revision: number;
  onOpenChange: (open: boolean) => void;
}) {
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [callType, setCallType] = useState("Complaint");
  const [callText, setCallText] = useState("");
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const canCalls =
    canViewGroup(groupAccess, "complaint") || canViewGroup(groupAccess, "breakdown_calls");
  const preferred =
    focusGroupKey ||
    (role === "validator" ? "data_validation" : role === "service" ? "amc" : schema.groups[0]?.groupKey ?? "");

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    if (canCalls) {
      void api<{ calls: CallItem[] }>(`/api/datasets/${datasetId}/rows/${row.id}/calls`)
        .then((result) => {
          if (!cancelled) setCalls(result.calls);
        })
        .catch(() => {
          if (!cancelled) setCalls([]);
        });
    } else setCalls([]);
    void api<{ activity: ActivityItem[] }>(`/api/datasets/${datasetId}/rows/${row.id}/activity`)
      .then((result) => {
        if (!cancelled) setActivity(result.activity);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canCalls, datasetId, revision, row]);

  const customer = textOf(row, schema.columns, "customer_name");
  const serial = textOf(row, schema.columns, "serial");
  const equipment = textOf(row, schema.columns, /equipment|instrument name|model/i);
  const phone = dialNumber(textOf(row, schema.columns, "mobile") || firstPhone(row, schema.columns), countryCode);
  const email = textOf(row, schema.columns, "email");
  const endDate = textOf(row, schema.columns, "end_date");
  const validated = textOf(row, schema.columns, "validated");
  const validatedBy = textOf(row, schema.columns, "validated_by");
  const validatedAt = textOf(row, schema.columns, "validated_at");
  const rejectionReason = textOf(row, schema.columns, "rejection_reason");
  const verified = textOf(row, schema.columns, "verified");
  const amcStored = textOf(row, schema.columns, "amc_status");
  const today = new Date().toISOString().slice(0, 10);
  const warranty = warrantyLiveStatus(endDate || null, today);
  const amc = effectiveAmcStatus(amcStored || null, isWarrantyExpired(endDate || null, today));

  async function act(path: string, body: unknown, history = false) {
    if (!row) return;
    setBusy(true);
    try {
      const result = await api<{ actionId: string }>(`/api/datasets/${datasetId}/rows/${row.id}${path}`, {
        method: "POST",
        body,
      });
      await refreshWorkspace(datasetId);
      toast("Saved", {
        duration: UNDO_SECONDS * 1000,
        action: {
          label: "Undo",
          onClick: () => {
            void api(`/api/datasets/${datasetId}/rows/${row.id}/undo`, {
              method: "POST",
              body: { actionId: result.actionId },
            }).then(async () => {
              await refreshWorkspace(datasetId);
              toast.success("Undone.");
            });
          },
        },
        cancel: history
          ? {
              label: "History",
              onClick: () => undefined,
            }
          : {
              label: "History",
              onClick: () => {
                const node = document.getElementById("record-activity");
                node?.scrollIntoView({ block: "nearest" });
              },
            },
      });
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  const pms = useMemo(() => pmsEntries(schema.columns, row), [schema.columns, row]);

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent className="md:w-[480px]">
        {row ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {focusKeys.length > 0 ? (
              <div className="sticky top-0 z-10 border-b border-hairline bg-gold-soft px-5 py-2 text-sm text-ink">
                Edited fields: {editedLabels(schema, focusKeys, groupAccess)}
              </div>
            ) : null}
            <SheetHeader>
              <SheetTitle className="truncate font-serif text-[28px] leading-tight">{customer || "Record"}</SheetTitle>
              <SheetDescription className="truncate">
                {[equipment, serial].filter(Boolean).join(" · ") || "No equipment details"}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap gap-2 px-5">
              <Pill tone={warrantyTone(warranty)}>{warranty}</Pill>
              <Pill tone={statusTone(amc)}>{amc}</Pill>
              <Pill tone={validated === "Yes" ? "emerald" : validated === "No" ? "ruby" : "stone"}>
                {validated ? `Validated ${validated}` : "Not validated"}
              </Pill>
            </div>
            <p className="px-5 pt-2 text-sm text-ink-2">
              Updated {formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true })}
              {row.updatedByName ? ` by ${row.updatedByName}` : ""}
            </p>
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {phone ? (
                <Button variant="secondary" asChild>
                  <a href={`tel:${phone}`}>Call</a>
                </Button>
              ) : null}
              {email ? (
                <Button variant="secondary" asChild>
                  <a href={`mailto:${email}`}>Email</a>
                </Button>
              ) : null}
              {phone ? (
                <Button variant="secondary" asChild>
                  <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 px-5 pb-6">
              {schema.groups.map((group) => {
                const columns = schema.columns.filter((column) => column.groupId === group.id);
                if (columns.length === 0) return null;
                const editable = canEditGroup(groupAccess, group.groupKey);
                const open = group.groupKey === preferred;
                return (
                  <details key={group.id} open={open} className="rounded-card border border-hairline">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3">
                      {editable ? null : <Lock className="size-3.5 text-gold" strokeWidth={1.5} />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{group.label}</span>
                    </summary>
                    <div className="flex flex-col gap-3 border-t border-hairline px-3 py-3">
                      {group.groupKey === "schedule_services" ? (
                        <PmsTimeline
                          entries={pms}
                          busy={busy}
                          canAct={canPerformAction(role, "pms", (key) => canEditGroup(groupAccess, key))}
                          onDone={(n) => void act("/actions/pms", { action: "markDone", n })}
                          onReschedule={(n, date) => void act("/actions/pms", { action: "reschedule", n, date })}
                        />
                      ) : null}
                      {group.groupKey === "data_validation" ? (
                        <ValidationPanel
                          validated={validated}
                          validatedBy={validatedBy}
                          validatedAt={validatedAt}
                          rejectionReason={rejectionReason}
                          verified={verified}
                          role={role}
                          busy={busy}
                          canValidate={canPerformAction(role, "validate", (key) => canEditGroup(groupAccess, key))}
                          showReject={showReject}
                          reason={reason}
                          expectedDate={expectedDate}
                          onReason={setReason}
                          onDate={setExpectedDate}
                          onYes={() => void act("/actions/validate", { result: "Yes" }, true)}
                          onNo={() => setShowReject(true)}
                          onSubmitNo={() =>
                            void act("/actions/validate", { result: "No", reason, expectedDate }, true).then(() => setShowReject(false))
                          }
                          onVerify={() => void act("/actions/verify", { verified: true }, true)}
                          onSendBack={() => setSendBack(true)}
                        />
                      ) : null}
                      {group.groupKey === "amc" ? (
                        <AmcPanel
                          status={amc}
                          role={role}
                          busy={busy}
                          note={note}
                          followDate={followDate}
                          canAct={canPerformAction(role, "amc", (key) => canEditGroup(groupAccess, key))}
                          onNote={setNote}
                          onFollow={setFollowDate}
                          onProposal={() => void act("/actions/amc", { action: "proposal_sent", note })}
                          onAck={() => void act("/actions/amc", { action: "acknowledge", note })}
                          onDecline={() => void act("/actions/amc", { action: "decline", note })}
                          onReset={() => void act("/actions/amc", { action: "reset" })}
                          onFollowSave={() => {
                            if (followDate) void act("/actions/followup", { date: followDate });
                          }}
                        />
                      ) : null}
                      {columns
                        .filter((column) => !hiddenInSection(group, column))
                        .map((column) => (
                          <p key={column.key} className="min-w-0 text-sm text-ink">
                            <span className="text-ink-2">{column.label}: </span>
                            <span className="break-words">{displayText(column, row.values[column.key]) || "—"}</span>
                          </p>
                        ))}
                    </div>
                  </details>
                );
              })}
              {canCalls ? (
                <section className="rounded-card border border-hairline px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-ink">Service calls</h3>
                    {canPerformAction(role, "calls", (key) => canEditGroup(groupAccess, key)) ? (
                      <Button size="sm" variant="secondary" onClick={() => setCallOpen(true)}>
                        Log call
                      </Button>
                    ) : null}
                  </div>
                  {calls.length === 0 ? <p className="text-sm text-ink-2">No calls yet.</p> : null}
                  <ul className="flex flex-col gap-2">
                    {calls.map((call) => (
                      <li key={call.id} className="rounded-control border border-hairline p-2 text-sm">
                        <p className="font-medium text-ink">{call.type}</p>
                        <p className="text-ink-2">{call.description}</p>
                        <p className="text-xs text-muted">{call.status}</p>
                        {call.status === "Open" && canPerformAction(role, "calls", (key) => canEditGroup(groupAccess, key)) ? (
                          <Button size="sm" className="mt-2" variant="secondary" onClick={() => setResolveId(call.id)}>
                            Resolve call
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section id="record-activity" className="rounded-card border border-hairline px-3 py-3">
                <h3 className="mb-2 text-sm font-medium text-ink">Activity</h3>
                {activity.length === 0 ? <p className="text-sm text-ink-2">No activity yet.</p> : null}
                <ul className="flex max-h-64 flex-col gap-2 overflow-auto">
                  {activity.map((entry, index) => (
                    <li key={`${entry.when}-${index}`} className="text-sm">
                      <p className="text-ink">{entry.what}</p>
                      <p className="text-xs text-ink-2">
                        {entry.who} · {formatDistanceToNow(new Date(entry.when), { addSuffix: true })}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        ) : null}
        <Dialog open={sendBack} onOpenChange={setSendBack}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send back</DialogTitle>
              <DialogDescription>Add a note of at least 5 characters.</DialogDescription>
            </DialogHeader>
            <div className="px-5">
              <Input value={note} aria-label="Send back note" onChange={(event) => setNote(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSendBack(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void act("/actions/verify", { verified: false, note }, true).then(() => setSendBack(false));
                }}
              >
                Send back
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={callOpen} onOpenChange={setCallOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log call</DialogTitle>
              <DialogDescription>Record a complaint or breakdown call.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 px-5">
              <Select value={callType} onValueChange={setCallType}>
                <SelectTrigger aria-label="Call type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Complaint", "Breakdown", "Emergency", "CourtesyVisit"].map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor="call-description">Description</Label>
              <Input id="call-description" value={callText} onChange={(event) => setCallText(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCallOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !callText.trim()}
                onClick={() => {
                  void act("/calls", { type: callType, description: callText }).then(() => {
                    setCallOpen(false);
                    setCallText("");
                  });
                }}
              >
                {busy ? <Spinner /> : null}
                Log call
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={resolveId != null} onOpenChange={(open) => { if (!open) setResolveId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve call</DialogTitle>
              <DialogDescription>Optional note for the resolution.</DialogDescription>
            </DialogHeader>
            <div className="px-5">
              <Input value={resolveNote} aria-label="Resolution note" onChange={(event) => setResolveNote(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setResolveId(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !resolveId}
                onClick={() => {
                  if (!resolveId) return;
                  void act(`/calls/${resolveId}/resolve`, { note: resolveNote }).then(() => setResolveId(null));
                }}
              >
                Resolve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function ValidationPanel(props: {
  validated: string;
  validatedBy: string;
  validatedAt: string;
  rejectionReason: string;
  verified: string;
  role: Role;
  busy: boolean;
  canValidate: boolean;
  showReject: boolean;
  reason: string;
  expectedDate: string;
  onReason: (value: string) => void;
  onDate: (value: string) => void;
  onYes: () => void;
  onNo: () => void;
  onSubmitNo: () => void;
  onVerify: () => void;
  onSendBack: () => void;
}) {
  const manager = props.role === "admin" || props.role === "manager";
  const when = /^\d{4}-\d{2}-\d{2}$/.test(props.validatedAt) ? formatDisplayDate(props.validatedAt) : props.validatedAt;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink">
        {props.validated
          ? `Validated ${props.validated}${props.validatedBy ? ` by ${props.validatedBy}` : ""}${when ? ` on ${when}` : ""}`
          : "Not validated yet."}
      </p>
      {props.validated === "No" && props.rejectionReason ? <p className="text-sm text-ink-2">{props.rejectionReason}</p> : null}
      {props.canValidate ? (
        <div className="flex gap-2">
          <Button size="sm" variant={props.validated === "Yes" ? "primary" : "secondary"} disabled={props.busy} onClick={props.onYes}>
            Yes
          </Button>
          <Button size="sm" variant={props.validated === "No" ? "primary" : "secondary"} disabled={props.busy} onClick={props.onNo}>
            No
          </Button>
        </div>
      ) : null}
      {props.showReject ? (
        <div className="flex flex-col gap-2">
          <Input value={props.reason} placeholder="Rejection reason" aria-label="Rejection reason" onChange={(event) => props.onReason(event.target.value)} />
          <Input value={props.expectedDate} placeholder="YYYY-MM-DD" aria-label="Expected date" onChange={(event) => props.onDate(event.target.value)} />
          <Button size="sm" disabled={props.busy} onClick={props.onSubmitNo}>
            Save rejection
          </Button>
        </div>
      ) : null}
      {manager && props.validated === "Yes" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onVerify}>
            Verify OK
          </Button>
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onSendBack}>
            Send back
          </Button>
        </div>
      ) : null}
      {props.verified ? <Badge>{props.verified}</Badge> : null}
    </div>
  );
}

function AmcPanel(props: {
  status: string;
  role: Role;
  busy: boolean;
  note: string;
  followDate: string;
  canAct: boolean;
  onNote: (value: string) => void;
  onFollow: (value: string) => void;
  onProposal: () => void;
  onAck: () => void;
  onDecline: () => void;
  onReset: () => void;
  onFollowSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-2 text-xs text-ink-2">
        {AMC_STEPS.map((step) => (
          <li key={step} className={props.status === step || (step === "Acknowledged" && props.status === "Declined") ? "font-medium text-ink" : ""}>
            {step}
          </li>
        ))}
        {props.status === "Declined" ? <li className="font-medium text-ink">Declined</li> : null}
      </ol>
      {props.canAct ? (
        <>
          <Input value={props.note} placeholder="Note" aria-label="AMC note" onChange={(event) => props.onNote(event.target.value)} />
          {props.status === "AMC Due" ? (
            <Button size="sm" disabled={props.busy} onClick={props.onProposal}>
              Proposal sent
            </Button>
          ) : null}
          {props.status === "Proposal Sent" ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={props.busy} onClick={props.onAck}>
                Acknowledge
              </Button>
              <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onDecline}>
                Decline
              </Button>
            </div>
          ) : null}
          {props.role === "admin" || props.role === "manager" ? (
            <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onReset}>
              Reset
            </Button>
          ) : null}
          <Input value={props.followDate} placeholder="Next follow-up YYYY-MM-DD" aria-label="Next follow-up" onChange={(event) => props.onFollow(event.target.value)} />
          <Button size="sm" variant="secondary" disabled={props.busy || !props.followDate} onClick={props.onFollowSave}>
            Save follow-up
          </Button>
        </>
      ) : null}
    </div>
  );
}

function PmsTimeline({
  entries,
  busy,
  canAct,
  onDone,
  onReschedule,
}: {
  entries: Array<{ n: number; scheduled: string; done: string; status: PmsEntryStatus }>;
  busy: boolean;
  canAct: boolean;
  onDone: (n: number) => void;
  onReschedule: (n: number, date: string) => void;
}) {
  const [dates, setDates] = useState<Record<number, string>>({});
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-2">Total PMS {entries.length}</p>
      {entries.map((entry) => (
        <article key={entry.n} className="rounded-control border border-hairline p-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-ink">PMS {entry.n}</p>
            <Pill tone={pmsTone(entry.status)}>{entry.status}</Pill>
          </div>
          <p className="text-ink-2">Scheduled {entry.scheduled}</p>
          <p className="text-ink-2">Done {entry.done || "—"}</p>
          {canAct && entry.status !== "Done" && entry.status !== "Lapsed" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => onDone(entry.n)}>
                Mark done today
              </Button>
              <Input
                className="max-w-[10rem]"
                value={dates[entry.n] ?? ""}
                placeholder="YYYY-MM-DD"
                aria-label={`Reschedule PMS ${entry.n}`}
                onChange={(event) => setDates((current) => ({ ...current, [entry.n]: event.target.value }))}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !dates[entry.n]}
                onClick={() => {
                  const date = dates[entry.n];
                  if (date) onReschedule(entry.n, date);
                }}
              >
                Reschedule
              </Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function hiddenInSection(group: DatasetGroup, column: DatasetColumn): boolean {
  if (group.groupKey === "schedule_services" && (/^pms:\d+$/.test(column.semantic ?? column.key) || /^pm_date:\d+$/.test(column.semantic ?? column.key))) {
    return true;
  }
  return false;
}

function pmsEntries(columns: DatasetColumn[], row: RowProjection | null) {
  if (!row) return [];
  const entries: Array<{ n: number; scheduled: string; done: string; status: PmsEntryStatus }> = [];
  for (const column of columns) {
    const match = /^pms:(\d+)$/.exec(column.semantic ?? "") ?? /^pms:(\d+)$/.exec(column.key);
    const number = match?.[1];
    if (!number) continue;
    const scheduled = row.values[column.key];
    if (typeof scheduled !== "string" || scheduled === "NA" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) continue;
    const doneColumn = columns.find((item) => item.semantic === `pm_date:${number}` || item.key === `pm_date:${number}`);
    const doneValue = doneColumn ? row.values[doneColumn.key] : null;
    const done = typeof doneValue === "string" ? doneValue : "";
    const endColumn = columns.find((item) => item.semantic === "end_date" || item.key === "end_date");
    const end = endColumn && typeof row.values[endColumn.key] === "string" ? row.values[endColumn.key] : null;
    entries.push({
      n: Number(number),
      scheduled,
      done,
      status: pmsEntryStatus({
        scheduled,
        done,
        endDate: typeof end === "string" ? end : null,
        today: new Date().toISOString().slice(0, 10),
      }),
    });
  }
  return entries.sort((left, right) => left.scheduled.localeCompare(right.scheduled) || left.n - right.n);
}

function textOf(row: RowProjection | null, columns: DatasetColumn[], semantic: string | RegExp): string {
  if (!row) return "";
  const column = columns.find((item) => {
    if (typeof semantic === "string") return item.semantic === semantic || item.key === semantic;
    return semantic.test(item.label) || (item.semantic != null && semantic.test(item.semantic));
  });
  if (!column) return "";
  const value = row.values[column.key];
  return value == null ? "" : String(value);
}

function firstPhone(row: RowProjection | null, columns: DatasetColumn[]): string {
  if (!row) return "";
  const column = columns.find((item) => item.type === "phone");
  if (!column) return "";
  const value = row.values[column.key];
  return value == null ? "" : String(value);
}

function dialNumber(raw: string, countryCode: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) return `+${countryCode.replace(/\D/g, "")}${digits}`;
  return `+${digits}`;
}

function warrantyTone(status: string): PillTone {
  if (status === "Active") return "emerald";
  if (status === "Expiring") return "amber";
  if (status === "Expired") return "ruby";
  return "stone";
}

function editedLabels(
  schema: DatasetSchema,
  keys: string[],
  groupAccess: "all" | Record<string, { view: boolean; edit: boolean }>,
): string {
  const labels = keys.flatMap((key) => {
    const column = schema.columns.find((item) => item.key === key);
    if (!column) return [];
    const group = schema.groups.find((item) => item.id === column.groupId);
    if (group && !canViewGroup(groupAccess, group.groupKey)) return [];
    return [column.label];
  });
  return labels.join(", ") || "updated a record";
}

function pmsTone(status: PmsEntryStatus): PillTone {
  if (status === "Done") return "emerald";
  if (status === "Due soon") return "amber";
  if (status === "Overdue") return "ruby";
  if (status === "Lapsed") return "stone";
  return "sapphire";
}
