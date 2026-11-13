import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const cookieStore = await cookies();

  const [{ data: settings }, { count: unread }] = await Promise.all([
    supabase.from("workspace_settings").select("workspace_name").eq("id", 1).maybeSingle(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  return (
    <AppShell
      user={{ id: profile.id, fullName: profile.full_name, email: profile.email, role: profile.role }}
      workspaceName={settings?.workspace_name ?? "Javora"}
      initialCollapsed={cookieStore.get("jd_sidebar")?.value === "collapsed"}
      unreadCount={unread ?? 0}
    >
      {children}
    </AppShell>
  );
}
