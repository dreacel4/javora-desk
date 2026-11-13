import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MarkAllRead } from "@/components/settings/mark-all-read";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const unreadOnly = sp.filter === "unread";
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id, type, title, body, project_id, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  if (unreadOnly) q = q.is("read_at", null);
  const { data: items } = await q;
  const unread = (items ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates on projects you work on. Choose which ones you receive in Settings."
        actions={unread > 0 && <MarkAllRead />}
      />
      <div className="mb-4 flex gap-2 text-[13px]">
        <Link href="/notifications" className={cn("rounded-lg px-3 py-1.5", !unreadOnly ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-50")}>All</Link>
        <Link href="/notifications?filter=unread" className={cn("rounded-lg px-3 py-1.5", unreadOnly ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-50")}>Unread</Link>
      </div>
      <Card>
        {!items || items.length === 0 ? (
          <EmptyState icon={<Bell className="size-5" />} title={unreadOnly ? "No unread notifications" : "No notifications yet"} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.project_id ? `/projects/${n.project_id}` : "#"} className="flex gap-3 px-5 py-4 hover:bg-navy-50/60">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} aria-label={n.read_at ? undefined : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", n.read_at ? "text-ink-muted" : "font-medium")}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-muted">{n.body}</p>}
                  </div>
                  <time className="shrink-0 text-xs text-ink-subtle" title={formatDateTime(n.created_at, profile.timezone)}>{formatRelative(n.created_at)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
