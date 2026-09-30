import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth } from "../../middleware/auth";
import { activityListSchema, cardsSchema, kpisSchema, searchSchema, workloadSchema } from "./schema";
import { assertLead, datasetBoards, listFeed, roleKpis, searchHub, teamWorkload, workCards } from "./service";

export const metricsRouter = Router();

metricsRouter.use(requireAuth);

metricsRouter.get(
  "/kpis",
  validate(kpisSchema),
  asyncHandler(async (req, res) => {
    const { query } = validated<typeof kpisSchema._output>(req);
    const result = await roleKpis(currentUser(req), query.datasetId);
    res.status(200).json(result);
  }),
);

export const teamRouter = Router();

teamRouter.use(requireAuth);

teamRouter.get(
  "/workload",
  validate(workloadSchema),
  asyncHandler(async (req, res) => {
    assertLead(currentUser(req));
    const { query } = validated<typeof workloadSchema._output>(req);
    const result = await teamWorkload(query.datasetId);
    res.status(200).json(result);
  }),
);

export const activityRouter = Router();

activityRouter.use(requireAuth);

activityRouter.get(
  "/",
  validate(activityListSchema),
  asyncHandler(async (req, res) => {
    assertLead(currentUser(req));
    const { query } = validated<typeof activityListSchema._output>(req);
    const result = await listFeed(query);
    res.status(200).json(result);
  }),
);

export const searchRouter = Router();

searchRouter.use(requireAuth);

searchRouter.get(
  "/",
  validate(searchSchema),
  asyncHandler(async (req, res) => {
    const { query } = validated<typeof searchSchema._output>(req);
    const result = await searchHub(currentUser(req), query.q ?? "");
    res.status(200).json(result);
  }),
);

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

workspaceRouter.get(
  "/cards",
  validate(cardsSchema),
  asyncHandler(async (req, res) => {
    const { query } = validated<typeof cardsSchema._output>(req);
    const result = await workCards(currentUser(req), query);
    res.status(200).json(result);
  }),
);

workspaceRouter.get(
  "/boards",
  asyncHandler(async (req, res) => {
    assertLead(currentUser(req));
    const boards = await datasetBoards();
    res.status(200).json({ boards });
  }),
);
