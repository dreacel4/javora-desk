import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { getWorkspaceSettings } from "@/lib/queries";
import { PageHeader } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/nav";
import { ProfileSettings, WorkspaceSettingsForm } from "@/components/settings/settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const isOwner = profile.role === "owner";
  const tab = sp.tab === "workspace" && isOwner ? "workspace" : "profile";
  const settings = tab === "workspace" ? await getWorkspaceSettings() : null;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="Your profile, notifications and — for owners — workspace configuration." />
      {isOwner && (
        <LinkTabs
          className="mb-5"
          active={tab}
          tabs={[
            { key: "profile", label: "Profile & notifications", href: "/settings" },
            { key: "workspace", label: "Workspace", href: "/settings?tab=workspace" },
          ]}
        />
      )}
      {tab === "workspace" && settings ? <WorkspaceSettingsForm settings={settings} /> : <ProfileSettings profile={profile} />}
    </div>
  );
}
