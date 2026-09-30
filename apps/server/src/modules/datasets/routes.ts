import { MAX_UPLOAD_MB } from "@app/shared";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../lib/asyncHandler";
import { AppError } from "../../lib/errors";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth, requireCapability } from "../../middleware/auth";
import { confirmMerge, previewMerge, rejectMergePreview } from "./merge";
import { releaseUpload } from "../../lib/uploads";
import {
  cellHistory,
  createRow,
  deleteRow,
  duplicateRow,
  getDatasetDetail,
  listRows,
  recentEdits,
  restoreRow,
  updateRow,
} from "./rows";
import {
  addColumnSchema,
  addGroupSchema,
  columnParamsSchema,
  createRowSchema,
  datasetParamsSchema,
  exportDatasetSchema,
  exportRowsSchema,
  groupParamsSchema,
  historySchema,
  importConfirmSchema,
  importPreviewSchema,
  listDatasetsSchema,
  listRowsSchema,
  moveColumnSchema,
  moveGroupSchema,
  patchColumnSchema,
  patchGroupSchema,
  rowParamsSchema,
  updateRowSchema,
} from "./schema";
import { exportDataset, importDataset, listDatasets } from "./service";
import { workflowRouter } from "../workflows/routes";
import {
  addColumn,
  addGroup,
  deleteColumn,
  deleteGroup,
  moveColumn,
  moveGroup,
  restoreColumn,
  restoreGroup,
  softDeleteDataset,
  updateColumn,
  updateGroup,
} from "./structure";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

export const datasetsRouter = Router();

datasetsRouter.use(requireAuth);
datasetsRouter.use(workflowRouter);

datasetsRouter.get(
  "/",
  validate(listDatasetsSchema),
  asyncHandler(async (_req, res) => {
    const datasets = await listDatasets();
    res.status(200).json({ datasets });
  }),
);

datasetsRouter.post(
  "/import",
  requireCapability("importData"),
  receiveUpload,
  asyncHandler(async (req, res) => {
    const file = req.file;
    try {
      if (!file) throw new AppError("VALIDATION", 400, "Choose an .xlsx file.");
      const dataset = await importDataset(currentUser(req), {
        originalname: file.originalname,
        buffer: file.buffer,
      });
      res.status(201).json({ dataset });
    } finally {
      releaseUpload(file);
    }
  }),
);

datasetsRouter.get(
  "/:id/export",
  validate(exportDatasetSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof exportDatasetSchema._output>(req);
    const result = await exportDataset(currentUser(req), params.id);
    sendWorkbook(res, result);
  }),
);

datasetsRouter.post(
  "/:id/export",
  validate(exportRowsSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof exportRowsSchema._output>(req);
    const result = await exportDataset(currentUser(req), params.id, body.rowIds);
    sendWorkbook(res, result);
  }),
);

datasetsRouter.get(
  "/:id/rows",
  validate(listRowsSchema),
  asyncHandler(async (req, res) => {
    const { params, query } = validated<typeof listRowsSchema._output>(req);
    const result = await listRows(currentUser(req), params.id, query);
    res.status(200).json(result);
  }),
);

datasetsRouter.post(
  "/:id/rows",
  requireCapability("manageRows"),
  validate(createRowSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof createRowSchema._output>(req);
    const result = await createRow(currentUser(req), params.id, body);
    res.status(201).json(result);
  }),
);

datasetsRouter.patch(
  "/:id/rows/:rowId",
  validate(updateRowSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof updateRowSchema._output>(req);
    const row = await updateRow(currentUser(req), params.id, params.rowId, body.version, body.changes);
    res.status(200).json({ row });
  }),
);

datasetsRouter.post(
  "/:id/rows/:rowId/duplicate",
  requireCapability("manageRows"),
  validate(rowParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof rowParamsSchema._output>(req);
    const result = await duplicateRow(currentUser(req), params.id, params.rowId);
    res.status(201).json(result);
  }),
);

datasetsRouter.delete(
  "/:id/rows/:rowId",
  requireCapability("manageRows"),
  validate(rowParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof rowParamsSchema._output>(req);
    const result = await deleteRow(currentUser(req), params.id, params.rowId);
    res.status(200).json(result);
  }),
);

datasetsRouter.post(
  "/:id/rows/:rowId/restore",
  requireCapability("manageRows"),
  validate(rowParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof rowParamsSchema._output>(req);
    const result = await restoreRow(currentUser(req), params.id, params.rowId);
    res.status(200).json(result);
  }),
);

datasetsRouter.get(
  "/:id/rows/:rowId/history",
  validate(historySchema),
  asyncHandler(async (req, res) => {
    const { params, query } = validated<typeof historySchema._output>(req);
    const history = await cellHistory(currentUser(req), params.id, params.rowId, query.columnKey);
    res.status(200).json(history);
  }),
);

datasetsRouter.get(
  "/:id/recent-edits",
  validate(datasetParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof datasetParamsSchema._output>(req);
    const edits = await recentEdits(currentUser(req), params.id);
    res.status(200).json(edits);
  }),
);

datasetsRouter.post(
  "/:id/columns",
  requireCapability("manageStructure"),
  validate(addColumnSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof addColumnSchema._output>(req);
    const schema = await addColumn(currentUser(req), params.id, body);
    res.status(201).json({ schema });
  }),
);

datasetsRouter.patch(
  "/:id/columns/:key",
  requireCapability("manageStructure"),
  validate(patchColumnSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof patchColumnSchema._output>(req);
    const schema = await updateColumn(currentUser(req), params.id, params.key, body);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/columns/:key/move",
  requireCapability("manageStructure"),
  validate(moveColumnSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof moveColumnSchema._output>(req);
    const schema = await moveColumn(currentUser(req), params.id, params.key, body);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.delete(
  "/:id/columns/:key",
  requireCapability("manageStructure"),
  validate(columnParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof columnParamsSchema._output>(req);
    const schema = await deleteColumn(currentUser(req), params.id, params.key);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/columns/:key/restore",
  requireCapability("manageStructure"),
  validate(columnParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof columnParamsSchema._output>(req);
    const schema = await restoreColumn(currentUser(req), params.id, params.key);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/groups",
  requireCapability("manageStructure"),
  validate(addGroupSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof addGroupSchema._output>(req);
    const schema = await addGroup(currentUser(req), params.id, body.label);
    res.status(201).json({ schema });
  }),
);

datasetsRouter.patch(
  "/:id/groups/:groupId",
  requireCapability("manageStructure"),
  validate(patchGroupSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof patchGroupSchema._output>(req);
    const schema = await updateGroup(currentUser(req), params.id, params.groupId, body);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/groups/:groupId/move",
  requireCapability("manageStructure"),
  validate(moveGroupSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof moveGroupSchema._output>(req);
    const schema = await moveGroup(currentUser(req), params.id, params.groupId, body);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.delete(
  "/:id/groups/:groupId",
  requireCapability("manageStructure"),
  validate(groupParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof groupParamsSchema._output>(req);
    const schema = await deleteGroup(currentUser(req), params.id, params.groupId);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/groups/:groupId/restore",
  requireCapability("manageStructure"),
  validate(groupParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof groupParamsSchema._output>(req);
    const schema = await restoreGroup(currentUser(req), params.id, params.groupId);
    res.status(200).json({ schema });
  }),
);

datasetsRouter.post(
  "/:id/import/preview",
  requireCapability("importData"),
  receiveUpload,
  validate(importPreviewSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof importPreviewSchema._output>(req);
    const file = req.file;
    try {
      if (!file) throw new AppError("VALIDATION", 400, "Choose an .xlsx file.");
      const preview = await previewMerge(currentUser(req), params.id, {
        originalname: file.originalname,
        buffer: file.buffer,
      });
      res.status(200).json(preview);
    } finally {
      releaseUpload(file);
    }
  }),
);

datasetsRouter.post(
  "/:id/import/confirm",
  requireCapability("importData"),
  validate(importConfirmSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof importConfirmSchema._output>(req);
    try {
      const result = await confirmMerge(currentUser(req), params.id, body.token);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError && error.status === 400) rejectMergePreview(body.token);
      throw error;
    }
  }),
);

datasetsRouter.delete(
  "/:id",
  requireCapability("deleteDataset"),
  validate(datasetParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof datasetParamsSchema._output>(req);
    await softDeleteDataset(currentUser(req), params.id);
    res.status(200).json({ ok: true });
  }),
);

datasetsRouter.get(
  "/:id",
  validate(datasetParamsSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof datasetParamsSchema._output>(req);
    const dataset = await getDatasetDetail(currentUser(req), params.id);
    res.status(200).json({ dataset });
  }),
);

function receiveUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (isRecord(error) && error.code === "LIMIT_FILE_SIZE") {
      next(new AppError("PAYLOAD_TOO_LARGE", 413, `File is larger than ${MAX_UPLOAD_MB} MB.`));
      return;
    }
    next(error);
  });
}

function sendWorkbook(res: Response, result: { filename: string; body: Buffer }): void {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", contentDisposition(result.filename));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(result.body);
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
