import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useLayoutEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppName } from "../../lib/app-name";
import { isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import {
  allowReturnCapture,
  clearLoginDestination,
  meQueryKey,
  peekLoginDestination,
  rememberReturnTo,
  sessionEpoch,
  shouldCaptureReturn,
  type SessionState,
} from "./session";

type AuthContextValue = SessionState & {
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthGate");
  return value;
}

export function AuthGate() {
  const location = useLocation();
  const query = useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      const epoch = sessionEpoch();
      try {
        const session = await api<SessionState>("/api/auth/me");
        if (epoch !== sessionEpoch()) return queryClient.getQueryData<SessionState | null>(meQueryKey) ?? null;
        return session;
      } catch (error) {
        if (isUnauthenticated(error)) {
          if (epoch !== sessionEpoch()) return queryClient.getQueryData<SessionState | null>(meQueryKey) ?? null;
          return null;
        }
        throw error;
      }
    },
  });

  useEffect(() => {
    const onUnauthenticated = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const path = isRecord(detail) && typeof detail.path === "string" ? detail.path : "";
      if (path === "/api/auth/login" || path === "/api/auth/me") return;
      queryClient.setQueryData<SessionState | null>(meQueryKey, null);
    };
    window.addEventListener("unauthenticated", onUnauthenticated);
    return () => window.removeEventListener("unauthenticated", onUnauthenticated);
  }, []);

  useEffect(() => {
    if (location.pathname !== "/login") clearLoginDestination();
  }, [location.pathname]);

  if (query.isPending) {
    return location.pathname === "/login" ? <LoginSkeleton /> : <ShellSkeleton />;
  }

  if (query.isError) {
    return <BootError onRetry={() => void query.refetch()} />;
  }

  const session = query.data;
  if (!session) {
    if (location.pathname !== "/login") {
      return <RedirectToLogin path={`${location.pathname}${location.search}`} />;
    }
    return <Outlet />;
  }

  if (location.pathname === "/login") {
    return <Navigate to={peekLoginDestination()} replace />;
  }

  return (
    <AuthContext.Provider
      value={{
        user: session.user,
        permissions: session.permissions,
        countryCode: session.countryCode,
        refresh: async () => {
          await query.refetch();
        },
      }}
    >
      <Outlet />
    </AuthContext.Provider>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function RedirectToLogin({ path }: { path: string }) {
  useLayoutEffect(() => {
    if (shouldCaptureReturn()) rememberReturnTo(path);
    allowReturnCapture();
  }, [path]);
  return <Navigate to="/login" replace />;
}

function BootError({ onRetry }: { onRetry: () => void }) {
  const appName = useAppName();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-card border border-hairline bg-surface p-8">
        <h1 className="font-serif text-[28px] font-normal text-ink">{appName}</h1>
        <p className="text-sm text-ink-2">Could not reach the server. Check your connection and try again.</p>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-card border border-hairline bg-surface p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid h-dvh grid-cols-1 overflow-hidden bg-canvas md:grid-cols-[64px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)]">
      <div className="hidden bg-navy md:block" />
      <div className="flex min-w-0 flex-col">
        <div className="h-[var(--topbar-h)] border-b border-hairline bg-surface" />
        <div className="flex flex-col gap-4 p-4 md:p-6 xl:p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
