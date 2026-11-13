"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  storyboardSchema,
  submissionSchema,
  understandingSchema,
  uploadedFileSchema,
} from "@/lib/validation/project";

const uuid = z.string().uuid();

function invalid(error: z.ZodError): ActionResult<never> {
  const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const first = Object.values(fieldErrors).flat().find(Boolean) ?? error.issues[0]?.message;
  return { ok: false, error: first ?? "Some fields are invalid.", fieldErrors };
}

function refresh() {
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------------------------- */
/* Editor understanding                                                         */
/* --------------------------------------------------------------------------- */
export async function submitUnderstandingAction(
  projectId: string,
  values: z.input<typeof understandingSchema>,
  files: z.input<typeof uploadedFileSchema>[],
): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = understandingSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const parsedFiles = z.array(uploadedFileSchema).max(10).safeParse(files);
  if (!parsedFiles.success) return { ok: false, error: "Invalid attachments." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_editor_response", {
    p_project: projectId,
    p_data: parsed.data as unknown as Json,
    p_files: parsedFiles.data as unknown as Json,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Understanding submitted. The dispatcher has been notified." };
}

export async function reviewUnderstandingAction(
  responseId: string,
  decision: "approved" | "clarification_requested",
  note: string,
): Promise<ActionResult> {
  if (!uuid.safeParse(responseId).success) return { ok: false, error: "Invalid response." };
  if (decision !== "approved" && decision !== "clarification_requested") return { ok: false, error: "Invalid decision." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_editor_response", {
    p_response: responseId,
    p_decision: decision,
    p_note: (note ?? "").slice(0, 4000),
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: decision === "approved" ? "Understanding approved." : "Clarification requested from the editor." };
}

/* --------------------------------------------------------------------------- */
/* Storyboards                                                                  */
/* --------------------------------------------------------------------------- */
export async function submitStoryboardAction(projectId: string, values: z.input<typeof storyboardSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = storyboardSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_storyboard", {
    p_project: projectId,
    p_description: parsed.data.description,
    p_sequence_notes: parsed.data.sequence_notes,
    p_files: parsed.data.files as unknown as Json,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Storyboard submitted for approval." };
}

export async function reviewStoryboardAction(
  storyboardId: string,
  decision: "approved" | "changes_requested" | "comment",
  comment: string,
): Promise<ActionResult> {
  if (!uuid.safeParse(storyboardId).success) return { ok: false, error: "Invalid storyboard." };
  if (!["approved", "changes_requested", "comment"].includes(decision)) return { ok: false, error: "Invalid decision." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_storyboard", {
    p_storyboard: storyboardId,
    p_decision: decision,
    p_comment: (comment ?? "").slice(0, 4000),
  });
  if (error) return fail(error);
  refresh();
  const message = { approved: "Storyboard approved. Production can start.", changes_requested: "Changes requested.", comment: "Comment added." }[decision];
  return { ok: true, message };
}

/* --------------------------------------------------------------------------- */
/* Timer                                                                        */
/* --------------------------------------------------------------------------- */
export type TimerSnapshot = {
  sessionId: string | null;
  status: "active" | "paused" | "stopped" | null;
  activeSeconds: number;
  runningSince: string | null;
  serverNow: string;
  projectTotalSeconds: number;
};

async function snapshot(projectId: string): Promise<TimerSnapshot> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub ?? "";
  const { data } = await supabase
    .from("work_session_summaries")
    .select("id, status, active_seconds, running_since, server_now, editor_id")
    .eq("project_id", projectId)
    .eq("editor_id", me)
    .order("started_at", { ascending: false });
  const rows = data ?? [];
  const open = rows.find((r) => r.status === "active" || r.status === "paused");
  return {
    sessionId: open?.id ?? null,
    status: (open?.status as TimerSnapshot["status"]) ?? null,
    activeSeconds: open?.active_seconds ?? 0,
    runningSince: open?.status === "active" ? open.running_since : null,
    serverNow: rows[0]?.server_now ?? new Date().toISOString(),
    projectTotalSeconds: rows.reduce((sum, r) => sum + (r.active_seconds ?? 0), 0),
  };
}

export async function getTimerAction(projectId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  return { ok: true, data: await snapshot(projectId) };
}

export async function startTimerAction(projectId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_work_session", { p_project: projectId });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: await snapshot(projectId) };
}

export async function pauseTimerAction(projectId: string, sessionId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pause_work_session", { p_session: sessionId });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: await snapshot(projectId) };
}

export async function resumeTimerAction(projectId: string, sessionId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resume_work_session", { p_session: sessionId });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: await snapshot(projectId) };
}

export async function stopTimerAction(projectId: string, sessionId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("stop_work_session", { p_session: sessionId });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: await snapshot(projectId) };
}

/** Keeps a running session alive; returns the authoritative state. */
export async function heartbeatAction(projectId: string, sessionId: string): Promise<ActionResult<TimerSnapshot>> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("heartbeat_work_session", { p_session: sessionId });
  if (error) return fail(error);
  return { ok: true, data: await snapshot(projectId) };
}

/* --------------------------------------------------------------------------- */
/* Submission and review                                                        */
/* --------------------------------------------------------------------------- */
export async function submitWorkAction(projectId: string, values: z.input<typeof submissionSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = submissionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_work", { p_project: projectId, p_data: parsed.data as unknown as Json });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Work submitted. Your timer was stopped and the dispatcher notified." };
}

export async function beginReviewAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("begin_submission_review", { p_project: projectId });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Review started." };
}

const reviewSchema = z.object({
  decision: z.enum(["approved", "revision_requested"]),
  notes: z.string().trim().max(8000).default(""),
  reason: z.string().trim().max(4000).default(""),
});

export async function reviewSubmissionAction(submissionId: string, values: z.input<typeof reviewSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(submissionId).success) return { ok: false, error: "Invalid submission." };
  const parsed = reviewSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.decision === "revision_requested" && parsed.data.reason.length < 5) {
    return { ok: false, error: "A reason is required when requesting a revision.", fieldErrors: { reason: ["Explain what must change (at least 5 characters)."] } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_submission", {
    p_submission: submissionId,
    p_decision: parsed.data.decision,
    p_notes: parsed.data.notes,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: parsed.data.decision === "approved" ? "Submission approved. Project completed." : "Revision requested. The editor has been notified." };
}
