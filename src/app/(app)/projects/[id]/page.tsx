import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getPeople, getProjectWorkspace, getWorkspaceSettings, type PersonMap, type ProjectWorkspace } from "@/lib/queries";
import { getTimerAction } from "@/lib/actions/workflow";
import { PRODUCTION_STAGES, STATUS_META } from "@/lib/status";
import { formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { cn, isUuid } from "@/lib/utils";
import { requestTime } from "@/lib/server-time";
import { Avatar } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/nav";
import { PriorityBadge, StatusBadge } from "@/components/projects/badges";
import { DeadlineCountdown } from "@/components/projects/deadline";
import { ProjectActions } from "@/components/workspace/project-actions";
import { RealtimeRefresh } from "@/components/workspace/realtime-refresh";
import { TimerPanel } from "@/components/workspace/timer-panel";
import {
  ActivityTab,
  BriefTab,
  MaterialsTab,
  OverviewTab,
  RevisionsTab,
  SessionsTab,
  StoryboardTab,
  SubmissionsTab,
  UnderstandingTab,
} from "@/components/workspace/tabs";

const TABS = ["overview", "brief", "materials", "understanding", "storyboard", "sessions", "submissions", "revisions", "activity"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Project" };
  const ws = await getProjectWorkspace(id);
  return { title: ws ? `${ws.project.internal_ref} · ${ws.project.title}` : "Project" };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const profile = await requireProfile();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;

  const [ws, people, settings] = await Promise.all([getProjectWorkspace(id), getPeople(), getWorkspaceSettings()]);
  if (!ws) notFound();

  const p = ws.project;
  const manager = profile.role !== "editor";
  const isAssignee = profile.role === "editor" && p.assigned_editor_id === profile.id;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const ctx = { ws, people, profile, manager, isAssignee };

  const showTimer = isAssignee && ["ready_to_start", "in_progress", "revision_requested"].includes(p.status);
  const timer = showTimer ? await getTimerAction(p.id) : null;

  const editors = Object.entries(people)
    .filter(([, x]) => x.role === "editor" && x.is_active)
    .map(([eid, x]) => ({ id: eid, name: x.name }));

  const pendingResponse = ws.responses.some((r) => r.status === "pending");
  const pendingStoryboard = ws.storyboards.some((s) => s.status === "pending");
  const pendingSubmission = p.status === "submitted" || p.status === "dispatcher_review";
  const openRevisions = ws.revisions.filter((r) => !r.resolved_at).length;

  return (
    <div className="flex flex-col gap-6">
      <RealtimeRefresh projectId={p.id} />

      <div>
        <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
          <ChevronLeft className="size-4" /> Projects
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-navy-50 px-2 py-0.5 font-mono text-xs text-navy-700 ring-1 ring-line">{p.internal_ref}</span>
              <StatusBadge status={p.status} />
              <PriorityBadge priority={p.priority} />
              {p.archived_at && <span className="text-xs text-ink-muted">Archived</span>}
            </div>
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl">{p.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-muted">
              <span>
                {p.client_name} · {p.client_platform}
              </span>
              <DeadlineCountdown deadline={p.deadline} timeZone={profile.timezone} done={p.status === "completed" || p.status === "cancelled"} serverNow={requestTime()} />
              <span className="flex items-center gap-2">
                <Avatar name={p.assigned_editor_id ? people[p.assigned_editor_id]?.name : null} size="sm" />
                {p.assigned_editor_id ? people[p.assigned_editor_id]?.name ?? "Editor" : "Unassigned"}
              </span>
            </div>
          </div>
          <ProjectActions project={p} role={profile.role} editors={editors} />
        </div>
      </div>

      <StageTracker status={p.status} holdFrom={p.hold_previous_status} />
      <NextStep ws={ws} people={people} profile={profile} manager={manager} isAssignee={isAssignee} />

      {showTimer && timer?.ok && timer.data && (
        <TimerPanel
          key={`${timer.data.sessionId}:${timer.data.status}:${timer.data.activeSeconds}:${timer.data.projectTotalSeconds}`}
          projectId={p.id} initial={timer.data} status={p.status} staleMinutes={settings?.stale_session_minutes ?? 10} />
      )}

      <div>
        <LinkTabs
          className="mb-5"
          active={tab}
          tabs={[
            { key: "overview", label: "Overview", href: "?tab=overview" },
            { key: "brief", label: "Original brief", href: "?tab=brief", count: ws.briefs.length > 1 ? ws.briefs.length : null },
            { key: "materials", label: "Materials & references", href: "?tab=materials", count: ws.assets.filter((a) => !a.removed_at).length },
            { key: "understanding", label: "Editor understanding", href: "?tab=understanding", dot: manager && pendingResponse },
            { key: "storyboard", label: "Storyboard", href: "?tab=storyboard", dot: manager && pendingStoryboard },
            { key: "sessions", label: "Work sessions", href: "?tab=sessions", count: ws.sessions.length || null },
            { key: "submissions", label: "Submissions", href: "?tab=submissions", count: ws.submissions.length || null, dot: manager && pendingSubmission },
            { key: "revisions", label: "Revisions", href: "?tab=revisions", count: ws.revisions.length || null, dot: isAssignee && openRevisions > 0 },
            { key: "activity", label: "Activity", href: "?tab=activity" },
          ]}
        />
        {tab === "overview" && <OverviewTab {...ctx} />}
        {tab === "brief" && <BriefTab {...ctx} />}
        {tab === "materials" && <MaterialsTab {...ctx} />}
        {tab === "understanding" && <UnderstandingTab {...ctx} />}
        {tab === "storyboard" && <StoryboardTab {...ctx} />}
        {tab === "sessions" && <SessionsTab {...ctx} />}
        {tab === "submissions" && <SubmissionsTab {...ctx} />}
        {tab === "revisions" && <RevisionsTab {...ctx} />}
        {tab === "activity" && <ActivityTab {...ctx} />}
      </div>
    </div>
  );
}

function StageTracker({ status, holdFrom }: { status: ProjectWorkspace["project"]["status"]; holdFrom: ProjectWorkspace["project"]["status"] | null }) {
  const effective = status === "on_hold" && holdFrom ? holdFrom : status;
  const stage = STATUS_META[effective].stage;
  if (status === "cancelled") return null;
  const currentLabel = PRODUCTION_STAGES[Math.min(Math.max(stage, 0), PRODUCTION_STAGES.length - 1)];
  return (
    <div>
    <p className="mb-2 text-xs text-ink-muted sm:hidden">
      Stage {Math.max(stage, 0) + 1} of {PRODUCTION_STAGES.length}: <span className="font-medium text-ink">{currentLabel}</span>
      {status === "on_hold" && " (on hold)"}
    </p>
    <ol className="grid grid-cols-7 gap-1.5" aria-label="Production stage">
      {PRODUCTION_STAGES.map((label, i) => {
        const state = stage > i ? "done" : stage === i ? "current" : "todo";
        return (
          <li key={label} className="min-w-0" aria-current={state === "current" ? "step" : undefined}>
            <div
              className={cn(
                "h-1.5 rounded-full",
                state === "done" && "bg-navy-800",
                state === "current" && (status === "on_hold" ? "bg-ink-subtle" : status === "revision_requested" ? "bg-danger" : "bg-accent"),
                state === "todo" && "bg-line",
              )}
            />
            <p className={cn("mt-1.5 hidden truncate text-[11px] sm:block", state === "todo" ? "text-ink-subtle" : "font-medium text-ink")}>{label}</p>
          </li>
        );
      })}
    </ol>
    </div>
  );
}

function NextStep({ ws, people, profile, manager, isAssignee }: { ws: ProjectWorkspace; people: PersonMap; profile: Profile; manager: boolean; isAssignee: boolean }) {
  const p = ws.project;
  const editor = p.assigned_editor_id ? people[p.assigned_editor_id]?.name ?? "The editor" : "An editor";
  const latestResponse = ws.responses[0];
  const pendingStoryboard = ws.storyboards.find((s) => s.status === "pending");
  const openRevision = ws.revisions.find((r) => !r.resolved_at);
  const latestSub = ws.submissions[0];

  let msg: { title: string; body?: string; tab?: string; cta?: string; tone: "action" | "wait" | "done" } | null = null;

  switch (p.status) {
    case "draft":
      if (manager) msg = { title: "Draft — not visible to editors", body: p.deadline ? "Review the brief and materials, then publish." : "Set a deadline, then publish.", tone: "action" };
      break;
    case "available":
      msg = manager
        ? { title: "Waiting for an editor to claim this project", body: "You can also assign an editor directly from the actions menu.", tone: "wait" }
        : { title: "Open to claim", body: "Read the brief and materials. Claim it if you can deliver by the deadline.", tab: "brief", cta: "Read the brief", tone: "action" };
      break;
    case "claimed":
      if (isAssignee)
        msg = latestResponse?.status === "clarification_requested" && latestResponse.editor_id === profile.id
          ? { title: "Clarification requested", body: latestResponse.review_note ?? undefined, tab: "understanding", cta: "Update your understanding", tone: "action" }
          : { title: "Submit your understanding of the brief", body: "Production starts after the dispatcher approves it.", tab: "understanding", cta: "Write understanding", tone: "action" };
      else if (manager) msg = { title: `Waiting for ${editor}'s understanding of the brief`, tone: "wait" };
      break;
    case "awaiting_confirmation":
      msg = manager
        ? { title: `Review ${editor}'s understanding`, body: latestResponse?.questions ? "The editor included questions for you." : undefined, tab: "understanding", cta: "Review now", tone: "action" }
        : { title: "Waiting for the dispatcher to confirm your understanding", tone: "wait" };
      break;
    case "awaiting_storyboard_approval":
      if (pendingStoryboard)
        msg = manager
          ? { title: `Review storyboard v${pendingStoryboard.version}`, tab: "storyboard", cta: "Review storyboard", tone: "action" }
          : { title: "Storyboard submitted — waiting for approval", tone: "wait" };
      else
        msg = isAssignee
          ? { title: ws.storyboards.length ? "Storyboard changes requested — upload a revised version" : "Upload your storyboard for approval", tab: "storyboard", cta: "Go to storyboard", tone: "action" }
          : { title: `Waiting for ${editor} to upload the storyboard`, tone: "wait" };
      break;
    case "ready_to_start":
      msg = isAssignee
        ? { title: "Approved — you can start production", body: "Starting the timer moves the project to In progress.", tone: "action" }
        : { title: `Approved — waiting for ${editor} to start production`, tone: "wait" };
      break;
    case "in_progress":
      msg = isAssignee
        ? { title: "In production", body: "When the edit is ready, submit the Google Drive link.", tab: "submissions", cta: "Submit work", tone: "action" }
        : { title: `${editor} is working on this project`, tone: "wait" };
      break;
    case "submitted":
    case "dispatcher_review":
      msg = manager
        ? { title: `Review delivery #${latestSub?.sequence ?? ""}`, body: "Open the Drive link, compare it with the brief, then approve or request a revision.", tab: "submissions", cta: "Open review", tone: "action" }
        : { title: p.status === "submitted" ? "Submitted — waiting for review" : "The dispatcher is reviewing your delivery", tone: "wait" };
      break;
    case "revision_requested":
      msg = isAssignee
        ? { title: "Revision requested", body: openRevision?.reason, tab: "submissions", cta: "Resubmit", tone: "action" }
        : { title: `Waiting for ${editor}'s revised delivery`, body: openRevision?.reason, tone: "wait" };
      break;
    case "completed":
      msg = { title: "Completed", body: `Final delivery approved ${formatDateTime(p.completed_at, profile.timezone)}.`, tone: "done" };
      break;
    case "on_hold":
      msg = { title: "On hold", body: "Work is paused. A dispatcher can resume the project.", tone: "wait" };
      break;
    case "cancelled":
      msg = { title: "Cancelled", body: `Cancelled ${formatDateTime(p.cancelled_at, profile.timezone)}. The full history is kept.`, tone: "done" };
      break;
  }
  if (!msg) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-(--radius-card) border px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        msg.tone === "action" && "border-accent/25 bg-accent-soft",
        msg.tone === "wait" && "border-line bg-surface",
        msg.tone === "done" && "border-[#c9ecdc] bg-success-soft",
      )}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-muted uppercase">{msg.tone === "action" ? "Next step" : msg.tone === "wait" ? "Status" : "Outcome"}</p>
        <p className="mt-0.5 text-sm font-semibold">{msg.title}</p>
        {msg.body && <p className="mt-0.5 line-clamp-3 text-[13px] whitespace-pre-wrap text-ink-muted">{msg.body}</p>}
      </div>
      {msg.tab && msg.cta && (
        <Link
          href={`?tab=${msg.tab}`}
          scroll={false}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 sm:self-auto"
        >
          {msg.cta} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
