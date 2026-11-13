"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { deadlineText, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Live deadline countdown. Renders the server-computed text first to avoid hydration drift. */
export function DeadlineCountdown({
  deadline,
  timeZone,
  done,
  showDate,
  className,
  serverNow,
}: {
  deadline: string | null;
  timeZone: string;
  done?: boolean;
  showDate?: boolean;
  className?: string;
  serverNow: number;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  if (!deadline) return <span className={cn("text-xs text-ink-subtle", className)}>No deadline</span>;
  const { text, tone } = deadlineText(deadline, now);
  const color = done ? "text-ink-muted" : { ok: "text-ink-muted", soon: "text-warning", overdue: "text-danger", none: "text-ink-subtle" }[tone];
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium tabular", color)} title={formatDateTime(deadline, timeZone)}>
        <Clock className="size-3.5 shrink-0" aria-hidden />
        {done ? formatDateTime(deadline, timeZone) : text}
      </span>
      {showDate && !done && <span className="mt-0.5 pl-5 text-[11px] text-ink-subtle tabular">{formatDateTime(deadline, timeZone)}</span>}
    </span>
  );
}
