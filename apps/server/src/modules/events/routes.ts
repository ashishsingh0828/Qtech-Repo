import { Router } from "express";
import { currentUser, requireAuth } from "../../middleware/auth";
import { attachStream } from "./registry";

export const eventsRouter = Router();

eventsRouter.get("/", requireAuth, (req, res) => {
  attachStream(currentUser(req), req, res);
});
