"use client";

import { CheckCheck } from "lucide-react";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/overlay";

export function MarkAllRead() {
  const { run, pending } = useAction();
  return (
    <Button variant="secondary" icon={<CheckCheck className="size-4" />} loading={pending} onClick={() => run(() => markNotificationsRead(null), { success: "All notifications marked as read." })}>
      Mark all read
    </Button>
  );
}
