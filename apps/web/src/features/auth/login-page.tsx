import type { SessionState } from "./session";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Label, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { PasswordField } from "./password-field";
import { advanceSessionEpoch, consumeReturnTo, meQueryKey, setLoginDestination } from "./session";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await api<SessionState>("/api/auth/login", {
        method: "POST",
        body: { email, password },
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
        <div className="mb-8 flex items-center gap-2.5 px-1.5">
          <span className="grid size-[34px] place-items-center rounded-[4px] bg-gold font-serif text-[18px] font-bold text-[#2a1d00]">
            SD
          </span>
          <b className="font-serif text-2xl font-semibold text-white">ServiceDesk</b>
        </div>
        <p className="px-1.5 text-sm leading-relaxed text-[#85a2a4]">
          PM visits, AMC follow-up and contract data in the same layout as your Excel sheet.
        </p>
      </aside>
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-card border border-hairline bg-surface p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-[34px] place-items-center rounded-[4px] bg-gold font-serif text-[18px] font-bold text-[#2a1d00]">
              SD
            </span>
            <b className="font-serif text-2xl font-semibold text-ink">ServiceDesk</b>
          </div>
          <h1 className="font-serif text-[36px] font-semibold leading-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">Use your existing email and password.</p>
          <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
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
