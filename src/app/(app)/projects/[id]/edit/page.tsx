import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveEditors } from "@/lib/queries";
import { MANAGER_ROLES } from "@/lib/types";
import { isUuid } from "@/lib/utils";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/projects/project-form";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  const profile = await requireRole(MANAGER_ROLES);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: project }, editors] = await Promise.all([supabase.from("projects").select("*").eq("id", id).maybeSingle(), getActiveEditors()]);
  if (!project) notFound();
  const closed = project.status === "completed" || project.status === "cancelled";
  return (
    <>
      <PageHeader eyebrow={project.internal_ref} title="Edit project details" description="The client brief and materials are edited from their own tabs so every change is versioned." />
      {closed ? (
        <Alert tone="warning">Completed or cancelled projects can no longer be edited.</Alert>
      ) : (
        <ProjectForm
          mode="edit"
          project={project}
          editors={editors}
          timeZone={profile.timezone}
          defaults={{
            client_platform: project.client_platform,
            output_resolution: project.output_resolution,
            aspect_ratio: project.aspect_ratio,
            frame_rate: project.frame_rate,
            delivery_format: project.delivery_format,
            priority: project.priority,
            storyboard_required: project.storyboard_required,
          }}
        />
      )}
    </>
  );
}
