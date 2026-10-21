import { createHash, randomInt } from "node:crypto";
import { env } from "../env";
import { AppError } from "./errors";
import { logger } from "./logger";
import { prisma } from "./prisma";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = "login" | "pms_close" | "pms_delay" | "amc_update";
export type OtpChannel = "email" | "sms";

export type OtpIssue = {
  challengeId: string;
  sentTo: string;
  channels: OtpChannel[];
  previewCode?: string;
};

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

export async function issueOtp(input: {
  purpose: OtpPurpose;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
  datasetId?: string | null;
  rowId?: string | null;
}): Promise<OtpIssue | null> {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (!email && !phone) return null;

  const code = String(randomInt(1000, 10000));
  const challenge = await prisma.otpChallenge.create({
    data: {
      purpose: input.purpose,
      email,
      phone,
      userId: input.userId ?? null,
      datasetId: input.datasetId ?? null,
      rowId: input.rowId ?? null,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const delivered = await deliverOtp({ email, phone, code, purpose: input.purpose });
  const sentTo = [
    email ? maskEmail(email) : null,
    phone ? maskPhone(phone) : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" and ");

  return {
    challengeId: challenge.id,
    sentTo,
    channels: delivered.channels,
    previewCode: delivered.preview ? code : undefined,
  };
}

export async function consumeOtp(input: {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
  userId?: string;
  datasetId?: string;
  rowId?: string;
}): Promise<void> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || challenge.purpose !== input.purpose) {
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  if (challenge.consumedAt) {
    throw new AppError("VALIDATION", 400, "That OTP has already been used.");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError("VALIDATION", 400, "That OTP has expired. Request a new code.");
  }
  if (input.userId && challenge.userId !== input.userId) {
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  if (input.datasetId && challenge.datasetId !== input.datasetId) {
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  if (input.rowId && challenge.rowId !== input.rowId) {
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw new AppError("RATE_LIMITED", 429, "Too many OTP attempts. Request a new code.");
  }
  if (challenge.codeHash !== hashCode(input.code.trim())) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("VALIDATION", 400, "That OTP is not valid.");
  }
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
}

async function deliverOtp(input: {
  email: string | null;
  phone: string | null;
  code: string;
  purpose: OtpPurpose;
}): Promise<{ channels: OtpChannel[]; preview: boolean }> {
  const channels: OtpChannel[] = [];
  let posted = false;
  const text = `ServiceDesk code ${input.code}. It expires in 10 minutes.`;

  if (input.email) {
    channels.push("email");
    const sent = await postOtp(optionalEnv(env.OTP_EMAIL_API_URL), optionalEnv(env.OTP_EMAIL_API_KEY), {
      to: input.email,
      subject: "ServiceDesk code",
      text,
      channel: "email",
      purpose: input.purpose,
    });
    if (sent) posted = true;
  }

  if (input.phone) {
    channels.push("sms");
    const sent = await postOtp(optionalEnv(env.OTP_SMS_API_URL), optionalEnv(env.OTP_SMS_API_KEY), {
      to: input.phone,
      text,
      channel: "sms",
      purpose: input.purpose,
    });
    if (sent) posted = true;
  }

  if (!posted) {
    logger.info({ purpose: input.purpose, channels }, "OTP queued without a delivery API");
  }
  return { channels, preview: !posted };
}

async function postOtp(
  url: string | undefined,
  key: string | undefined,
  body: Record<string, string>,
): Promise<boolean> {
  if (!url) return false;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) {
      logger.error({ status: response.status, url }, "OTP delivery API rejected the request");
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error, url }, "OTP delivery API failed");
    return false;
  }
}
