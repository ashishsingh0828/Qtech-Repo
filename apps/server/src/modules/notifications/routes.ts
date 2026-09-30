import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth } from "../../middleware/auth";
import { listNotificationsSchema, readNotificationSchema } from "./schema";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "./service";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/",
  validate(listNotificationsSchema),
  asyncHandler(async (req, res) => {
    const { query } = validated<typeof listNotificationsSchema._output>(req);
    const result = await listNotifications(currentUser(req), query);
    res.status(200).json(result);
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead(currentUser(req));
    res.status(200).json({ ok: true });
  }),
);

notificationsRouter.post(
  "/:id/read",
  validate(readNotificationSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof readNotificationSchema._output>(req);
    await markNotificationRead(currentUser(req), params.id);
    res.status(200).json({ ok: true });
  }),
);
