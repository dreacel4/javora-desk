import type { Metadata } from "next";
import Link from "next/link";
import { Info, Users } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/status";
import { formatDuration, formatRelative } from "@/lib/format";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { InviteButton, MemberActions, RevokeInvitationButton } from "@/components/team/team-client";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const profile = await requireRole(MANAGER_ROLES);
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  const [{ data: members }, { data: metrics }, { data: invitations }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, is_active, last_sign_in_at, created_at").order("role").order("full_name"),
    supabase.rpc("team_metrics"),
    isOwner
      ? supabase.from("invitations").select("id, email, role, created_at, expires_at").eq("status", "pending").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; created_at: string; expires_at: string }[] }),
  ]);

  const roleTone = { owner: "navy", dispatcher: "violet", editor: "info" } as const;

  return (
    <>
      <PageHeader
        title="Team"
        description={isOwner ? "Invite members, manage roles and see how editors are doing." : "The production team and editor performance."}
        actions={isOwner && <InviteButton />}
      />

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Members" description={`${members?.filter((m) => m.is_active).length ?? 0} active`} />
          {!members || members.length === 0 ? (
            <EmptyState icon={<Users className="size-5" />} title="No members yet" />
          ) : (
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.full_name || m.email} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.full_name || "Unnamed member"}
                        {!m.is_active && <span className="ml-2 text-xs font-normal text-danger">Disabled</span>}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pl-11 sm:pl-0">
                    <Badge tone={roleTone[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    <span className="w-36 text-xs text-ink-muted">
                      {m.last_sign_in_at ? `Active ${formatRelative(m.last_sign_in_at)}` : "Invited · not signed in"}
                    </span>
                    {isOwner && (
                      <MemberActions
                        isSelf={m.id === profile.id}
                        member={{ id: m.id, name: m.full_name || m.email, role: m.role, is_active: m.is_active, signedIn: Boolean(m.last_sign_in_at) }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isOwner && invitations && invitations.length > 0 && (
          <Card>
            <CardHeader title="Pending invitations" description="Added members who have not signed in yet. Google invitations become active the first time they use “Continue with Google”; they expire after 7 days." />
            <ul className="divide-y divide-line">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate">
                    {i.email} <span className="text-xs text-ink-muted">· {i.role}</span>
                  </span>
                  <RevokeInvitationButton id={i.id} email={i.email} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Editor performance"
            description="Outcome metrics from completed work. Logged time is shown for context only — hours are not a measure of productivity or quality."
          />
          {!metrics || metrics.length === 0 ? (
            <EmptyState title="No editors yet" className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-muted">
                    <th className="py-2.5 pr-3 pl-5 font-medium">Editor</th>
                    <th className="px-3 py-2.5 text-right font-medium">Active</th>
                    <th className="px-3 py-2.5 text-right font-medium">Completed</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Calendar time from assignment to approval">Avg. turnaround</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Revision requests across all their deliveries">Revisions</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Completed projects approved on or before the deadline">On time</th>
                    <th className="py-2.5 pr-5 pl-3 text-right font-medium">Logged time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular">
                  {metrics.map((m) => {
                    const rate = m.completed_with_deadline > 0 ? Math.round((m.completed_on_time / m.completed_with_deadline) * 100) : null;
                    return (
                      <tr key={m.editor_id} className={m.is_active ? undefined : "opacity-50"}>
                        <td className="py-3 pr-3 pl-5">
                          <Link href={`/activity?actor=${m.editor_id}`} className="font-medium hover:underline">{m.full_name || m.email}</Link>
                        </td>
                        <td className="px-3 py-3 text-right">{m.active_projects}</td>
                        <td className="px-3 py-3 text-right">{m.projects_completed}</td>
                        <td className="px-3 py-3 text-right">{m.avg_turnaround_hours != null ? `${m.avg_turnaround_hours} h` : "—"}</td>
                        <td className="px-3 py-3 text-right">{m.revision_requests}</td>
                        <td className="px-3 py-3 text-right">
                          {rate != null ? (
                            <span title={`${m.completed_on_time} of ${m.completed_with_deadline}`}>{rate}%</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 pr-5 pl-3 text-right text-ink-muted">{formatDuration(m.logged_seconds)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-xs text-ink-muted">
            <Info className="mt-px size-3.5 shrink-0" />
            Small numbers are noisy: one difficult client can swing turnaround and revision counts. Use these as conversation starters, not rankings.
          </p>
        </Card>
      </div>
    </>
  );
}
