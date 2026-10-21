import type { Role } from "@app/shared";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Label, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { PasswordField } from "./password-field";
import { advanceSessionEpoch, consumeReturnTo, meQueryKey, setLoginDestination, type SessionState } from "./session";

type Desk = {
  id: string;
  role: Role;
  title: string;
  hint: string;
  blurb: string;
  email: string;
  password: string;
};

const DESKS: Desk[] = [
  {
    id: "engineer",
    role: "service",
    title: "Service Engineer",
    hint: "My PMs and AMC calls",
    blurb: "Acknowledge, delay or close your PM visits. Closing needs a report and the customer OTP.",
    email: "service@example.com",
    password: "change-me",
  },
  {
    id: "coordinator",
    role: "validator",
    title: "Service Coordinator",
    hint: "Monthly PM calendar",
    blurb: "Every open PM by month. Assign engineers and watch the reminder level.",
    email: "validator@example.com",
    password: "change-me",
  },
  {
    id: "manager",
    role: "manager",
    title: "Service Manager",
    hint: "Escalations and renewals",
    blurb: "PMs that reminders have escalated, and the AMC follow-up pipeline.",
    email: "manager@example.com",
    password: "change-me",
  },
  {
    id: "accounts",
    role: "manager",
    title: "Accounts",
    hint: "AMC and cheques",
    blurb: "Follow AMC outcomes, cheque dates and accepted contracts.",
    email: "accounts@example.com",
    password: "change-me",
  },
  {
    id: "admin",
    role: "admin",
    title: "Admin",
    hint: "Data and validation",
    blurb: "Upload or download the Excel sheet, add contracts and validate data.",
    email: "admin@example.com",
    password: "change-me",
  },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [desk, setDesk] = useState<Desk>(DESKS[0]);
  const [email, setEmail] = useState(DESKS[0].email);
  const [password, setPassword] = useState(DESKS[0].password);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function pickDesk(next: Desk) {
    setDesk(next);
    setEmail(next.email);
    setPassword(next.password);
    setError("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await api<SessionState>("/api/auth/login", {
        method: "POST",
        body: { email, password, role: desk.role },
      });
      const next = consumeReturnTo();
      setLoginDestination(next);
      advanceSessionEpoch();
      queryClient.setQueryData<SessionState>(meQueryKey, result);
      await navigate(next, { replace: true });
    } catch (caught) {
      setError(errorText(caught, "Could not sign in. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden flex-col bg-navy px-4 py-6 text-[#c9dcdc] lg:flex">
        <Brand />
        <p className="px-1.5 text-sm leading-relaxed text-[#85a2a4]">Sign in on your desk. Customer OTP is used only when you delay or close a visit.</p>
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
          <h1 className="font-serif text-[36px] font-semibold leading-tight text-ink">{desk.title}</h1>
          <p className="mt-1 text-sm text-ink-2">{desk.blurb}</p>
          <div className="mt-5 rounded-[6px] border border-hairline bg-canvas px-4 py-3 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">This desk login</p>
            <p className="mt-2 text-ink">
              <span className="text-muted">ID</span> <span className="font-medium tabular-nums">{desk.email}</span>
            </p>
            <p className="text-ink">
              <span className="text-muted">Password</span> <span className="font-medium tabular-nums">{desk.password}</span>
            </p>
          </div>
          <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <PasswordField id="password" label="Password" value={password} autoComplete="current-password" onChange={setPassword} />
            {error ? (
              <p role="alert" className="text-sm text-ruby">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DeskNav({ desk, onPick, compact = false }: { desk: Desk; onPick: (desk: Desk) => void; compact?: boolean }) {
  return (
    <nav className={compact ? "flex flex-wrap gap-1.5" : "mt-8 flex flex-col gap-0.5"} aria-label="Sign in as">
      {DESKS.map((item) => {
        const active = item.id === desk.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(item)}
            className={
              compact
                ? `rounded-[6px] border px-3 py-2 text-left text-sm ${active ? "border-gold bg-gold-soft text-ink" : "border-hairline bg-surface text-ink-2"}`
                : `rounded-[6px] border-l-[3px] px-3 py-2 text-left ${active ? "border-gold bg-white/10 text-white" : "border-transparent text-[#c9dcdc] hover:bg-white/5"}`
            }
          >
            <b className="block font-medium">{item.title}</b>
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
