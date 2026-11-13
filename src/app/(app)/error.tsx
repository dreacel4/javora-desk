"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title="This page could not be loaded"
        description={`Something went wrong on our side${error.digest ? ` (ref ${error.digest})` : ""}. Your data is safe — try again.`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
