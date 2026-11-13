import Link from "next/link";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  Link2,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import type { PersonMap, ProjectWorkspace } from "@/lib/queries";
import type { Profile } from "@/lib/types";
import { describeActivity, activityTone } from "@/lib/activity";
import { formatDateTime, formatDuration, formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Alert, Avatar, Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, Prose } from "@/components/ui/primitives";
import { FileLink } from "./file-upload";
import {
  AddMaterial,
  BriefEditor,
  RemoveAssetButton,
  StoryboardForm,
  StoryboardReview,
  SubmissionForm,
  SubmissionReview,
  UnderstandingForm,
  UnderstandingReview,
} from "./forms";

type Ctx = { ws: ProjectWorkspace; people: PersonMap; profile: Profile; manager: boolean; isAssignee: boolean };
const name = (people: PersonMap, id: string | null | undefined) => (id ? people[id]?.name ?? "Former member" : "—");

function Meta({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-muted">{children}</p>;
}

/* =========================================================================== */
/* Overview                                                                    */
/* =========================================================================== */
export function OverviewTab({ ws, people, profile }: Ctx) {
  const p = ws.project;
  const brief = ws.briefs[0];
  const tz = profile.timezone;
  const totalSeconds = ws.sessions.reduce((s, x) => s + (x.active_seconds ?? 0), 0);
  const byEditor = new Map<string, number>();
  for (const s of ws.sessions) if (s.editor_id) byEditor.set(s.editor_id, (byEditor.get(s.editor_id) ?? 0) + (s.active_seconds ?? 0));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHeader title="Project details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Client", value: `${p.client_name} · ${p.client_platform}` },
                { label: "Internal ID", value: <span className="font-mono text-[13px]">{p.internal_ref}</span> },
                { label: "Created by", value: `${name(people, p.created_by)} · ${formatDateTime(p.created_at, tz)}` },
                { label: "Published", value: p.published_at ? formatDateTime(p.published_at, tz) : "Not yet published" },
                { label: "Deadline", value: formatDateTime(p.deadline, tz) },
                { label: "Storyboard", value: p.storyboard_required ? "Approval required" : "Not required" },
              ]}
            />
            {p.description && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-1 text-xs font-medium text-ink-muted">Description</p>
                <Prose>{p.description}</Prose>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Output specifications" description="What the final export must match." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line sm:grid-cols-5">
              {[
                ["Resolution", p.output_resolution],
                ["Aspect ratio", p.aspect_ratio],
                ["Frame rate", p.frame_rate ? `${p.frame_rate} fps` : ""],
                ["Duration", p.required_duration],
                ["Format", p.delivery_format],
              ].map(([k, v], i) => (
                <div key={k} className={cn("bg-surface px-4 py-3", i === 4 && "col-span-2 sm:col-span-1")}>
                  <dt className="text-[11px] font-medium text-ink-muted">{k}</dt>
                  <dd className="mt-1 truncate text-sm font-medium" title={v}>{v || <span className="text-ink-subtle">—</span>}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        {brief && (
          <Card>
            <CardHeader
              title="Current brief"
              description={`Version ${brief.version}${brief.version > 1 ? ` · updated ${formatRelative(brief.created_at)}` : " · original"}`}
              action={
                <Link href="?tab=brief" scroll={false} className="text-[13px] font-medium text-accent hover:underline">
                  Full brief →
                </Link>
              }
            />
            <CardBody>
              <Prose className="line-clamp-[8]">{brief.original_client_brief}</Prose>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Team" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={p.assigned_editor_id ? name(people, p.assigned_editor_id) : null} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.assigned_editor_id ? name(people, p.assigned_editor_id) : p.planned_editor_id ? `${name(people, p.planned_editor_id)} (planned)` : "Unassigned"}</p>
                <Meta>Editor</Meta>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Avatar name={name(people, p.created_by)} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{name(people, p.created_by)}</p>
                <Meta>Dispatcher</Meta>
              </div>
            </div>
            {ws.assignments.length > 1 && (
              <p className="border-t border-line pt-3 text-xs text-ink-muted">
                {ws.assignments.length} assignments in history ·{" "}
                <Link href="?tab=activity" scroll={false} className="text-accent hover:underline">view</Link>
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Working time" description="Logged in work sessions (not a quality measure)." />
          <CardBody>
            <p className="text-2xl font-semibold tracking-tight tabular">{formatDuration(totalSeconds)}</p>
            <Meta>{ws.sessions.length} session{ws.sessions.length === 1 ? "" : "s"}{profile.role === "editor" ? " (yours)" : ""}</Meta>
            {byEditor.size > 1 && (
              <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
                {[...byEditor].map(([id, secs]) => (
                  <li key={id} className="flex justify-between gap-2">
                    <span className="truncate">{name(people, id)}</span>
                    <span className="text-ink-muted tabular">{formatDuration(secs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Latest activity"
            action={<Link href="?tab=activity" scroll={false} className="text-[13px] font-medium text-accent hover:underline">All →</Link>}
          />
          <CardBody>
            <ActivityList items={ws.activity.slice(0, 5)} people={people} timeZone={tz} compact />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* =========================================================================== */
/* Brief                                                                       */
/* =========================================================================== */
export function BriefTab({ ws, people, profile, manager }: Ctx) {
  const [current, ...older] = ws.briefs;
  const closed = ["completed", "cancelled"].includes(ws.project.status);
  if (!current) return <Card><EmptyState title="No brief recorded" /></Card>;
  const original = ws.briefs[ws.briefs.length - 1];

  const renderBrief = (b: typeof current) => (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">Client brief</p>
        <div className="rounded-xl border border-line bg-canvas/60 p-4">
          <Prose>{b.original_client_brief}</Prose>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">Editing requirements</p>
        <Prose>{b.editing_requirements}</Prose>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">Additional instructions</p>
        <Prose>{b.additional_instructions}</Prose>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Brief <Badge tone="navy">v{current.version}</Badge>
              {current.version === 1 && <Badge tone="success">Original</Badge>}
            </span>
          }
          description={`${current.version === 1 ? "Recorded" : "Published"} by ${name(people, current.created_by)} · ${formatDateTime(current.created_at, profile.timezone)}`}
          action={manager && !closed && <BriefEditor projectId={ws.project.id} isDraft={ws.project.status === "draft"} current={current} />}
        />
        <CardBody>
          {current.change_note && current.version > 1 && (
            <Alert tone="info" title="What changed in this version" className="mb-5">
              {current.change_note}
            </Alert>
          )}
          {renderBrief(current)}
        </CardBody>
      </Card>

      {older.length > 0 && (
        <Card>
          <CardHeader title="Version history" description="Earlier versions are preserved exactly as they were published." />
          <div className="divide-y divide-line">
            {older.map((b) => (
              <details key={b.id} className="group px-5 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <History className="size-4 text-ink-muted" />
                    <span className="font-medium">Version {b.version}</span>
                    {b.id === original.id && <Badge tone="success">Original client brief</Badge>}
                  </span>
                  <span className="text-xs text-ink-muted">{formatDateTime(b.created_at, profile.timezone)}</span>
                </summary>
                <div className="mt-4 pb-2">
                  {b.change_note && b.version > 1 && <p className="mb-4 text-[13px] text-ink-muted">Change note: {b.change_note}</p>}
                  {renderBrief(b)}
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* =========================================================================== */
/* Materials & references                                                      */
/* =========================================================================== */
export function MaterialsTab({ ws, people, profile, manager }: Ctx) {
  const active = ws.assets.filter((a) => !a.removed_at);
  const removed = ws.assets.filter((a) => a.removed_at);
  const fileByPath = new Map(ws.files.map((f) => [f.storage_path, f]));
  const closed = ["completed", "cancelled"].includes(ws.project.status);

  const renderGroup = (kind: "raw_material" | "reference", title: string, description: string) => {
    const items = active.filter((a) => a.kind === kind);
    return (
      <Card>
        <CardHeader title={title} description={description} action={kind === "raw_material" && manager && !closed ? <AddMaterial projectId={ws.project.id} /> : undefined} />
        {items.length === 0 ? (
          <EmptyState title={`No ${kind === "raw_material" ? "raw materials" : "references"} yet`} className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const file = a.storage_path ? fileByPath.get(a.storage_path) : undefined;
              return (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-600">
                    {a.url ? <Link2 className="size-4" /> : <FileText className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.label}</p>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[13px] text-accent hover:underline">
                        <span className="truncate">{a.url}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    )}
                    {a.storage_path && <div className="mt-1.5"><FileLink path={a.storage_path} name={file?.file_name ?? a.label} size={file?.size_bytes} /></div>}
                    {a.notes && <p className="mt-1 text-[13px] text-ink-muted">{a.notes}</p>}
                    <Meta>Added by {name(people, a.created_by)} · {formatRelative(a.created_at)}</Meta>
                  </div>
                  {manager && !closed && <RemoveAssetButton assetId={a.id} label={a.label} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {renderGroup("raw_material", "Raw materials", "Footage, audio, graphics and documents from the client.")}
      {renderGroup("reference", "References", "Style, pacing and example videos.")}
      {manager && !closed && active.length > 0 && (
        <p className="-mt-2 text-xs text-ink-muted">Use “Add material” above for both materials and references.</p>
      )}
      {removed.length > 0 && (
        <details className="text-[13px] text-ink-muted">
          <summary className="cursor-pointer">{removed.length} removed item{removed.length > 1 ? "s" : ""}</summary>
          <ul className="mt-2 flex flex-col gap-1 pl-4">
            {removed.map((a) => (
              <li key={a.id} className="line-through">
                {a.label} — removed {formatDateTime(a.removed_at, profile.timezone)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* =========================================================================== */
/* Editor understanding                                                        */
/* =========================================================================== */
const RESPONSE_LABELS: [keyof ProjectWorkspace["responses"][number], string][] = [
  ["materials_description", "Received materials"],
  ["requirements_understanding", "Client requirements"],
  ["editing_approach", "Editing approach"],
  ["visual_sequence", "Visual sequence"],
  ["expected_deliverables", "Expected deliverables"],
  ["missing_assets", "Missing assets / unclear instructions"],
  ["questions", "Questions for the dispatcher"],
];

export function UnderstandingTab({ ws, people, profile, manager, isAssignee }: Ctx) {
  const p = ws.project;
  const latest = ws.responses[0];
  const canSubmit = isAssignee && p.status === "claimed";
  const statusBadge = (s: string) =>
    ({ pending: <Badge tone="violet">Awaiting review</Badge>, approved: <Badge tone="success">Approved</Badge>, clarification_requested: <Badge tone="warning">Clarification requested</Badge>, superseded: <Badge>Superseded</Badge> })[s];

  return (
    <div className="flex flex-col gap-5">
      {canSubmit && (
        <Card>
          <CardHeader
            title={latest?.status === "clarification_requested" ? "Resubmit your understanding" : "Submit your understanding of the brief"}
            description="Production cannot start until the dispatcher approves this. Read the brief and materials first."
          />
          <CardBody>
            {latest?.status === "clarification_requested" && latest.editor_id === profile.id && (
              <Alert tone="warning" title="The dispatcher asked for clarification" className="mb-5">
                {latest.review_note}
              </Alert>
            )}
            <UnderstandingForm projectId={p.id} previous={latest?.editor_id === profile.id ? latest : null} />
          </CardBody>
        </Card>
      )}

      {ws.responses.length === 0 && !canSubmit && (
        <Card>
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="No understanding submitted yet"
            description={p.assigned_editor_id ? `${name(people, p.assigned_editor_id)} has not submitted their understanding.` : "An editor submits this after claiming the project."}
          />
        </Card>
      )}

      {ws.responses.map((r) => {
        const files = ws.files.filter((f) => f.editor_response_id === r.id);
        const reviewable = manager && r.status === "pending" && p.status === "awaiting_confirmation";
        return (
          <Card key={r.id} className={cn(reviewable && "ring-2 ring-violet/30")}>
            <CardHeader
              title={<span className="flex flex-wrap items-center gap-2">Version {r.version} {statusBadge(r.status)}</span>}
              description={`${name(people, r.editor_id)} · ${formatDateTime(r.submitted_at, profile.timezone)} · based on brief v${r.brief_version}`}
              action={reviewable && <UnderstandingReview responseId={r.id} />}
            />
            <CardBody className="flex flex-col gap-4">
              {r.brief_version < p.current_brief_version && r.status !== "superseded" && (
                <Alert tone="warning">The brief has changed since this was written (now v{p.current_brief_version}).</Alert>
              )}
              {RESPONSE_LABELS.map(([k, label]) => {
                const value = r[k] as string;
                if (!value && (k === "missing_assets" || k === "questions")) return null;
                return (
                  <div key={k}>
                    <p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
                    <Prose className={k === "questions" ? "rounded-lg bg-warning-soft/60 p-3" : undefined}>{value}</Prose>
                  </div>
                );
              })}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((f) => <FileLink key={f.id} path={f.storage_path} name={f.file_name} size={f.size_bytes} />)}
                </div>
              )}
              {r.reviewed_at && (
                <div className="rounded-lg border border-line bg-canvas/60 px-4 py-3 text-[13px]">
                  <p className="font-medium">
                    {r.status === "approved" ? "Approved" : "Clarification requested"} by {name(people, r.reviewed_by)} · {formatDateTime(r.reviewed_at, profile.timezone)}
                  </p>
                  {r.review_note && <p className="mt-1 whitespace-pre-wrap text-ink-muted">{r.review_note}</p>}
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/* =========================================================================== */
/* Storyboard                                                                  */
/* =========================================================================== */
export function StoryboardTab({ ws, people, profile, manager, isAssignee }: Ctx) {
  const p = ws.project;
  if (!p.storyboard_required && ws.storyboards.length === 0) {
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 className="size-5" />} title="No storyboard required" description="This project goes straight to production after the editor's understanding is approved." />
      </Card>
    );
  }
  const hasPending = ws.storyboards.some((s) => s.status === "pending");
  const canSubmit = isAssignee && p.status === "awaiting_storyboard_approval" && !hasPending;
  const lastChanges = ws.storyboards.find((s) => s.status === "changes_requested");
  const lastChangesComment = lastChanges ? ws.storyboardReviews.filter((r) => r.storyboard_id === lastChanges.id && r.decision === "changes_requested").at(-1) : undefined;

  const sbBadge = (s: string) =>
    ({ pending: <Badge tone="violet">Awaiting approval</Badge>, approved: <Badge tone="success">Approved</Badge>, changes_requested: <Badge tone="warning">Changes requested</Badge>, superseded: <Badge>Superseded</Badge> })[s];

  return (
    <div className="flex flex-col gap-5">
      {canSubmit && (
        <Card>
          <CardHeader title={ws.storyboards.length ? "Upload a revised storyboard" : "Upload your storyboard"} description="The dispatcher approves it before production starts." />
          <CardBody>
            {lastChangesComment && (
              <Alert tone="warning" title="Requested changes" className="mb-5">
                {lastChangesComment.comment}
              </Alert>
            )}
            <StoryboardForm projectId={p.id} />
          </CardBody>
        </Card>
      )}
      {ws.storyboards.length === 0 && !canSubmit && (
        <Card>
          <EmptyState
            title="No storyboard yet"
            description={
              p.status === "awaiting_storyboard_approval"
                ? `Waiting for ${name(people, p.assigned_editor_id)} to upload the storyboard.`
                : "The editor uploads a storyboard after their understanding is approved."
            }
          />
        </Card>
      )}
      {ws.storyboards.map((s) => {
        const files = ws.files.filter((f) => f.storyboard_id === s.id);
        const reviews = ws.storyboardReviews.filter((r) => r.storyboard_id === s.id);
        return (
          <Card key={s.id} className={cn(manager && s.status === "pending" && "ring-2 ring-violet/30")}>
            <CardHeader
              title={<span className="flex flex-wrap items-center gap-2">Storyboard v{s.version} {sbBadge(s.status)}</span>}
              description={`${name(people, s.editor_id)} · ${formatDateTime(s.submitted_at, profile.timezone)}`}
              action={manager && s.status !== "superseded" && <StoryboardReview storyboardId={s.id} pending={s.status === "pending" && p.status === "awaiting_storyboard_approval"} />}
            />
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {files.map((f) => <FileLink key={f.id} path={f.storage_path} name={f.file_name} size={f.size_bytes} />)}
                {files.length === 0 && <p className="text-[13px] text-ink-muted">Files are visible to the dispatcher and the editor who uploaded them.</p>}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Description</p>
                <Prose>{s.description}</Prose>
              </div>
              {s.sequence_notes && (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Sequence notes</p>
                  <Prose>{s.sequence_notes}</Prose>
                </div>
              )}
              {reviews.length > 0 && (
                <ol className="flex flex-col gap-2 border-t border-line pt-4">
                  {reviews.map((r) => (
                    <li key={r.id} className="flex gap-3 text-[13px]">
                      <Avatar name={name(people, r.reviewer_id)} size="sm" />
                      <div className="min-w-0">
                        <p>
                          <span className="font-medium">{name(people, r.reviewer_id)}</span>{" "}
                          <span className="text-ink-muted">
                            {r.decision === "approved" ? "approved" : r.decision === "changes_requested" ? "requested changes" : "commented"} · {formatRelative(r.created_at)}
                          </span>
                        </p>
                        {r.comment && <p className="mt-0.5 whitespace-pre-wrap">{r.comment}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/* =========================================================================== */
/* Work sessions                                                               */
/* =========================================================================== */
export function SessionsTab({ ws, people, profile, manager }: Ctx) {
  const tz = profile.timezone;
  if (ws.sessions.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Clock3 className="size-5" />} title="No work sessions yet" description="Sessions appear here once the editor starts the timer." />
      </Card>
    );
  }
  const total = ws.sessions.reduce((s, x) => s + (x.active_seconds ?? 0), 0);
  return (
    <Card>
      <CardHeader
        title="Session history"
        description={`${formatDuration(total)} logged across ${ws.sessions.length} session${ws.sessions.length > 1 ? "s" : ""}${manager ? "" : " (only your sessions are shown)"}. Working time is context, not a productivity score.`}
      />
      <ul className="divide-y divide-line">
        {ws.sessions.map((s) => {
          const intervals = ws.intervals.filter((i) => i.session_id === s.id);
          return (
            <li key={s.id ?? ""} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Avatar name={name(people, s.editor_id)} size="sm" />
                  <div>
                    <p className="text-sm font-medium">{name(people, s.editor_id)}</p>
                    <Meta>
                      {formatDateTime(s.started_at, tz)}
                      {s.ended_at ? ` → ${formatTime(s.ended_at, tz)}` : ""}
                      {s.end_reason && s.end_reason !== "stopped" ? ` · ended: ${s.end_reason.replace(/_/g, " ")}` : ""}
                    </Meta>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {s.status === "active" && <Badge tone="success" dot>Running</Badge>}
                  {s.status === "paused" && <Badge tone="warning">Paused</Badge>}
                  <span className="text-sm font-semibold tabular">{formatDuration(s.active_seconds)}</span>
                </div>
              </div>
              {intervals.length > 1 && (
                <details className="mt-2 pl-9 text-xs text-ink-muted">
                  <summary className="cursor-pointer">{intervals.length} intervals</summary>
                  <ul className="mt-1.5 flex flex-col gap-1 tabular">
                    {intervals.map((i) => (
                      <li key={i.id}>
                        {formatTime(i.started_at, tz)} – {i.ended_at ? formatTime(i.ended_at, tz) : "now"}
                        {i.end_reason === "inactive" && " (auto-paused)"}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* =========================================================================== */
/* Submissions + review                                                        */
/* =========================================================================== */
export function SubmissionsTab({ ws, people, profile, manager, isAssignee }: Ctx) {
  const p = ws.project;
  const tz = profile.timezone;
  const canSubmit = isAssignee && (p.status === "in_progress" || p.status === "revision_requested");
  const openRevision = ws.revisions.find((r) => !r.resolved_at);
  const latest = ws.submissions[0];
  const brief = ws.briefs[0];

  const subBadge = (s: string) =>
    ({ submitted: <Badge tone="warning">Awaiting review</Badge>, under_review: <Badge tone="warning">In review</Badge>, approved: <Badge tone="success">Approved</Badge>, revision_requested: <Badge tone="danger">Revision requested</Badge> })[s];

  return (
    <div className="flex flex-col gap-5">
      {canSubmit && (
        <Card>
          <CardHeader title="Submit your work" description="Share the final export via Google Drive. Each submission is kept as a separate version." />
          <CardBody>
            <SubmissionForm
              projectId={p.id}
              nextVersion={(latest?.sequence ?? 0) + 1}
              openRevisionReason={openRevision?.reason}
              defaults={{ export_resolution: p.output_resolution, aspect_ratio: p.aspect_ratio, frame_rate: p.frame_rate, export_format: p.delivery_format }}
            />
          </CardBody>
        </Card>
      )}

      {ws.submissions.length === 0 && !canSubmit && (
        <Card>
          <EmptyState icon={<FileText className="size-5" />} title="No submissions yet" description="The editor submits a Google Drive link when the edit is ready." />
        </Card>
      )}

      {ws.submissions.map((s) => {
        const review = ws.submissionReviews.find((r) => r.submission_id === s.id);
        const revision = ws.revisions.find((r) => r.submission_id === s.id);
        const reviewable = manager && s.id === latest?.id && (p.status === "submitted" || p.status === "dispatcher_review");
        const specs: [string, string, string][] = [
          ["Resolution", s.export_resolution, p.output_resolution],
          ["Aspect ratio", s.aspect_ratio, p.aspect_ratio],
          ["Frame rate", s.frame_rate, p.frame_rate],
          ["Format", s.export_format, p.delivery_format],
        ];
        return (
          <Card key={s.id} className={cn(reviewable && "ring-2 ring-warning/40")}>
            <CardHeader
              title={<span className="flex flex-wrap items-center gap-2">Delivery #{s.sequence} · {s.version_label} {subBadge(s.status)}</span>}
              description={`${name(people, s.editor_id)} · ${formatDateTime(s.submitted_at, tz)} · against brief v${s.brief_version}`}
              action={reviewable && <SubmissionReview projectId={p.id} submissionId={s.id} projectStatus={p.status} />}
            />
            <CardBody className="flex flex-col gap-5">
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.file_name}</p>
                  <p className="truncate text-xs text-ink-muted">{s.drive_url}</p>
                </div>
                <a href={s.drive_url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-navy-800">
                  Open in Drive <ExternalLink className="size-3.5" />
                </a>
              </div>
              {manager && <p className="-mt-3 text-xs text-ink-muted">If Drive asks for access, request it from the editor — the link&apos;s sharing settings are controlled in Google Drive.</p>}

              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Export vs. brief</p>
                <div className="overflow-hidden rounded-xl ring-1 ring-line">
                  <table className="w-full text-[13px]">
                    <thead className="bg-canvas text-xs text-ink-muted">
                      <tr><th className="px-3 py-2 text-left font-medium">Spec</th><th className="px-3 py-2 text-left font-medium">Delivered</th><th className="px-3 py-2 text-left font-medium">Brief</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {specs.map(([k, got, want]) => {
                        const mismatch = want && got.replace(/\s|fps/gi, "").toLowerCase() !== want.replace(/\s|fps/gi, "").toLowerCase();
                        return (
                          <tr key={k}>
                            <td className="px-3 py-2 text-ink-muted">{k}</td>
                            <td className={cn("px-3 py-2 font-medium", mismatch && "text-warning")}>{got}{mismatch && " ⚠"}</td>
                            <td className="px-3 py-2">{want || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Work summary</p><Prose>{s.work_summary}</Prose></div>
                  <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Completed requirements</p><Prose>{s.completed_requirements}</Prose></div>
                  {s.deviations && <div><p className="mb-1 text-xs font-semibold tracking-wide text-warning uppercase">Deviations from the brief</p><Prose>{s.deviations}</Prose></div>}
                  {s.notes && <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Notes</p><Prose>{s.notes}</Prose></div>}
                </div>
                {manager && brief && reviewable && (
                  <div className="rounded-xl border border-line bg-canvas/60 p-4">
                    <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Compare with brief v{brief.version}</p>
                    <Prose className="max-h-80 overflow-y-auto text-[13px]">{[brief.original_client_brief, brief.editing_requirements].filter(Boolean).join("\n\n— Editing requirements —\n")}</Prose>
                  </div>
                )}
              </div>

              {review && (
                <div className={cn("rounded-lg border px-4 py-3 text-[13px]", review.decision === "approved" ? "border-[#c9ecdc] bg-success-soft" : "border-[#f5d0d0] bg-danger-soft")}>
                  <p className="font-medium">
                    {review.decision === "approved" ? "Approved" : "Revision requested"} by {name(people, review.reviewer_id)} · {formatDateTime(review.created_at, tz)}
                  </p>
                  {revision && <p className="mt-1 whitespace-pre-wrap"><span className="font-medium">Reason:</span> {revision.reason}</p>}
                  {review.notes && <p className="mt-1 whitespace-pre-wrap">{review.notes}</p>}
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/* =========================================================================== */
/* Revisions                                                                   */
/* =========================================================================== */
export function RevisionsTab({ ws, people, profile }: Ctx) {
  if (ws.revisions.length === 0) {
    return (
      <Card>
        <EmptyState icon={<RotateCcw className="size-5" />} title="No revisions requested" description="Revision requests from submission reviews appear here with their resolution." />
      </Card>
    );
  }
  const seq = (id: string | null) => ws.submissions.find((s) => s.id === id)?.sequence;
  return (
    <Card>
      <CardHeader title="Revision requests" description="Every request is kept with the delivery it applied to and the delivery that resolved it." />
      <ol className="divide-y divide-line">
        {ws.revisions.map((r, i) => (
          <li key={r.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Revision {ws.revisions.length - i} · on delivery #{seq(r.submission_id)}
              </p>
              {r.resolved_at ? <Badge tone="success">Resolved by delivery #{seq(r.resolved_by_submission_id)}</Badge> : <Badge tone="danger">Open</Badge>}
            </div>
            <Meta>Requested by {name(people, r.requested_by)} · {formatDateTime(r.created_at, profile.timezone)}</Meta>
            <Prose className="mt-2">{r.reason}</Prose>
            {r.notes && <p className="mt-2 text-[13px] whitespace-pre-wrap text-ink-muted">{r.notes}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* =========================================================================== */
/* Activity                                                                    */
/* =========================================================================== */
export function ActivityList({
  items,
  people,
  timeZone,
  compact,
  showProject,
}: {
  items: { id: number; actor_id: string | null; action: string; details: ProjectWorkspace["activity"][number]["details"]; created_at: string; project_id?: string | null }[];
  people: PersonMap;
  timeZone: string;
  compact?: boolean;
  showProject?: Record<string, { title: string; internal_ref: string }>;
}) {
  if (items.length === 0) return <p className="text-[13px] text-ink-muted">No activity yet.</p>;
  const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-accent", neutral: "bg-navy-200" };
  return (
    <ol className="relative flex flex-col">
      {items.map((a, i) => (
        <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-3 bottom-0 left-[5px] w-px bg-line" aria-hidden />}
          <span className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full ring-3 ring-surface", dot[activityTone(a.action)])} aria-hidden />
          <div className="min-w-0 text-[13px] leading-snug">
            <p>
              <span className="font-medium">{a.actor_id ? name(people, a.actor_id) : "System"}</span>{" "}
              <span className="text-ink">{describeActivity(a.action, a.details, people)}</span>
            </p>
            {showProject && a.project_id && showProject[a.project_id] && (
              <Link href={`/projects/${a.project_id}`} className="text-xs text-accent hover:underline">
                {showProject[a.project_id].internal_ref} · {showProject[a.project_id].title}
              </Link>
            )}
            <p className="mt-0.5 text-[11px] text-ink-subtle" title={formatDateTime(a.created_at, timeZone)}>
              {compact ? formatRelative(a.created_at) : formatDateTime(a.created_at, timeZone)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActivityTab({ ws, people, profile }: Ctx) {
  return (
    <Card>
      <CardHeader title="Activity history" description="Every decision and change on this project, newest first." />
      <CardBody>
        <ActivityList items={ws.activity} people={people} timeZone={profile.timezone} />
      </CardBody>
    </Card>
  );
}
