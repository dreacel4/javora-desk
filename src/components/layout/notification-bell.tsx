"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { listRecentNotifications, markNotificationsRead, type NotificationItem } from "@/lib/actions/notifications";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/nav";
import { useToast } from "@/components/ui/overlay";

export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lastInitial, setLastInitial] = useState(initialUnread);
  if (lastInitial !== initialUnread) {
    setLastInitial(initialUnread);
    setUnread(initialUnread);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listRecentNotifications();
    setLoading(false);
    if (res.ok && res.data) {
      setItems(res.data.items);
      setUnread(res.data.unread);
    }
  }, []);

  // Realtime: new notifications for this user (RLS also restricts the stream).
  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as NotificationItem;
          setUnread((u) => u + 1);
          setItems((list) => (list ? [n, ...list].slice(0, 8) : list));
          toast("success", n.title);
          // Refresh server components so statuses on screen stay current.
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => router.refresh(), 400);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, router, toast]);

  const markAll = async () => {
    const res = await markNotificationsRead(null);
    if (res.ok) {
      setUnread(0);
      setItems((list) => list?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? list);
    }
  };

  return (
    <Dropdown
      className="w-[min(380px,calc(100vw-2rem))]"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          onClick={() => {
            p.onClick();
            void load();
          }}
          className="relative rounded-lg p-2 text-ink-muted hover:bg-navy-50 hover:text-ink"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white tabular ring-2 ring-surface">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
            <p className="text-[13px] font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs text-accent hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto border-t border-line scrollbar-thin">
            {loading && !items ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-ink-muted" />
              </div>
            ) : items && items.length > 0 ? (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.project_id ? `/projects/${n.project_id}` : "/notifications"}
                  onClick={() => {
                    close();
                    if (!n.read_at) {
                      setUnread((u) => Math.max(0, u - 1));
                      void markNotificationsRead([n.id]);
                    }
                  }}
                  className="flex gap-3 border-b border-line px-3 py-3 last:border-0 hover:bg-navy-50"
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                  <span className="min-w-0">
                    <span className={cn("block text-[13px] leading-snug", n.read_at ? "text-ink-muted" : "font-medium text-ink")}>{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-ink-subtle">{formatRelative(n.created_at)}</span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-[13px] text-ink-muted">You&apos;re all caught up.</p>
            )}
          </div>
          <Link href="/notifications" onClick={close} className="block border-t border-line px-3 py-2.5 text-center text-xs font-medium text-accent hover:bg-navy-50">
            View all notifications
          </Link>
        </div>
      )}
    </Dropdown>
  );
}
