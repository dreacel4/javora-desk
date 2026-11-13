import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Not found or not available to you"
        description="The page or project does not exist, or your role does not have access to it."
        action={<ButtonLink href="/dashboard">Back to dashboard</ButtonLink>}
      />
    </Card>
  );
}
