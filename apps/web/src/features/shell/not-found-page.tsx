import { Link } from "react-router-dom";
import { Button, PageHeader } from "../../components/ui";

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Page not found" subtitle="This page does not exist." />
      <Button asChild className="self-start">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
