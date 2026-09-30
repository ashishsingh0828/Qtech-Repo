import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireCapability } from "../../middleware/auth";
import {
  activitySchema,
  amcActionSchema,
  assignActionSchema,
  bulkAssignSchema,
  bulkHistoricalSchema,
  bulkValidateSchema,
  bulkVerifySchema,
  callCreateSchema,
  callResolveSchema,
  callsListSchema,
  followupActionSchema,
  pmsActionSchema,
  summarySchema,
  undoSchema,
  validateActionSchema,
  verifyActionSchema,
} from "./schema";
import {
  bulkAssign,
  bulkValidate,
  bulkVerify,
  closeHistorical,
  datasetSummary,
  listActivity,
  listAssignees,
  listCalls,
  logCall,
  resolveCall,
  runAmc,
  runAssign,
  runFollowup,
  runPms,
  runValidate,
  runVerify,
  undoAction,
} from "./service";

export const workflowRouter = Router();

workflowRouter.get(
  "/:id/summary",
  validate(summarySchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof summarySchema._output>(req);
    const summary = await datasetSummary(currentUser(req), params.id);
    res.status(200).json(summary);
  }),
);

workflowRouter.get(
  "/:id/assignees",
  requireCapability("assign"),
  validate(summarySchema),
  asyncHandler(async (_req, res) => {
    const users = await listAssignees();
    res.status(200).json({ users });
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/validate",
  validate(validateActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof validateActionSchema._output>(req);
    const result = await runValidate(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/verify",
  validate(verifyActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof verifyActionSchema._output>(req);
    const result = await runVerify(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/amc",
  validate(amcActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof amcActionSchema._output>(req);
    const result = await runAmc(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/pms",
  validate(pmsActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof pmsActionSchema._output>(req);
    const result = await runPms(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/followup",
  validate(followupActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof followupActionSchema._output>(req);
    const result = await runFollowup(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/actions/assign",
  validate(assignActionSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof assignActionSchema._output>(req);
    const result = await runAssign(currentUser(req), params.id, params.rowId, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/undo",
  validate(undoSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof undoSchema._output>(req);
    const result = await undoAction(currentUser(req), params.id, params.rowId, body.actionId);
    res.status(200).json(result);
  }),
);

workflowRouter.get(
  "/:id/rows/:rowId/calls",
  validate(callsListSchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof callsListSchema._output>(req);
    const calls = await listCalls(currentUser(req), params.id, params.rowId);
    res.status(200).json({ calls });
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/calls",
  validate(callCreateSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof callCreateSchema._output>(req);
    const result = await logCall(currentUser(req), params.id, params.rowId, body);
    res.status(201).json(result);
  }),
);

workflowRouter.post(
  "/:id/rows/:rowId/calls/:callId/resolve",
  validate(callResolveSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof callResolveSchema._output>(req);
    const result = await resolveCall(currentUser(req), params.id, params.rowId, params.callId, body.note);
    res.status(200).json(result);
  }),
);

workflowRouter.get(
  "/:id/rows/:rowId/activity",
  validate(activitySchema),
  asyncHandler(async (req, res) => {
    const { params } = validated<typeof activitySchema._output>(req);
    const activity = await listActivity(currentUser(req), params.id, params.rowId);
    res.status(200).json({ activity });
  }),
);

workflowRouter.post(
  "/:id/bulk/validate",
  validate(bulkValidateSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof bulkValidateSchema._output>(req);
    const result = await bulkValidate(currentUser(req), params.id, body.rowIds, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/bulk/verify",
  validate(bulkVerifySchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof bulkVerifySchema._output>(req);
    const result = await bulkVerify(currentUser(req), params.id, body.rowIds, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/bulk/assign",
  validate(bulkAssignSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof bulkAssignSchema._output>(req);
    const result = await bulkAssign(currentUser(req), params.id, body.rowIds, body);
    res.status(200).json(result);
  }),
);

workflowRouter.post(
  "/:id/bulk/closeHistorical",
  validate(bulkHistoricalSchema),
  asyncHandler(async (req, res) => {
    const { params, body } = validated<typeof bulkHistoricalSchema._output>(req);
    const result = await closeHistorical(currentUser(req), params.id, body.rowIds);
    res.status(200).json(result);
  }),
);
