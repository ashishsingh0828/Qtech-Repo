import { healthResponseSchema } from "@app/shared";
import type { HealthResponse } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Card, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";

async function fetchHealth(): Promise<HealthResponse> {
  const payload = await api<unknown>("/api/health", { tolerate: [503] });
  return healthResponseSchema.parse(payload);
}

export function HomePage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  const appName = health.data?.appName;

  useEffect(() => {
    if (appName) document.title = appName;
  }, [appName]);

  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 md:px-6 xl:px-8">
        {health.isPending || !appName ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-5 w-56 max-w-full" />
          </div>
        ) : (
          <PageHeader title={appName} />
        )}
        <Card className="max-w-xl">
          {health.isPending ? <Skeleton className="h-5 w-52" /> : null}
          {health.data?.db === "up" ? <p className="text-sm text-ink">Connected to database</p> : null}
          {health.isError || health.data?.db === "down" ? (
            <p className="text-sm text-ink">Database unavailable</p>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
