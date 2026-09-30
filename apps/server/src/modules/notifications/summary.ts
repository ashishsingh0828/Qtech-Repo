import type { Permissions } from "@app/shared";
import { canViewGroup } from "@app/shared";
import type { Prisma } from "@prisma/client";
import { readFields } from "./payload";

export type NoticeParams = {
  template?: string;
  fields?: Array<{ key: string; groupKey: string; label: string }>;
  reason?: string;
  note?: string;
  datasetName?: string;
  newRows?: number;
  updatedRows?: number;
  summary?: string;
  link?: string;
  count?: number;
};

export function projectNotice(
  params: Prisma.JsonValue,
  permissions: Permissions,
): { summary: string; focusKeys: string[]; href: string | null } {
  const notice = readNotice(params);
  const visible = (notice.fields ?? []).filter((field) => field.groupKey === "" || canViewGroup(permissions.groupAccess, field.groupKey));
  const summary = summaryFor(notice, visible.map((field) => field.label));
  return {
    summary,
    focusKeys: visible.map((field) => field.key),
    href: notice.link ?? null,
  };
}

function summaryFor(notice: NoticeParams, labels: string[]): string {
  if (notice.template === "fields") {
    return labels.length > 0 ? `updated ${labels.join(", ")}` : "updated a record";
  }
  if (notice.template === "ready") return "Ready to verify";
  if (notice.template === "rejected") return notice.reason ? `Marked No: ${notice.reason}` : "Marked No";
  if (notice.template === "amc") return "New AMC lead";
  if (notice.template === "recheck") return notice.note ? `Needs recheck: ${notice.note}` : "Needs recheck";
  if (notice.template === "assigned") return notice.summary || "Assigned to you";
  if (notice.template === "call") return notice.summary || "updated a record";
  if (notice.template === "verified") return "Verified OK";
  if (notice.template === "import") {
    const name = notice.datasetName || "Dataset";
    return `Dataset ${name} updated: ${notice.newRows ?? 0} new, ${notice.updatedRows ?? 0} updated`;
  }
  if (notice.template === "access") return "Your access was updated";
  if (notice.summary) return notice.summary;
  if (labels.length > 0) return `updated ${labels.join(", ")}`;
  return "updated a record";
}

function readNotice(value: Prisma.JsonValue): NoticeParams {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return {
    template: typeof value.template === "string" ? value.template : undefined,
    fields: readFields(value.fields),
    reason: typeof value.reason === "string" ? value.reason : undefined,
    note: typeof value.note === "string" ? value.note : undefined,
    datasetName: typeof value.datasetName === "string" ? value.datasetName : undefined,
    newRows: typeof value.newRows === "number" ? value.newRows : undefined,
    updatedRows: typeof value.updatedRows === "number" ? value.updatedRows : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    link: typeof value.link === "string" ? value.link : undefined,
    count: typeof value.count === "number" ? value.count : undefined,
  };
}
