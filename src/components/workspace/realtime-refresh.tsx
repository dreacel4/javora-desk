"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/** Re-renders the project page when anyone records activity on it (RLS-filtered stream). */
export function RealtimeRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`project:${projectId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "project_activity", filter: `project_id=eq.${projectId}` }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 500);
      })
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [projectId, router]);
  return null;
}
