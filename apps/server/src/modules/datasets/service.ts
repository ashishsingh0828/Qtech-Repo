import { randomUUID } from "node:crypto";
import type { DatasetColumn, DatasetSummary, PublicUser } from "@app/shared";
import { cleanLabel, nextDuePmsDate, parseDatasetSchema } from "@app/shared";
import { Prisma } from "@prisma/client";
import { permissionsFor } from "../../lib/account";
import { AppError } from "../../lib/errors";
import { publishEvent } from "../../lib/events";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { buildExportWorkbook } from "./export";
import { parseWorkbook } from "./parse";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listDatasets(): Promise<DatasetSummary[]> {
  const datasets = await prisma.dataset.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
  return datasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    sourceFileName: dataset.sourceFileName,
    rowCount: dataset.rowCount,
    createdAt: dataset.createdAt.toISOString(),
    updatedAt: dataset.updatedAt.toISOString(),
    uploadedByName: dataset.uploadedBy.name,
  }));
}

export async function importDataset(actor: PublicUser, file: { originalname: string; buffer: Buffer }): Promise<DatasetSummary> {
  if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
    throw new AppError("VALIDATION", 400, "Please save the file as .xlsx");
  }
  let parsed: Awaited<ReturnType<typeof parseWorkbook>>;
  try {
    parsed = await parseWorkbook(file.buffer);
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ err: error }, "Failed to read workbook");
    throw new AppError("VALIDATION", 400, "The file could not be read. Please save it as .xlsx.");
  }

  const name = datasetName(file.originalname);
  const sourceFileName = file.originalname.replace(/^.*[/\\]/, "").slice(0, 300);
  const actionId = randomUUID();
  const datasetId = randomUUID();
  const schemaJson = parsed.schema as unknown as Prisma.InputJsonValue;

  await prisma.$transaction(
    async (tx) => {
      await tx.dataset.create({
        data: {
          id: datasetId,
          name,
          sourceFileName,
          schema: schemaJson,
          rowCount: parsed.rows.length,
          uploadedById: actor.id,
        },
      });
      for (let index = 0; index < parsed.rows.length; index += 500) {
        const slice = parsed.rows.slice(index, index + 500);
        await tx.row.createMany({
          data: slice.map((data, offset) => ({
            datasetId,
            position: index + offset + 1,
            data: data as Prisma.InputJsonValue,
            ...mirrorsFor(data, parsed.schema.columns),
            updatedById: actor.id,
            updatedByName: actor.name,
          })),
        });
      }
      await tx.activityLog.create({
        data: {
          datasetId,
          actorId: actor.id,
          actorName: actor.name,
          action: "dataset.imported",
          actionId,
          meta: {
            name,
            sourceFileName,
            rowCount: parsed.rows.length,
          },
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  try {
    publishEvent({ type: "dataset.imported", datasetId, actorId: actor.id, actionId });
  } catch (error) {
    logger.error({ err: error }, "Failed to publish dataset.imported");
  }

  const created = await prisma.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    include: { uploadedBy: { select: { name: true } } },
  });
  return {
    id: created.id,
    name: created.name,
    sourceFileName: created.sourceFileName,
    rowCount: created.rowCount,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    uploadedByName: created.uploadedBy.name,
  };
}

export async function exportDataset(actor: PublicUser, datasetId: string): Promise<{ filename: string; body: Buffer }> {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, deletedAt: null },
  });
  if (!dataset) throw new AppError("NOT_FOUND", 404, "Dataset not found.");
  const schema = parseDatasetSchema(dataset.schema);
  if (!schema) throw new AppError("INTERNAL", 500, "Dataset schema is invalid.");
  const permissions = await permissionsFor(actor.role);
  const rows = await prisma.row.findMany({
    where: { datasetId: dataset.id, deletedAt: null },
    orderBy: { position: "asc" },
    select: { data: true },
  });
  const body = await buildExportWorkbook(schema, rows, permissions.groupAccess);
  return { filename: exportFilename(dataset.name), body };
}

function datasetName(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "").replace(/\.xlsx$/i, "");
  const cleaned = cleanLabel(base);
  return cleaned.slice(0, 200) || "Dataset";
}

function exportFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || "dataset";
  return cleaned.toLowerCase().endsWith(".xlsx") ? cleaned : `${cleaned}.xlsx`;
}

function mirrorsFor(data: Record<string, string | number | boolean>, columns: DatasetColumn[]) {
  const dueSource: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(dueSource)) {
    if (key.startsWith("pm_date:") && value === "NA") delete dueSource[key];
  }
  return {
    validated: textOrNull(readSemantic(data, columns, "validated")),
    validationDue: dateOrNull(readSemantic(data, columns, "validation_due")),
    verified: textOrNull(readSemantic(data, columns, "verified")),
    endDate: dateOrNull(readSemantic(data, columns, "end_date")),
    amcStatus: textOrNull(readSemantic(data, columns, "amc_status")),
    nextFollowUp: dateOrNull(readSemantic(data, columns, "next_follow_up")),
    nextDuePms: dateOrNull(nextDuePmsDate(dueSource)),
  };
}

function readSemantic(
  data: Record<string, string | number | boolean>,
  columns: DatasetColumn[],
  semantic: string,
): unknown {
  const column = columns.find((item) => item.semantic === semantic || item.key === semantic);
  if (!column) return undefined;
  return data[column.key];
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  return new Date(`${value}T00:00:00.000Z`);
}
