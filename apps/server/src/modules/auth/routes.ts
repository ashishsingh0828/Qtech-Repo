import { Router } from "express";
import { env } from "../../env";
import { permissionsFor } from "../../lib/account";
import { asyncHandler } from "../../lib/asyncHandler";
import { readRetryAfterSeconds } from "../../lib/login-rate-limit";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../../lib/session";
import { validate, validated } from "../../lib/validate";
import { currentUser, requireAuth } from "../../middleware/auth";
import { changePasswordSchema, loginOtpSchema, loginSchema, sessionReadSchema } from "./schema";
import { changePassword, login, logout, verifyLoginOtp } from "./service";

export const authRouter = Router();

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    try {
      const { body } = validated<typeof loginSchema._output>(req);
      const result = await login({
        email: body.email,
        password: body.password,
        role: body.role,
        ip: req.ip || "unknown",
      });
      if (result.otpRequired) {
        res.status(200).json({
          otpRequired: true,
          challengeId: result.issue.challengeId,
          sentTo: result.issue.sentTo,
          channels: result.issue.channels,
          previewCode: result.issue.previewCode,
        });
        return;
      }
      setSessionCookie(res, result.token);
      res.status(200).json({
        user: result.user,
        permissions: result.permissions,
        countryCode: env.DEFAULT_COUNTRY_CODE,
        timeZone: env.APP_TIMEZONE,
      });
    } catch (error) {
      const retryAfter = readRetryAfterSeconds(error);
      if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
      throw error;
    }
  }),
);

authRouter.post(
  "/otp",
  validate(loginOtpSchema),
  asyncHandler(async (req, res) => {
    const { body } = validated<typeof loginOtpSchema._output>(req);
    const result = await verifyLoginOtp({
      challengeId: body.challengeId,
      code: body.code,
      ip: req.ip || "unknown",
    });
    setSessionCookie(res, result.token);
    res.status(200).json({
      user: result.user,
      permissions: result.permissions,
      countryCode: env.DEFAULT_COUNTRY_CODE,
      timeZone: env.APP_TIMEZONE,
    });
  }),
);

authRouter.post(
  "/logout",
  validate(sessionReadSchema),
  asyncHandler(async (req, res) => {
    await logout(readSessionToken(req.cookies as Record<string, unknown> | undefined));
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  validate(sessionReadSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const permissions = await permissionsFor(user.role);
    res.status(200).json({ user, permissions, countryCode: env.DEFAULT_COUNTRY_CODE, timeZone: env.APP_TIMEZONE });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { body } = validated<typeof changePasswordSchema._output>(req);
    await changePassword(currentUser(req).id, body.currentPassword, body.newPassword);
    res.status(204).end();
  }),
);
