import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ProjectListItem, PersonMap } from "@/lib/queries";
import { Avatar } from "@/components/ui/primitives";
import { PriorityBadge, StatusBadge } from "./badges";
import { DeadlineCountdown } from "./deadline";

const DONE = new Set(["completed", "cancelled"]);

/** Responsive project list: a table on desktop, stacked cards on mobile. */
export function ProjectList({
  items,
  people,
  timeZone,
  serverNow,
}: {
  items: ProjectListItem[];
  people: PersonMap;
  timeZone: string;
  serverNow: number;
}) {
  return (
    <>
      {/* Mobile cards */}
      <ul className="flex flex-col divide-y divide-line md:hidden">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="flex flex-col gap-2.5 px-4 py-4 active:bg-navy-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-ink-muted tabular">{p.internal_ref}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-ink">{p.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {p.client_name} · {p.client_platform}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusBadge status={p.status} />
                <PriorityBadge priority={p.priority} compact />
                <DeadlineCountdown deadline={p.deadline} timeZone={timeZone} done={DONE.has(p.status)} serverNow={serverNow} />
              </div>
              {p.assigned_editor_id && (
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <Avatar name={people[p.assigned_editor_id]?.name} size="sm" />
                  {people[p.assigned_editor_id]?.name ?? "Editor"}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              <th className="py-2.5 pr-3 pl-5 font-medium">Project</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Priority</th>
              <th className="px-3 py-2.5 font-medium">Editor</th>
              <th className="py-2.5 pr-5 pl-3 font-medium">Deadline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((p) => (
              <tr key={p.id} className="group relative transition-colors hover:bg-navy-50/60">
                <td className="max-w-[420px] py-3 pr-3 pl-5">
                  <Link href={`/projects/${p.id}`} className="block after:absolute after:inset-0" aria-label={`${p.title} (${p.internal_ref})`}>
                    <span className="block truncate font-medium text-ink group-hover:text-navy-700">{p.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      <span className="tabular">{p.internal_ref}</span> · {p.client_name} · {p.client_platform}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={p.status} />
                  {p.archived_at && <span className="ml-2 text-[11px] text-ink-subtle">Archived</span>}
                </td>
                <td className="px-3 py-3">
                  <PriorityBadge priority={p.priority} compact />
                </td>
                <td className="px-3 py-3">
                  {p.assigned_editor_id ? (
                    <span className="flex items-center gap-2 text-[13px]">
                      <Avatar name={people[p.assigned_editor_id]?.name} size="sm" />
                      <span className="max-w-32 truncate">{people[p.assigned_editor_id]?.name ?? "Editor"}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-subtle">{p.status === "available" ? "Open to claim" : "—"}</span>
                  )}
                </td>
                <td className="py-3 pr-5 pl-3">
                  <DeadlineCountdown deadline={p.deadline} timeZone={timeZone} done={DONE.has(p.status)} showDate serverNow={serverNow} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
