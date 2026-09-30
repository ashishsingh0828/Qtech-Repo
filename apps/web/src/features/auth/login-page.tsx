import type { SessionState } from "./session";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Label, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppName } from "../../lib/app-name";
import { errorText } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { PasswordField } from "./password-field";
import { advanceSessionEpoch, consumeReturnTo, meQueryKey, setLoginDestination } from "./session";

export function LoginPage() {
  const appName = useAppName();
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
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-hairline bg-surface p-8">
        <h1 className="font-serif text-[32px] font-normal leading-tight text-ink">{appName}</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to continue</p>
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
  );
}
