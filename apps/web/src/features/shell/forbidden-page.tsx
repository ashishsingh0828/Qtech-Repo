import { Link } from "react-router-dom";
import { Button, PageHeader } from "../../components/ui";

export function ForbiddenPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Access denied" subtitle="You do not have access to this page." />
      <Button asChild className="self-start">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
