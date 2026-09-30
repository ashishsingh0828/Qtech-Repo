import type { DatasetColumn, DatasetSchema, Permissions } from "@app/shared";
import { canViewGroup, normalizeGroupKey } from "@app/shared";
import { Workbook, type Cell } from "exceljs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function buildExportWorkbook(
  schema: DatasetSchema,
  rows: Array<{ data: unknown }>,
  groupAccess: Permissions["groupAccess"],
): Promise<Buffer> {
  const groups = schema.groups
    .filter((group) => group.deletedAt == null && canViewGroup(groupAccess, group.groupKey))
    .sort((left, right) => left.order - right.order);
  const visible = new Set(groups.map((group) => group.id));
  const columns = schema.columns
    .filter((column) => column.deletedAt == null && visible.has(column.groupId))
    .sort((left, right) => left.order - right.order);
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  let start = 0;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const next = columns[index + 1];
    if (!column || (next && next.groupId === column.groupId)) continue;
    const group = groupById.get(column.groupId);
    sheet.getCell(1, start + 1).value = group?.label ?? "General";
    if (index > start) sheet.mergeCells(1, start + 1, 1, index + 1);
    start = index + 1;
  }

  columns.forEach((column, index) => {
    const header = sheet.getCell(2, index + 1);
    header.value = column.label;
    sheet.getColumn(index + 1).width = Math.min(40, Math.max(12, column.label.length + 2));
  });

  rows.forEach((row, rowIndex) => {
    const data = isRecord(row.data) ? row.data : {};
    columns.forEach((column, index) => {
      writeCell(sheet.getCell(rowIndex + 3, index + 1), column, data[column.key]);
    });
  });

  const customerIndex = columns.findIndex(
    (column) =>
      column.key === "customer_name" ||
      column.semantic === "customer_name" ||
      normalizeGroupKey(column.label) === "customer_name",
  );
  sheet.views = [
    {
      state: "frozen",
      xSplit: customerIndex >= 0 ? customerIndex + 1 : 0,
      ySplit: 2,
    },
  ];

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function writeCell(cell: Cell, column: DatasetColumn, value: unknown): void {
  if (value == null || value === "") return;
  if (column.type === "date" && typeof value === "string" && ISO_DATE.test(value)) {
    cell.value = new Date(`${value}T00:00:00.000Z`);
    cell.numFmt = "yyyy-mm-dd";
    return;
  }
  if (column.type === "integer" && typeof value === "number") {
    cell.value = value;
    cell.numFmt = "0";
    return;
  }
  if (column.type === "decimal" && typeof value === "number") {
    cell.value = value;
    return;
  }
  if (column.type === "phone" || column.type === "text") {
    cell.value = typeof value === "string" ? value : String(value);
    cell.numFmt = "@";
    return;
  }
  if (typeof value === "number") {
    cell.value = value;
    return;
  }
  cell.value = typeof value === "string" ? value : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
