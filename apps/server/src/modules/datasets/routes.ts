import { MAX_UPLOAD_MB } from "@app/shared";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../lib/asyncHandler";
import { AppError } from "../../lib/errors";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth, requireCapability } from "../../middleware/auth";
import { exportDatasetSchema, listDatasetsSchema } from "./schema";
import { exportDataset, importDataset, listDatasets } from "./service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

export const datasetsRouter = Router();

datasetsRouter.use(requireAuth);

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
    if (!file) throw new AppError("VALIDATION", 400, "Choose an .xlsx file.");
    const dataset = await importDataset(currentUser(req), {
      originalname: file.originalname,
      buffer: file.buffer,
    });
    res.status(201).json({ dataset });
  }),
);

datasetsRouter.get(
  "/:id/export",
  validate(exportDatasetSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof exportDatasetSchema._output>(req);
    const result = await exportDataset(currentUser(req), params.id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(result.filename));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(result.body);
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

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
