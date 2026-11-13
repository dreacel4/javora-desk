import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import type { Profile, ProjectStatus } from "@/lib/types";
import { OPEN_STATUSES } from "@/lib/status";

export type PersonMap = Record<string, { name: string; email: string; role: Profile["role"]; is_active: boolean }>;

/** Visible team directory as an id → person map (team is small; RLS scopes it). */
export async function getPeople(): Promise<PersonMap> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email, role, is_active");
  const map: PersonMap = {};
  for (const p of data ?? []) map[p.id] = { name: p.full_name || p.email, email: p.email, role: p.role, is_active: p.is_active };
  return map;
}

export async function getActiveEditors() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "editor")
    .eq("is_active", true)
    .order("full_name");
  return data ?? [];
}

export async function getWorkspaceSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("workspace_settings").select("*").eq("id", 1).single();
  return data;
}

/* --------------------------------------------------------------------------- */
/* Project lists                                                                */
/* --------------------------------------------------------------------------- */
export const PROJECT_VIEWS = {
  all: { label: "All projects" },
  available: { label: "Available" },
  mine: { label: "My projects" },
  in_progress: { label: "In progress" },
  review: { label: "Pending review" },
  revision: { label: "Revision required" },
  completed: { label: "Completed" },
  drafts: { label: "Drafts" },
  archived: { label: "Archived" },
} as const;
export type ProjectView = keyof typeof PROJECT_VIEWS;

export type ProjectListFilters = {
  view: ProjectView;
  q?: string;
  status?: ProjectStatus;
  priority?: Tables<"projects">["priority"];
  editor?: string;
  sort?: "deadline" | "priority" | "updated" | "created";
  page?: number;
};

export const PAGE_SIZE = 25;

export type ProjectListItem = Pick<
  Tables<"projects">,
  | "id" | "internal_ref" | "title" | "client_name" | "client_platform" | "status" | "priority" | "deadline"
  | "assigned_editor_id" | "updated_at" | "created_at" | "storyboard_required" | "archived_at" | "status_changed_at"
>;

export async function listProjects(profile: Profile, f: ProjectListFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("projects")
    .select(
      "id, internal_ref, title, client_name, client_platform, status, priority, deadline, assigned_editor_id, updated_at, created_at, storyboard_required, archived_at, status_changed_at",
      { count: "exact" },
    );

  const manager = profile.role !== "editor";
  switch (f.view) {
    case "available":
      query = query.eq("status", "available").is("archived_at", null);
      break;
    case "mine":
      query = manager
        ? query.eq("created_by", profile.id).is("archived_at", null)
        : query.eq("assigned_editor_id", profile.id).is("archived_at", null);
      break;
    case "in_progress":
      query = query.in("status", ["claimed", "awaiting_confirmation", "awaiting_storyboard_approval", "ready_to_start", "in_progress"]);
      break;
    case "review":
      query = query.in("status", ["submitted", "dispatcher_review"]);
      break;
    case "revision":
      query = query.eq("status", "revision_requested");
      break;
    case "completed":
      query = query.eq("status", "completed").is("archived_at", null);
      break;
    case "drafts":
      query = query.eq("status", "draft");
      break;
    case "archived":
      query = query.not("archived_at", "is", null);
      break;
    default:
      query = query.is("archived_at", null);
  }

  if (f.status) query = query.eq("status", f.status);
  if (f.priority) query = query.eq("priority", f.priority);
  if (f.editor && manager) query = query.eq("assigned_editor_id", f.editor);
  if (f.q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = f.q.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 80);
    if (term) query = query.or(`title.ilike.%${term}%,client_name.ilike.%${term}%,internal_ref.ilike.%${term}%`);
  }

  switch (f.sort) {
    case "priority":
      // enum order low < normal < high < urgent
      query = query.order("priority", { ascending: false }).order("deadline", { ascending: true, nullsFirst: false });
      break;
    case "updated":
      query = query.order("updated_at", { ascending: false });
      break;
    case "created":
      query = query.order("created_at", { ascending: false });
      break;
    default:
      query = query.order("deadline", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  }

  const page = Math.max(1, f.page ?? 1);
  query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return { items: (data ?? []) as ProjectListItem[], total: count ?? 0, page };
}

/* --------------------------------------------------------------------------- */
/* Dashboard                                                                    */
/* --------------------------------------------------------------------------- */
export type DashboardStats = {
  active: number; available: number; in_progress: number; pending_confirmation: number; pending_storyboard: number;
  pending_submissions: number; revision_requested: number; completed: number; overdue: number; draft: number; on_hold: number;
};

export async function getDashboard(profile: Profile) {
  const supabase = await createClient();
  // Opportunistic maintenance (deadline reminders, stale timers). Idempotent; errors are non-fatal.
  await supabase.rpc("run_maintenance");

  const manager = profile.role !== "editor";
  const [statsRes, activityRes, upcomingRes, attentionRes, myTimeRes] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase.from("project_activity").select("id, project_id, actor_id, action, details, created_at").order("created_at", { ascending: false }).limit(12),
    supabase
      .from("projects")
      .select("id, internal_ref, title, client_name, status, priority, deadline, assigned_editor_id")
      .in("status", OPEN_STATUSES)
      .not("deadline", "is", null)
      .order("deadline", { ascending: true })
      .limit(manager ? 8 : 6),
    manager
      ? supabase
          .from("projects")
          .select("id, internal_ref, title, status, priority, deadline, assigned_editor_id, status_changed_at")
          .in("status", ["awaiting_confirmation", "awaiting_storyboard_approval", "submitted", "dispatcher_review"])
          .order("status_changed_at", { ascending: true })
          .limit(10)
      : supabase
          .from("projects")
          .select("id, internal_ref, title, status, priority, deadline, assigned_editor_id, status_changed_at")
          .eq("assigned_editor_id", profile.id)
          .in("status", ["claimed", "awaiting_storyboard_approval", "ready_to_start", "in_progress", "revision_requested"])
          .order("deadline", { ascending: true, nullsFirst: false })
          .limit(10),
    manager
      ? Promise.resolve({ data: null })
      : supabase.from("work_session_summaries").select("project_id, status, active_seconds, started_at").eq("editor_id", profile.id).gte("started_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
  ]);

  // Storyboards awaiting a decision vs. awaiting an upload (managers only care about the former).
  let pendingStoryboardProjects = new Set<string>();
  if (manager && attentionRes.data?.some((p) => p.status === "awaiting_storyboard_approval")) {
    const { data } = await supabase.from("storyboards").select("project_id").eq("status", "pending");
    pendingStoryboardProjects = new Set((data ?? []).map((s) => s.project_id));
  }
  const attention = (attentionRes.data ?? []).filter((p) => !manager || p.status !== "awaiting_storyboard_approval" || pendingStoryboardProjects.has(p.id));

  return {
    stats: (statsRes.data ?? {}) as unknown as DashboardStats,
    activity: activityRes.data ?? [],
    upcoming: upcomingRes.data ?? [],
    attention,
    weekSessions: (myTimeRes.data ?? []) as Pick<Tables<"work_session_summaries">, "project_id" | "status" | "active_seconds" | "started_at">[],
  };
}

/* --------------------------------------------------------------------------- */
/* Project workspace                                                            */
/* --------------------------------------------------------------------------- */
export async function getProjectWorkspace(id: string) {
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) return null;

  const [briefs, assets, files, assignments, responses, storyboards, sbReviews, sessions, intervals, submissions, reviews, revisions, activity] =
    await Promise.all([
      supabase.from("project_briefs").select("*").eq("project_id", id).order("version", { ascending: false }),
      supabase.from("project_assets").select("*").eq("project_id", id).order("created_at"),
      supabase.from("project_files").select("*").eq("project_id", id).order("created_at"),
      supabase.from("project_assignments").select("*").eq("project_id", id).order("assigned_at", { ascending: false }),
      supabase.from("editor_responses").select("*").eq("project_id", id).order("version", { ascending: false }),
      supabase.from("storyboards").select("*").eq("project_id", id).order("version", { ascending: false }),
      supabase.from("storyboard_reviews").select("*").eq("project_id", id).order("created_at"),
      supabase.from("work_session_summaries").select("*").eq("project_id", id).order("started_at", { ascending: false }),
      supabase
        .from("work_session_intervals")
        .select("id, session_id, started_at, ended_at, end_reason, work_sessions!inner(project_id)")
        .eq("work_sessions.project_id", id)
        .order("started_at"),
      supabase.from("submissions").select("*").eq("project_id", id).order("sequence", { ascending: false }),
      supabase.from("submission_reviews").select("*").eq("project_id", id).order("created_at"),
      supabase.from("revision_requests").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      supabase.from("project_activity").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(200),
    ]);

  return {
    project,
    briefs: briefs.data ?? [],
    assets: assets.data ?? [],
    files: files.data ?? [],
    assignments: assignments.data ?? [],
    responses: responses.data ?? [],
    storyboards: storyboards.data ?? [],
    storyboardReviews: sbReviews.data ?? [],
    sessions: sessions.data ?? [],
    intervals: (intervals.data ?? []).map((i) => ({
      id: i.id,
      session_id: i.session_id,
      started_at: i.started_at,
      ended_at: i.ended_at,
      end_reason: i.end_reason,
    })),
    submissions: submissions.data ?? [],
    submissionReviews: reviews.data ?? [],
    revisions: revisions.data ?? [],
    activity: activity.data ?? [],
  };
}

export type ProjectWorkspace = NonNullable<Awaited<ReturnType<typeof getProjectWorkspace>>>;
