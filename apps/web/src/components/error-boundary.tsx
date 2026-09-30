import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <EmptyState
          message="Something went wrong."
          action={
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
