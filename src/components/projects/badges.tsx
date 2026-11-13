import { Flag } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { PRIORITY_META, STATUS_META } from "@/lib/status";
import type { ProjectPriority, ProjectStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

export function PriorityBadge({ priority, compact }: { priority: ProjectPriority; compact?: boolean }) {
  const m = PRIORITY_META[priority];
  if (compact) {
    return (
      <span
        title={`${m.label} priority`}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          { neutral: "text-ink-subtle", info: "text-ink-muted", warning: "text-warning", danger: "text-danger", navy: "", success: "", violet: "" }[m.tone],
        )}
      >
        <Flag className="size-3.5" aria-hidden />
        {m.label}
      </span>
    );
  }
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
