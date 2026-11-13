import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getActiveEditors, getWorkspaceSettings } from "@/lib/queries";
import { MANAGER_ROLES } from "@/lib/types";
import { PageHeader } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/projects/project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const profile = await requireRole(MANAGER_ROLES);
  const [settings, editors] = await Promise.all([getWorkspaceSettings(), getActiveEditors()]);
  return (
    <>
      <PageHeader eyebrow="Projects" title="New project" description="Capture the client order. Save a draft or publish it to the editing team." />
      <ProjectForm
        mode="create"
        editors={editors}
        timeZone={profile.timezone}
        defaults={{
          client_platform: settings?.default_client_platform ?? "Fiverr",
          output_resolution: settings?.default_resolution ?? "",
          aspect_ratio: settings?.default_aspect_ratio ?? "",
          frame_rate: settings?.default_frame_rate ?? "",
          delivery_format: settings?.default_delivery_format ?? "",
          priority: settings?.default_priority ?? "normal",
          storyboard_required: settings?.default_storyboard_required ?? true,
        }}
      />
    </>
  );
}
