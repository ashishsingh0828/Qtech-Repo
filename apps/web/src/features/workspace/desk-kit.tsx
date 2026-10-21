import type { DatasetColumn, DatasetDetail, PublicUser } from "@app/shared";
import { formatDisplayDate } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  PageHeader,
  Pill,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { cn } from "../../lib/utils";
import { useAuth } from "../auth/auth-gate";
import { rowAction } from "./actions";

export const CONTRACT_TYPES = [
  "Warranty",
  "Extended Warranty",
  "Extended CMC",
  "Paid AMC",
  "CMC",
  "Annual Calibration",
  "Paid Single Visit",
] as const;

export const DELAY_REASONS = ["Customer Not Available", "Out Station Calls Club", "Other"] as const;
export const AMC_OUTCOMES = ["Pending", "Delayed", "Refusal", "Accepted"] as const;
export const AMC_REASONS = ["Customer Not Available", "Customer Not Agreed", "Price", "Other"] as const;

export type DeskReminder = { n: number; lab: string; to: string; lvl: "" | "warn" | "bad" };
export type DeskPm = {
  n: number;
  date: string;
  done: string;
  state: "Scheduled" | "Acknowledged" | "Delayed" | "Closed";
  ack: boolean;
  reason: string;
  plan: string;
  reminder: DeskReminder | null;
};
export type DeskContract = {
  rowId: string;
  version: number;
  customer: string;
  city: string;
  contact: string;
  mobile: string;
  mail: string;
  loc: string;
  type: string;
  equip: string;
  serial: string;
  start: string;
  end: string;
  valid: string;
  vby: string;
  vdue: string;
  eng: string;
  serviceId: string | null;
  daysLeft: number | null;
  amc: { state: string; reason: string; remark: string; date: string; doc: string; reminder: DeskReminder | null };
  pms: DeskPm[];
};
export type DeskBoard = {
  today: string;
  contracts: DeskContract[];
  engineers: Array<{ id: string; name: string }>;
};
export type RowOtp = { otpRequired: boolean; challengeId?: string; sentTo?: string; previewCode?: string };

export function isAccountsUser(user: { email: string }): boolean {
  return user.email.toLowerCase() === "accounts@example.com";
}

export function useDesk(datasetId: string | null) {
  return useQuery({
    queryKey: ["desk", datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<DeskBoard>(`/api/workspace/desk?datasetId=${datasetId}`),
  });
}

export function mineContract(contract: DeskContract, user: PublicUser): boolean {
  if (contract.serviceId === user.id) return true;
  return contract.eng.trim().toLowerCase() === user.name.trim().toLowerCase();
}

export function openPms(contract: DeskContract): DeskPm[] {
  return contract.pms.filter((item) => item.state !== "Closed");
}

export function monthLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match?.[1] || !match[2]) return "Unscheduled";
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

export function showDate(value: string): string {
  return value ? formatDisplayDate(value) : "—";
}

export function DeskHeader({ title, subtitle, extra }: { title: string; subtitle: string; extra?: ReactNode }) {
  return <PageHeader title={title} subtitle={subtitle} actions={extra} />;
}

export function Stats({ items }: { items: Array<{ value: number; label: string; tone?: "pri" | "amber" | "ruby" }> }) {
  return (
    <div className={cn("grid gap-3", items.length === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-card border border-hairline border-l-4 bg-surface px-3.5 py-3",
            item.tone === "ruby" ? "border-l-ruby" : item.tone === "amber" ? "border-l-amber" : "border-l-pri",
          )}
        >
          <b className="mb-1 block font-serif text-[40px] font-semibold leading-none text-ink">{item.value}</b>
          <span className="text-[13px] text-ink-2">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-4">
      {title ? <h2 className="mb-3 text-[15px] font-semibold text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

export function DeskTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[15px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b-2 border-hairline px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-2", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-hairline px-2.5 py-2 align-top", className)}>{children}</td>;
}

export function ReminderTag({ item }: { item: DeskReminder | null }) {
  if (!item) return <span className="text-[13px] text-ink-2">No reminder yet</span>;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[12px]",
        item.lvl === "bad" ? "bg-ruby-bg text-ruby" : item.lvl === "warn" ? "bg-amber-bg text-amber" : "bg-stone-bg text-stone",
      )}
    >
      Reminder {item.n}, {item.lab}: {item.to}
    </span>
  );
}

export function StatusPill({ value }: { value: string }) {
  const tone = value === "Closed" || value === "Accepted" || value === "Yes" || value === "Acknowledged" ? "emerald" : value === "Delayed" || value === "No" || value === "Refusal" ? "ruby" : value === "Pending" ? "amber" : "stone";
  return <Pill tone={tone}>{value || "—"}</Pill>;
}

export function DaysTag({ days }: { days: number | null }) {
  if (days == null) return null;
  if (days < 0) return <span className="text-[12px] text-ruby">Expired {Math.abs(days)}d ago</span>;
  return <span className="text-[12px] text-amber">{days}d left</span>;
}

export function DeskEmpty({ loading, error, empty, children }: { loading: boolean; error: boolean; empty: boolean; children: ReactNode }) {
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <p className="text-sm text-ruby">Could not load this desk.</p>;
  if (empty) return <p className="text-sm text-ink-2">Nothing on this desk yet. Import the Excel sheet from Admin.</p>;
  return <>{children}</>;
}

export async function requestOtp(datasetId: string, rowId: string, purpose: "pms_close" | "pms_delay" | "amc_update"): Promise<RowOtp> {
  return api<RowOtp>(`/api/datasets/${datasetId}/rows/${rowId}/otp`, { method: "POST", body: { purpose } });
}

function OtpBox({ otp, code, onCode }: { otp: RowOtp | null; code: string; onCode: (value: string) => void }) {
  if (!otp) return null;
  if (!otp.otpRequired) return <p className="text-[13px] text-ink-2">No customer mail or mobile on this row, so OTP is not required.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] text-ink-2">
        OTP {otp.previewCode ? otp.previewCode : ""} sent to the customer{otp.sentTo ? ` (${otp.sentTo})` : ""}.
      </p>
      <Label htmlFor="customer-otp">Customer OTP</Label>
      <Input id="customer-otp" inputMode="numeric" maxLength={4} value={code} onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 4))} />
    </div>
  );
}

export function DelayDialog({
  open,
  datasetId,
  contract,
  pm,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  contract: DeskContract | null;
  pm: DeskPm | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>(DELAY_REASONS[0]);
  const [remarks, setRemarks] = useState("");
  const [date, setDate] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<RowOtp | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !contract || !pm) return;
    setReason(DELAY_REASONS[0]);
    setRemarks("");
    setDate(pm.plan || pm.date);
    setCode("");
    setOtp(null);
  }, [open, contract, pm]);

  useEffect(() => {
    if (!open || !contract || reason !== "Customer Not Available") {
      setOtp(null);
      return;
    }
    void requestOtp(datasetId, contract.rowId, "pms_delay")
      .then(setOtp)
      .catch((error: unknown) => {
        if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not send the customer OTP."));
      });
  }, [open, contract, datasetId, reason]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contract || !pm) return;
    setPending(true);
    try {
      await rowAction(datasetId, contract.rowId, "/actions/pms", {
        action: "reschedule",
        n: pm.n,
        date,
        reason,
        remarks,
        challengeId: otp?.challengeId,
        code: otp?.otpRequired ? code : undefined,
      });
      onClose();
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not delay this visit."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Delay this PM</DialogTitle>
            <DialogDescription>
              {contract ? `${contract.customer} · ${contract.equip}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-2">
            {otp?.previewCode ? <p className="text-[13px] text-ink-2">Demo: OTP {otp.previewCode} sent to the customer.</p> : null}
            <Field label="Reason">
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_REASONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Remarks">
              <Input value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </Field>
            <Field label="Date of visit planned to close it">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            {reason === "Customer Not Available" ? <OtpBox otp={otp} code={code} onCode={setCode} /> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || (reason === "Customer Not Available" && otp?.otpRequired === true && code.length !== 4)}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CloseDialog({
  open,
  datasetId,
  contract,
  pm,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  contract: DeskContract | null;
  pm: DeskPm | null;
  onClose: () => void;
}) {
  const [report, setReport] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<RowOtp | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !contract) return;
    setReport("");
    setCode("");
    setOtp(null);
    void requestOtp(datasetId, contract.rowId, "pms_close")
      .then(setOtp)
      .catch((error: unknown) => {
        if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not send the customer OTP."));
      });
  }, [open, contract, datasetId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contract || !pm) return;
    setPending(true);
    try {
      await rowAction(datasetId, contract.rowId, "/actions/pms", {
        action: "markDone",
        n: pm.n,
        report,
        challengeId: otp?.challengeId,
        code: otp?.otpRequired ? code : undefined,
      });
      onClose();
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not close this visit."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Close this PM</DialogTitle>
            <DialogDescription>{contract ? `${contract.customer} · ${contract.equip}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-2">
            {otp?.previewCode ? <p className="text-[13px] text-ink-2">Demo: OTP {otp.previewCode} sent to the customer.</p> : null}
            <Field label="Service report (file name)">
              <Input value={report} onChange={(event) => setReport(event.target.value)} required />
            </Field>
            <OtpBox otp={otp} code={code} onCode={setCode} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || (otp?.otpRequired === true && code.length !== 4)}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AmcDialog({
  open,
  datasetId,
  contract,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  contract: DeskContract | null;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<string>("Pending");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [date, setDate] = useState("");
  const [doc, setDoc] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<RowOtp | null>(null);
  const [pending, setPending] = useState(false);
  const needsOtp = outcome === "Accepted" || reason === "Customer Not Available" || reason === "Customer Not Agreed";

  useEffect(() => {
    if (!open || !contract) return;
    setOutcome(contract.amc.state || "Pending");
    setReason("");
    setRemarks(contract.amc.remark);
    setDate(contract.amc.date);
    setDoc(contract.amc.doc);
    setCode("");
    setOtp(null);
  }, [open, contract]);

  useEffect(() => {
    if (!open || !contract || !needsOtp) {
      setOtp(null);
      return;
    }
    void requestOtp(datasetId, contract.rowId, "amc_update")
      .then(setOtp)
      .catch((error: unknown) => {
        if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not send the customer OTP."));
      });
  }, [open, contract, datasetId, needsOtp]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contract) return;
    setPending(true);
    try {
      const action = outcome === "Accepted" ? "acknowledge" : outcome === "Refusal" ? "decline" : outcome === "Delayed" ? "delay" : "pending";
      await rowAction(datasetId, contract.rowId, "/actions/amc", {
        action,
        reason,
        note: remarks,
        chequeDate: date || undefined,
        document: doc || undefined,
        challengeId: otp?.challengeId,
        code: otp?.otpRequired ? code : undefined,
      });
      onClose();
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not save the AMC follow-up."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>AMC follow-up{contract ? `: ${contract.customer}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-2">
            {otp?.previewCode ? <p className="text-[13px] text-ink-2">Demo: OTP {otp.previewCode} sent to the customer.</p> : null}
            <Field label="Outcome">
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AMC_OUTCOMES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reason (for delayed or refusal)">
              <Select value={reason || "none"} onValueChange={(value) => setReason(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {AMC_REASONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Remarks or feedback">
              <Input value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </Field>
            <Field label="Date of receiving the AMC cheque">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="AMC document and cheque (file name)">
              <Input value={doc} onChange={(event) => setDoc(event.target.value)} />
            </Field>
            {needsOtp ? <OtpBox otp={otp} code={code} onCode={setCode} /> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || (needsOtp && otp?.otpRequired === true && code.length !== 4)}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ValidateDialog({
  open,
  datasetId,
  contract,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  contract: DeskContract | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [result, setResult] = useState("Yes");
  const [due, setDue] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !contract) return;
    setResult(contract.valid === "Yes" ? "Yes" : "No");
    setDue(contract.vdue);
  }, [open, contract]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contract) return;
    setPending(true);
    try {
      await rowAction(datasetId, contract.rowId, "/actions/validate", {
        result,
        reason: result === "No" ? "Data needs another pass before it can be used on the desks." : undefined,
        expectedDate: result === "No" ? due : undefined,
      });
      onClose();
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not validate."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Validate data</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-2">
            <Field label="Validated">
              <Select value={result} onValueChange={setResult}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Validated by">
              <Input value={user.name} readOnly />
            </Field>
            {result === "No" ? (
              <Field label="By when data will be validated">
                <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} required />
              </Field>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddContractDialog({
  open,
  datasetId,
  onClose,
}: {
  open: boolean;
  datasetId: string;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    customer_name: "",
    city: "",
    contact_person: "",
    mobile: "",
    email: "",
    location: "",
    contract_type: "Warranty",
    equipment: "",
    serial: "",
    start_date: "",
    end_date: "",
    engineer: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        customer_name: "",
        city: "",
        contact_person: "",
        mobile: "",
        email: "",
        location: "",
        contract_type: "Warranty",
        equipment: "",
        serial: "",
        start_date: "",
        end_date: "",
        engineer: "",
      });
    }
  }, [open]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const detail = await api<{ dataset: DatasetDetail }>(`/api/datasets/${datasetId}`);
      const created = await api<{ row: { id: string; version: number } }>(`/api/datasets/${datasetId}/rows`, {
        method: "POST",
        body: { atEnd: true },
      });
      const changes: Record<string, string> = {};
      for (const [semantic, value] of Object.entries(form)) {
        if (!value) continue;
        const column = detail.dataset.schema.columns.find(
          (item: DatasetColumn) => item.semantic === semantic || item.key === semantic,
        );
        if (column) changes[column.key] = value;
      }
      if (Object.keys(changes).length > 0) {
        await api(`/api/datasets/${datasetId}/rows/${created.row.id}`, {
          method: "PATCH",
          body: { version: created.row.version, changes },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["desk", datasetId] });
      await queryClient.invalidateQueries({ queryKey: ["dataset-rows", datasetId] });
      toast.success("Contract added.");
      onClose();
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not add the contract."));
    } finally {
      setPending(false);
    }
  }

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="md:max-h-[90vh]">
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>Add contract</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-2">
            <Field label="Customer name">
              <Input value={form.customer_name} onChange={(event) => set("customer_name", event.target.value)} required />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(event) => set("city", event.target.value)} />
            </Field>
            <Field label="Contact person">
              <Input value={form.contact_person} onChange={(event) => set("contact_person", event.target.value)} />
            </Field>
            <Field label="Mobile no">
              <Input value={form.mobile} onChange={(event) => set("mobile", event.target.value)} />
            </Field>
            <Field label="Mail">
              <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
            </Field>
            <Field label="Location">
              <Input value={form.location} onChange={(event) => set("location", event.target.value)} />
            </Field>
            <Field label="Contract type">
              <Select value={form.contract_type} onValueChange={(value) => set("contract_type", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Equipment name">
              <Input value={form.equipment} onChange={(event) => set("equipment", event.target.value)} />
            </Field>
            <Field label="Serial no">
              <Input value={form.serial} onChange={(event) => set("serial", event.target.value)} />
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={form.end_date} onChange={(event) => set("end_date", event.target.value)} />
            </Field>
            <Field label="Engineer">
              <Input value={form.engineer} onChange={(event) => set("engineer", event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
