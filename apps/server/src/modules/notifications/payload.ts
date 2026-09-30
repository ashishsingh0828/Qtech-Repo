import type { Role } from "@app/shared";
import type { Prisma } from "@prisma/client";

export type FieldChange = {
  key: string;
  groupKey: string;
  label: string;
};

export type OutboxBody = {
  kind: string;
  datasetId?: string;
  datasetName?: string;
  rowId?: string;
  actorId: string;
  actorName: string;
  actorRole?: Role;
  fields?: FieldChange[];
  action?: string;
  validateResult?: "Yes" | "No" | "Clear";
  reason?: string;
  note?: string;
  verifiedOk?: boolean;
  amcAction?: string;
  callEvent?: "opened" | "resolved";
  newValidatorId?: string | null;
  newServiceId?: string | null;
  newRows?: number;
  updatedRows?: number;
  summary?: string;
  count?: number;
  roles?: string[];
  audience?: "all" | "managers";
};

export function toJson(body: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
}

export function structurePhrase(action: string, datasetName?: string): string {
  if (action === "dataset.deleted") return `Dataset ${datasetName || "dataset"} was deleted`;
  if (action === "dataset.restored") return `Dataset ${datasetName || "dataset"} was restored`;
  if (action === "dataset.purged") return `Dataset ${datasetName || "dataset"} was permanently deleted`;
  const phrases: Record<string, string> = {
    "column.created": "added a column",
    "column.updated": "updated a column",
    "column.moved": "moved a column",
    "column.deleted": "deleted a column",
    "column.restored": "restored a column",
    "column.purged": "permanently deleted a column",
    "group.created": "added a group",
    "group.updated": "updated a group",
    "group.moved": "moved a group",
    "group.deleted": "deleted a group",
    "group.restored": "restored a group",
    "group.purged": "permanently deleted a group",
    "row.created": "added a record",
    "row.duplicated": "duplicated a record",
    "row.deleted": "deleted a record",
    "row.restored": "restored a record",
    "row.purged": "permanently deleted a record",
  };
  return phrases[action] ?? "updated the dataset";
}

export function readBody(value: Prisma.JsonValue): OutboxBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const actorId = value.actorId;
  const actorName = value.actorName;
  const kind = value.kind;
  if (typeof kind !== "string" || typeof actorId !== "string" || typeof actorName !== "string") return null;
  return {
    kind,
    datasetId: text(value.datasetId),
    datasetName: text(value.datasetName),
    rowId: text(value.rowId),
    actorId,
    actorName,
    actorRole: role(value.actorRole),
    fields: readFields(value.fields),
    action: text(value.action),
    validateResult: validateResult(value.validateResult),
    reason: text(value.reason),
    note: text(value.note),
    verifiedOk: typeof value.verifiedOk === "boolean" ? value.verifiedOk : undefined,
    amcAction: text(value.amcAction),
    callEvent: value.callEvent === "opened" || value.callEvent === "resolved" ? value.callEvent : undefined,
    newValidatorId: textOrNull(value.newValidatorId),
    newServiceId: textOrNull(value.newServiceId),
    newRows: number(value.newRows),
    updatedRows: number(value.updatedRows),
    summary: text(value.summary),
    count: number(value.count),
    roles: stringList(value.roles),
    audience: value.audience === "all" || value.audience === "managers" ? value.audience : undefined,
  };
}

export function readFields(value: unknown): FieldChange[] {
  if (!Array.isArray(value)) return [];
  const fields: FieldChange[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const key = item.key;
    const label = item.label;
    if (typeof key !== "string" || typeof label !== "string") continue;
    fields.push({
      key,
      label,
      groupKey: typeof item.groupKey === "string" ? item.groupKey : "",
    });
  }
  return fields;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return text(value);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function role(value: unknown): Role | undefined {
  if (value === "admin" || value === "manager" || value === "validator" || value === "service") return value;
  return undefined;
}

function validateResult(value: unknown): "Yes" | "No" | "Clear" | undefined {
  if (value === "Yes" || value === "No" || value === "Clear") return value;
  return undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}
