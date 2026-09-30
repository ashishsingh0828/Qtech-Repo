import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button, EmptyState } from "../../components/ui";

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || "This page could not be loaded."
    : "This page could not be loaded.";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <EmptyState message={message} action={<Button onClick={() => window.location.reload()}>Reload</Button>} />
    </div>
  );
}
