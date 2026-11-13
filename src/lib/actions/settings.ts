"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import type { Json } from "@/lib/supabase/database.types";

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  timezone: z.string().min(1).max(64),
  prefs: z.record(z.string(), z.boolean()),
});

export async function updateProfileAction(values: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_full_name: parsed.data.full_name,
    p_timezone: parsed.data.timezone,
    p_prefs: parsed.data.prefs as Json,
  });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

const workspaceSchema = z.object({
  workspace_name: z.string().trim().min(1, "Workspace name is required.").max(80),
  timezone: z.string().min(1).max(64),
  default_priority: z.enum(["low", "normal", "high", "urgent"]),
  default_client_platform: z.string().trim().min(1).max(60),
  default_resolution: z.string().trim().max(40),
  default_aspect_ratio: z.string().trim().max(20),
  default_frame_rate: z.string().trim().max(20),
  default_delivery_format: z.string().trim().max(80),
  default_storyboard_required: z.boolean(),
  deadline_warning_hours: z.coerce.number().int().min(1, "At least 1 hour.").max(168, "At most 168 hours."),
  stale_session_minutes: z.coerce.number().int().min(3, "At least 3 minutes.").max(120, "At most 120 minutes."),
  max_active_projects_per_editor: z.coerce.number().int().min(0).max(50),
  open_registration: z.boolean(),
});

export async function updateWorkspaceAction(values: z.input<typeof workspaceSchema>): Promise<ActionResult> {
  const parsed = workspaceSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_workspace_settings", { p_data: parsed.data as unknown as Json });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Workspace settings saved." };
}
