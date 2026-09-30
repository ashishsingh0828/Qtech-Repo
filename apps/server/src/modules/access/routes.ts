import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth, requireCapability } from "../../middleware/auth";
import { getAccessSchema, putAccessSchema } from "./schema";
import { getAccessMatrix, replaceAccess } from "./service";

export const accessRouter = Router();

accessRouter.use(requireAuth, requireCapability("manageAccess"));

accessRouter.get(
  "/",
  validate(getAccessSchema),
  asyncHandler(async (_req, res) => {
    const matrix = await getAccessMatrix();
    res.status(200).json(matrix);
  }),
);

accessRouter.put(
  "/",
  validate(putAccessSchema),
  asyncHandler(async (req, res) => {
    const { body } = validated<typeof putAccessSchema._output>(req);
    const matrix = await replaceAccess(currentUser(req), body.rows);
    res.status(200).json(matrix);
  }),
);
