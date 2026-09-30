import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth, requireCapability } from "../../middleware/auth";
import { listTrashSchema, purgeTrashSchema, restoreTrashSchema } from "./schema";
import { listTrash, purgeTrash, restoreTrash } from "./service";

export const trashRouter = Router();

trashRouter.use(requireAuth, requireCapability("useTrash"));

trashRouter.get(
  "/",
  validate(listTrashSchema),
  asyncHandler(async (req, res) => {
    const { query } = validated<typeof listTrashSchema._output>(req);
    const items = await listTrash(query.type);
    res.status(200).json({ items });
  }),
);

trashRouter.post(
  "/restore",
  validate(restoreTrashSchema),
  asyncHandler(async (req, res) => {
    const { body } = validated<typeof restoreTrashSchema._output>(req);
    const result = await restoreTrash(currentUser(req), body);
    res.status(200).json(result);
  }),
);

trashRouter.delete(
  "/:kind/:id",
  requireCapability("purgeTrash"),
  validate(purgeTrashSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof purgeTrashSchema._output>(req);
    await purgeTrash(currentUser(req), params.kind, params.id);
    res.status(200).json({ ok: true });
  }),
);
