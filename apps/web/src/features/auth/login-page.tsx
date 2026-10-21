import type { Role } from "@app/shared";
import { ROLE_COPY } from "@app/shared";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Label, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { PasswordField } from "./password-field";
import {
  advanceSessionEpoch,
  consumeReturnTo,
  meQueryKey,
  setLoginDestination,
  type SessionState,
} from "./session";

type Desk = {
  role: Role;
  hint: string;
  email: string;
  password: string;
  phone: string | null;
};

const DESKS: Desk[] = [
  { role: "admin", hint: "Data and validation", email: "admin@example.com", password: "change-me", phone: null },
  { role: "manager", hint: "Escalations and renewals", email: "manager@example.com", password: "change-me", phone: "9800000002" },
  { role: "validator", hint: "Confirm contract data", email: "validator@example.com", password: "change-me", phone: null },
  { role: "service", hint: "My PMs and AMC calls", email: "service@example.com", password: "change-me", phone: "9800000001" },
];

type OtpStart = {
  otpRequired: true;
  challengeId: string;
  sentTo: string;
  channels: Array<"email" | "sms">;
  previewCode?: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [desk, setDesk] = useState<Desk>(DESKS[0]);
  const [email, setEmail] = useState(DESKS[0].email);
  const [password, setPassword] = useState(DESKS[0].password);
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<OtpStart | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const copy = ROLE_COPY[desk.role];

  function pickDesk(next: Desk) {
    setDesk(next);
    setEmail(next.email);
    setPassword(next.password);
    setOtp("");
    setChallenge(null);
    setError("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      if (challenge) {
        const result = await api<SessionState>("/api/auth/otp", {
          method: "POST",
          body: { challengeId: challenge.challengeId, code: otp.trim() },
        });
        await finish(result);
        return;
      }
      const result = await api<OtpStart | SessionState>("/api/auth/login", {
        method: "POST",
        body: { email, password, role: desk.role },
      });
      if (isOtpStart(result)) {
        setChallenge(result);
        return;
      }
      await finish(result);
    } catch (caught) {
      setError(errorText(caught, challenge ? "Could not verify that code." : "Could not sign in. Try again."));
    } finally {
      setPending(false);
    }
  }

  async function finish(result: SessionState) {
    const next = consumeReturnTo();
    setLoginDestination(next);
    advanceSessionEpoch();
    queryClient.setQueryData<SessionState>(meQueryKey, result);
    await navigate(next, { replace: true });
  }

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden flex-col bg-navy px-4 py-6 text-[#c9dcdc] lg:flex">
        <Brand />
        <p className="px-1.5 text-sm leading-relaxed text-[#85a2a4]">
          Sign in on your desk. OTP goes to that account’s mail, and to the mobile number when one is stored.
        </p>
        <DeskNav desk={desk} onPick={pickDesk} />
      </aside>
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-card border border-hairline bg-surface p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <b className="font-serif text-2xl font-semibold text-ink">ServiceDesk</b>
          </div>
          <div className="mb-5 lg:hidden">
            <DeskNav desk={desk} onPick={pickDesk} compact />
          </div>
          <h1 className="font-serif text-[36px] font-semibold leading-tight text-ink">{copy.title}</h1>
          <p className="mt-1 text-sm text-ink-2">{copy.blurb}</p>
          <div className="mt-5 rounded-[6px] border border-hairline bg-canvas px-4 py-3 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">This desk login</p>
            <p className="mt-2 text-ink">
              <span className="text-muted">ID</span>{" "}
              <span className="font-medium tabular-nums">{desk.email}</span>
            </p>
            <p className="text-ink">
              <span className="text-muted">Password</span>{" "}
              <span className="font-medium tabular-nums">{desk.password}</span>
            </p>
            <p className="mt-1 text-ink-2">
              OTP: {desk.email}
              {desk.phone ? ` and ${desk.phone}` : " (no mobile on this account)"}
            </p>
          </div>
          <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
            {challenge ? (
              <>
                <p className="text-sm text-ink-2">
                  Code sent to {challenge.sentTo}
                  {challenge.channels.includes("sms") ? " by SMS or email." : " by email."}
                </p>
                {challenge.previewCode ? (
                  <p className="text-sm text-ink-2">
                    Delivery API is not configured here. Use code{" "}
                    <span className="font-medium tabular-nums text-ink">{challenge.previewCode}</span>.
                  </p>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="otp">OTP</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <PasswordField
                  id="password"
                  label="Password"
                  value={password}
                  autoComplete="current-password"
                  onChange={setPassword}
                />
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-ruby">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending || (challenge != null && otp.length !== 4)}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              {challenge ? "Verify OTP" : "Sign in"}
            </Button>
            {challenge ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={pending}
                onClick={() => {
                  setChallenge(null);
                  setOtp("");
                  setError("");
                }}
              >
                Back
              </Button>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}

function DeskNav({
  desk,
  onPick,
  compact = false,
}: {
  desk: Desk;
  onPick: (desk: Desk) => void;
  compact?: boolean;
}) {
  return (
    <nav className={compact ? "flex flex-wrap gap-1.5" : "mt-8 flex flex-col gap-0.5"} aria-label="Sign in as">
      {DESKS.map((item) => {
        const active = item.role === desk.role;
        const copy = ROLE_COPY[item.role];
        return (
          <button
            key={item.role}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(item)}
            className={
              compact
                ? `rounded-[6px] border px-3 py-2 text-left text-sm ${active ? "border-gold bg-gold-soft text-ink" : "border-hairline bg-surface text-ink-2"}`
                : `rounded-[6px] border-l-[3px] px-3 py-2 text-left ${active ? "border-gold bg-white/10 text-white" : "border-transparent text-[#c9dcdc] hover:bg-white/5"}`
            }
          >
            <b className="block font-medium">{copy.title}</b>
            {compact ? null : <small className={`block text-[12px] ${active ? "text-[#b4cccd]" : "text-[#85a2a4]"}`}>{item.hint}</small>}
          </button>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="mb-8 flex items-center gap-2.5 px-1.5">
      <BrandMark />
      <b className="font-serif text-2xl font-semibold text-white">ServiceDesk</b>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="grid size-[34px] place-items-center rounded-[4px] bg-gold font-serif text-[18px] font-bold text-[#2a1d00]">
      SD
    </span>
  );
}

function isOtpStart(value: unknown): value is OtpStart {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.otpRequired === true && typeof record.challengeId === "string" && typeof record.sentTo === "string";
}
