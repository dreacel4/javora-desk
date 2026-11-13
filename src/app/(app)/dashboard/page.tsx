import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertOctagon,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileStack,
  Inbox,
  Layers,
  PlayCircle,
  RotateCcw,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getDashboard, getPeople } from "@/lib/queries";
import { STATUS_META } from "@/lib/status";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requestTime } from "@/lib/server-time";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/projects/badges";
import { DeadlineCountdown } from "@/components/projects/deadline";
import { ActivityList } from "@/components/workspace/tabs";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({
  label,
  value,
  icon: Icon,
  href,
  tone = "default",
  hint,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  href: string;
  tone?: "default" | "warning" | "danger" | "success" | "accent";
  hint?: string;
}) {
  const ring = {
    default: "bg-navy-50 text-navy-700",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-(--radius-card) border border-line bg-surface p-4 shadow-(--shadow-card) transition-all hover:-translate-y-px hover:border-navy-200 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-ink-muted">{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", ring)}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className={cn("text-[28px] leading-none font-semibold tracking-tight tabular", value > 0 && tone === "danger" && "text-danger")}>{value}</p>
        <ArrowUpRight className="size-4 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="-mt-1 min-h-4 truncate text-xs text-ink-subtle">{hint ?? "\u00a0"}</p>
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const [{ stats, activity, upcoming, attention, weekSessions }, people] = await Promise.all([getDashboard(profile), getPeople()]);
  const manager = profile.role !== "editor";
  const firstName = (profile.full_name || "").split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: profile.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const s = (k: keyof typeof stats) => Number(stats[k] ?? 0);
  const serverNow = requestTime();

  const weekSeconds = weekSessions.reduce((sum, x) => sum + (x.active_seconds ?? 0), 0);
  const running = weekSessions.find((x) => x.status === "active");

  return (
    <>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        description={manager ? "Here's where production stands across the workspace." : "Your projects, open work and what needs your attention."}
        actions={
          manager ? (
            <ButtonLink href="/projects?view=review" variant="secondary" icon={<ClipboardCheck className="size-4" />}>
              Review queue
            </ButtonLink>
          ) : (
            <ButtonLink href="/projects?view=available" icon={<Inbox className="size-4" />}>
              Browse available
            </ButtonLink>
          )
        }
      />

      {sp.welcome === "1" && (
        <Alert tone="success" title="Your password is set" className="mb-6">
          Welcome to JAVORA DESK. {manager ? "Start by creating a project." : "New projects appear under Available."}
        </Alert>
      )}

      <section aria-label="Production statistics" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Stat label="Active projects" value={s("active")} icon={Layers} href="/projects" hint="Published, not yet closed" />
        <Stat label="Available" value={s("available")} icon={Inbox} href="/projects?view=available" tone="accent" hint="Open to claim" />
        <Stat label="In production" value={s("in_progress")} icon={PlayCircle} href="/projects?view=in_progress&status=in_progress" hint="Editor actively working" />
        <Stat label="Overdue" value={s("overdue")} icon={AlertOctagon} href="/projects?sort=deadline" tone="danger" hint="Past deadline, not done" />
        <Stat label="Storyboards pending" value={s("pending_storyboard")} icon={FileStack} href="/projects?status=awaiting_storyboard_approval" tone="warning" hint={manager ? "Awaiting approval" : "Yours awaiting approval"} />
        <Stat label="Submissions pending" value={s("pending_submissions")} icon={ClipboardCheck} href="/projects?view=review" tone="warning" hint="Waiting for review" />
        <Stat label="Revisions required" value={s("revision_requested")} icon={RotateCcw} href="/projects?view=revision" tone="danger" hint="Awaiting resubmission" />
        <Stat label="Completed" value={s("completed")} icon={CheckCircle2} href="/projects?view=completed" tone="success" hint="Final delivery approved" />
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title={manager ? "Needs your decision" : "Your active work"}
              description={manager ? "Confirmations, storyboards and deliveries waiting on a dispatcher — oldest first." : "Projects assigned to you that need action."}
            />
            {attention.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title={manager ? "Nothing is waiting on you" : "No active assignments"}
                description={manager ? "New confirmations, storyboards and submissions will appear here." : "Claim an available project to get started."}
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-line">
                {attention.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-navy-50/60 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          <span className="tabular">{p.internal_ref}</span>
                          {p.assigned_editor_id && ` · ${people[p.assigned_editor_id]?.name ?? "Editor"}`} · {STATUS_META[p.status].hint}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-3">
                        <PriorityBadge priority={p.priority} compact />
                        <StatusBadge status={p.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Upcoming deadlines" description="Open projects ordered by deadline." action={<Link href="/projects" className="text-[13px] font-medium text-accent hover:underline">All projects →</Link>} />
            {upcoming.length === 0 ? (
              <EmptyState title="No upcoming deadlines" className="py-10" />
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 hover:bg-navy-50/60">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {p.client_name} · {STATUS_META[p.status].label}
                          {p.assigned_editor_id ? ` · ${people[p.assigned_editor_id]?.name ?? ""}` : ""}
                        </p>
                      </div>
                      <DeadlineCountdown deadline={p.deadline} timeZone={profile.timezone} showDate serverNow={serverNow} className="text-right" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {!manager && (
            <Card>
              <CardBody className="flex items-center gap-4">
                <span className={cn("grid size-11 place-items-center rounded-xl", running ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-700")}>
                  <Timer className={cn("size-5", running && "animate-pulse")} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-ink-muted">Logged in the last 7 days</p>
                  <p className="text-xl font-semibold tabular">{formatDuration(weekSeconds)}</p>
                  {running?.project_id && (
                    <Link href={`/projects/${running.project_id}`} className="text-xs font-medium text-accent hover:underline">
                      Timer running — open project →
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Recent activity"
              action={manager ? <Link href="/activity" className="text-[13px] font-medium text-accent hover:underline">Full log →</Link> : undefined}
            />
            <CardBody>
              <ActivityList items={activity} people={people} timeZone={profile.timezone} compact />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
