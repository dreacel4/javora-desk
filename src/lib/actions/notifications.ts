"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  project_id: string | null;
  read_at: string | null;
  created_at: string;
};

export async function listRecentNotifications(): Promise<ActionResult<{ items: NotificationItem[]; unread: number }>> {
  const supabase = await createClient();
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, project_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (error) return fail(error);
  return { ok: true, data: { items: data ?? [], unread: count ?? 0 } };
}

const idsSchema = z.array(z.string().uuid()).max(200).nullable();

export async function markNotificationsRead(ids: string[] | null): Promise<ActionResult> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: parsed.data ?? undefined });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true };
}
