import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/queries";
import { MANAGER_ROLES } from "@/lib/types";
import { isUuid } from "@/lib/utils";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { ActivityList } from "@/components/workspace/tabs";

export const metadata: Metadata = { title: "Activity log" };
const LIMIT = 100;

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const profile = await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const actor = typeof sp.actor === "string" && isUuid(sp.actor) ? sp.actor : undefined;
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : undefined;
  const supabase = await createClient();

  let q = supabase.from("project_activity").select("id, project_id, actor_id, action, details, created_at").order("id", { ascending: false }).limit(LIMIT);
  if (actor) q = q.eq("actor_id", actor);
  if (before) q = q.lt("id", before);
  const [{ data: items }, people] = await Promise.all([q, getPeople()]);

  const projectIds = [...new Set((items ?? []).map((a) => a.project_id).filter((x): x is string => Boolean(x)))];
  const { data: projects } = projectIds.length
    ? await supabase.from("projects").select("id, title, internal_ref").in("id", projectIds)
    : { data: [] as { id: string; title: string; internal_ref: string }[] };
  const projectMap = Object.fromEntries((projects ?? []).map((p) => [p.id, p]));
  const last = items?.at(-1);

  return (
    <>
      <PageHeader
        title="Activity log"
        description={actor ? `Actions by ${people[actor]?.name ?? "this member"}.` : "Every action across the workspace, newest first."}
        actions={actor && <Link href="/activity" className="text-[13px] font-medium text-accent hover:underline">Show everyone</Link>}
      />
      <Card>
        <CardBody>
          <ActivityList items={items ?? []} people={people} timeZone={profile.timezone} showProject={projectMap} />
        </CardBody>
        {items && items.length === LIMIT && last && (
          <div className="border-t border-line px-5 py-3 text-right">
            <Link href={`/activity?${new URLSearchParams({ ...(actor ? { actor } : {}), before: String(last.id) })}`} className="text-[13px] font-medium text-accent hover:underline">
              Older →
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
