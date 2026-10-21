import type { DatasetColumn, DatasetSchema, PublicUser } from "@app/shared";
import { calendarDaysBetween, parseDatasetSchema, todayInTimeZone } from "@app/shared";
import { env } from "../../env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

const LAD = [-45, -30, -20, -15, -10, -7, -5, -3, -2, -1, 0, 0, 1, 2, 3, 4, 5, 6, 7];
const SUP = new Set([-30, -20, -15, -10]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type DeskReminder = {
  n: number;
  lab: string;
  to: string;
  lvl: "" | "warn" | "bad";
};

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

export async function deskBoard(_actor: PublicUser, datasetId: string): Promise<DeskBoard> {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, deletedAt: null },
    select: { schema: true },
  });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  const today = todayInTimeZone(env.APP_TIMEZONE);
  const rows = await prisma.row.findMany({
    where: { datasetId, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, version: true, data: true, assignedServiceId: true },
  });
  const engineers = await prisma.user.findMany({
    where: { active: true, role: "service" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return {
    today,
    engineers,
    contracts: rows.map((row) => toContract(jsonRecord(row.data), schema, row, today)),
  };
}

function toContract(
  data: Record<string, unknown>,
  schema: DatasetSchema,
  row: { id: string; version: number; assignedServiceId: string | null },
  today: string,
): DeskContract {
  const cols = schema.columns;
  const start = iso(pick(data, cols, "start_date", /start/i));
  const end = iso(pick(data, cols, "end_date", /^end/i));
  const valid = pick(data, cols, "validated", /validated$/i);
  const ack = pick(data, cols, "amc_status", /amc status/i);
  const note = pick(data, cols, "ack_note", /ack note|remarks/i);
  const amcState = amcOutcome(ack, end, today);
  const pms: DeskPm[] = [];
  for (let n = 1; n <= 15; n += 1) {
    const date = iso(pick(data, cols, `pms:${n}`, n === 1 ? /^pms?\s*1?$/i : new RegExp(`^pms?\\s*${n}$`, "i")));
    if (!date) continue;
    const done = iso(pick(data, cols, `pm_date:${n}`, n === 1 ? /^pm\s*date/i : new RegExp(`^pm\\s*date\\s*${n}$`, "i")));
    const stored = pick(data, cols, `pm_state:${n}`);
    const ackAt = pick(data, cols, `pm_ack:${n}`);
    const state = done ? "Closed" : stored === "Delayed" || stored === "Acknowledged" ? stored : ackAt ? "Acknowledged" : "Scheduled";
    pms.push({
      n,
      date,
      done,
      state,
      ack: Boolean(ackAt) || state === "Acknowledged" || state === "Closed",
      reason: pick(data, cols, `pm_reason:${n}`),
      plan: iso(pick(data, cols, `pm_plan:${n}`)) || date,
      reminder: state === "Closed" ? null : reminder(date, Boolean(ackAt) || state === "Acknowledged", "pm", today),
    });
  }
  return {
    rowId: row.id,
    version: row.version,
    customer: pick(data, cols, "customer_name", /customer/i) || pick(data, cols, "email", /mail/i),
    city: pick(data, cols, "city", /^city$/i),
    contact: pick(data, cols, "contact_person", /contact/i),
    mobile: pick(data, cols, "mobile", /mobile|phone/i),
    mail: pick(data, cols, "email", /mail/i),
    loc: pick(data, cols, "location", /location|address/i),
    type: pick(data, cols, "contract_type", /contract type/i),
    equip: pick(data, cols, "equipment", /euipment|equipment|instrument|model/i),
    serial: pick(data, cols, "serial", /serial/i),
    start,
    end,
    valid: valid || "No",
    vby: pick(data, cols, "validated_by", /validated by/i),
    vdue: iso(pick(data, cols, "validation_due", /validation due/i)),
    eng: pick(data, cols, "engineer", /^engineer$/i),
    serviceId: row.assignedServiceId,
    daysLeft: end ? calendarDaysBetween(today, end) : null,
    amc: {
      state: amcState,
      reason: note,
      remark: note,
      date: iso(pick(data, cols, "cheque_date", /cheque/i)),
      doc: pick(data, cols, "amc_document", /amc document/i),
      reminder: amcState === "Accepted" || amcState === "Refusal" || !end ? null : reminder(end, false, "amc", today),
    },
    pms,
  };
}

function amcOutcome(status: string, end: string, today: string): string {
  if (/ack/i.test(status)) return "Accepted";
  if (/declin|refus/i.test(status)) return "Refusal";
  if (/proposal/i.test(status)) return "Delayed";
  if (end && calendarDaysBetween(today, end) <= 45) return "Pending";
  return "";
}

function reminder(date: string, ack: boolean, kind: "pm" | "amc", today: string): DeskReminder | null {
  const late = calendarDaysBetween(date, today);
  let last: number | null = null;
  let idx = 0;
  LAD.forEach((offset, index) => {
    if (offset <= late && !(ack && SUP.has(offset))) {
      last = offset;
      idx = index + 1;
    }
  });
  if (last === null) return null;
  const lab = last < 0 ? `${-last}d before` : last === 0 ? "due date" : `${last}d after`;
  const to = last >= 7 ? "HOD" : last >= 1 && last <= 5 ? "Sr. Engineer / Manager" : kind === "amc" ? "Customer and Engineer" : "Engineer";
  const lvl: DeskReminder["lvl"] = last >= 7 ? "bad" : last >= 1 ? "warn" : "";
  return { n: idx, lab, to, lvl };
}

function pick(data: Record<string, unknown>, columns: readonly DatasetColumn[], semantic: string, label?: RegExp): string {
  const column = columns.find((item) => item.deletedAt == null && (item.semantic === semantic || item.key === semantic));
  const direct = stringify(column ? data[column.key] : data[semantic]);
  if (direct && direct !== "NA") return direct;
  if (!label) return "";
  const byLabel = columns.find((item) => item.deletedAt == null && label.test(item.label));
  const value = stringify(byLabel ? data[byLabel.key] : undefined);
  return value === "NA" ? "" : value;
}

function iso(value: string): string {
  return ISO.test(value) ? value : "";
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
