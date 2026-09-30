import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth, requireCapability } from "../../middleware/auth";
import { createUserSchema, listUsersSchema, resetPasswordSchema, updateUserSchema } from "./schema";
import { createUser, listUsers, resetUserPassword, updateUser } from "./service";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireCapability("manageUsers"));

usersRouter.get(
  "/",
  validate(listUsersSchema),
  asyncHandler(async (_req, res) => {
    const users = await listUsers();
    res.status(200).json({ users });
  }),
);

usersRouter.post(
  "/",
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const { body } = validated<typeof createUserSchema._output>(req);
    const user = await createUser(body);
    res.status(201).json({ user });
  }),
);

usersRouter.patch(
  "/:id",
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const { body, params } = validated<typeof updateUserSchema._output>(req);
    const user = await updateUser(currentUser(req).id, params.id, body);
    res.status(200).json({ user });
  }),
);

usersRouter.post(
  "/:id/reset-password",
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { body, params } = validated<typeof resetPasswordSchema._output>(req);
    await resetUserPassword(params.id, body.password);
    res.status(204).end();
  }),
);
