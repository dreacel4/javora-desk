import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getPeople, listProjects, PAGE_SIZE, PROJECT_VIEWS, type ProjectListFilters, type ProjectView } from "@/lib/queries";
import { STATUS_META, PRIORITY_META } from "@/lib/status";
import type { ProjectPriority, ProjectStatus } from "@/lib/types";
import { isUuid } from "@/lib/utils";
import { requestTime } from "@/lib/server-time";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/nav";
import { ProjectFilters } from "@/components/projects/project-filters";
import { ProjectList } from "@/components/projects/project-list";

export const metadata: Metadata = { title: "Projects" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const manager = profile.role !== "editor";

  const viewKeys = (Object.keys(PROJECT_VIEWS) as ProjectView[]).filter((v) => manager || v !== "drafts");
  const rawView = one(sp.view) as ProjectView | undefined;
  const view: ProjectView = rawView && viewKeys.includes(rawView) ? rawView : "all";
  const status = one(sp.status);
  const priority = one(sp.priority);
  const sort = one(sp.sort);
  const editor = one(sp.editor);

  const filters: ProjectListFilters = {
    view,
    q: one(sp.q)?.slice(0, 80),
    status: status && status in STATUS_META ? (status as ProjectStatus) : undefined,
    priority: priority && priority in PRIORITY_META ? (priority as ProjectPriority) : undefined,
    editor: editor && isUuid(editor) ? editor : undefined,
    sort: sort === "priority" || sort === "updated" || sort === "created" ? sort : "deadline",
    page: Number(one(sp.page)) || 1,
  };

  const [{ items, total, page }, people] = await Promise.all([listProjects(profile, filters), getPeople()]);
  const editors = Object.entries(people)
    .filter(([, p]) => p.role === "editor")
    .map(([id, p]) => ({ id, name: p.name }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)])), ...params })) {
      if (v) next.set(k, v);
    }
    const s = next.toString();
    return s ? `/projects?${s}` : "/projects";
  };

  return (
    <>
      <PageHeader
        title="Projects"
        description={manager ? "Every production in the workspace, from draft to delivery." : "Open projects to claim and the work assigned to you."}
        actions={manager && <ButtonLink href="/projects/new" icon={<Plus className="size-4" />}>New project</ButtonLink>}
      />

      {sp.deleted === "1" && <Alert tone="success" className="mb-4">Draft deleted.</Alert>}

      <LinkTabs
        className="mb-4"
        active={view}
        tabs={viewKeys.map((v) => ({
          key: v,
          label: manager && v === "mine" ? "Created by me" : PROJECT_VIEWS[v].label,
          href: v === "all" ? "/projects" : `/projects?view=${v}`,
        }))}
      />

      <Card>
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <ProjectFilters editors={editors} showEditorFilter={manager} />
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title={filters.q || filters.status || filters.priority ? "No projects match these filters" : emptyTitle(view, manager)}
            description={filters.q || filters.status || filters.priority ? "Try a different search or clear the filters." : emptyHint(view, manager)}
            action={manager && view === "all" ? <ButtonLink href="/projects/new" icon={<Plus className="size-4" />}>Create the first project</ButtonLink> : undefined}
          />
        ) : (
          <ProjectList items={items} people={people} timeZone={profile.timezone} serverNow={requestTime()} />
        )}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-ink-muted">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            {pages > 1 && (
              <div className="flex gap-2">
                {page > 1 && <Link className="rounded-md px-2 py-1 hover:bg-navy-50 hover:text-ink" href={href({ page: String(page - 1) })}>← Previous</Link>}
                {page < pages && <Link className="rounded-md px-2 py-1 hover:bg-navy-50 hover:text-ink" href={href({ page: String(page + 1) })}>Next →</Link>}
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function emptyTitle(view: ProjectView, manager: boolean) {
  switch (view) {
    case "available": return "No projects are open to claim";
    case "mine": return manager ? "You haven't created any projects yet" : "No active projects assigned to you";
    case "review": return "Nothing is waiting for review";
    case "revision": return "No revisions outstanding";
    case "completed": return "No completed projects yet";
    case "drafts": return "No drafts";
    case "archived": return "The archive is empty";
    case "in_progress": return "Nothing in production right now";
    default: return "No projects yet";
  }
}

function emptyHint(view: ProjectView, manager: boolean) {
  if (view === "available" && !manager) return "You'll get a notification the moment a new project is published.";
  if (view === "all" && manager) return "Create a project from a client order to start the production workflow.";
  return undefined;
}
