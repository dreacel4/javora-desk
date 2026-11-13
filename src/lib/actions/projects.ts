"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  assetSchema,
  briefSchema,
  projectFormSchema,
  projectUpdateSchema,
  type ProjectFormValues,
} from "@/lib/validation/project";

const uuid = z.string().uuid();
const reasonSchema = z.string().trim().max(2000);

function invalid(error: z.ZodError): ActionResult<never> {
  const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const first = Object.values(fieldErrors).flat().find(Boolean) ?? error.issues[0]?.message;
  return { ok: false, error: first ?? "Some fields are invalid.", fieldErrors };
}

function refresh() {
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------------------------- */
/* Create / edit                                                                */
/* --------------------------------------------------------------------------- */
export async function createProjectAction(values: ProjectFormValues, publish: boolean): Promise<ActionResult<{ id: string }>> {
  const parsed = projectFormSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  if (publish && !parsed.data.deadline) return { ok: false, error: "Set a deadline before publishing.", fieldErrors: { deadline: ["Required to publish."] } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_project", {
    p_data: parsed.data as unknown as Json,
    p_publish: publish,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: { id: data as string }, message: publish ? "Project published." : "Draft saved." };
}

export async function updateProjectAction(projectId: string, values: Partial<ProjectFormValues>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = projectUpdateSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_project", { p_project: projectId, p_data: parsed.data as unknown as Json });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Project updated." };
}

export async function updateBriefAction(projectId: string, values: z.input<typeof briefSchema>): Promise<ActionResult<{ version: number }>> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = briefSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_project_brief", {
    p_project: projectId,
    p_original_client_brief: parsed.data.original_client_brief,
    p_editing_requirements: parsed.data.editing_requirements,
    p_additional_instructions: parsed.data.additional_instructions,
    p_change_note: parsed.data.change_note,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, data: { version: data as number }, message: `Brief saved as version ${data}.` };
}

/* --------------------------------------------------------------------------- */
/* Materials & references                                                       */
/* --------------------------------------------------------------------------- */
export async function addAssetAction(projectId: string, values: z.input<typeof assetSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = assetSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_project_asset", {
    p_project: projectId,
    p_kind: parsed.data.kind,
    p_label: parsed.data.label,
    p_url: parsed.data.url,
    p_notes: parsed.data.notes,
  });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Link added." };
}

const fileAssetSchema = z.object({
  kind: z.enum(["raw_material", "reference"]),
  label: z.string().trim().min(1, "Label is required.").max(160),
  notes: z.string().trim().max(2000).default(""),
  path: z.string().min(10).max(512),
  fileName: z.string().trim().min(1).max(255),
});

export async function addFileAssetAction(projectId: string, values: z.input<typeof fileAssetSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const parsed = fileAssetSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_project_file_asset", {
    p_project: projectId,
    p_kind: parsed.data.kind,
    p_label: parsed.data.label,
    p_notes: parsed.data.notes,
    p_path: parsed.data.path,
    p_file_name: parsed.data.fileName,
  });
  if (error) {
    await supabase.storage.from("project-files").remove([parsed.data.path]);
    return fail(error);
  }
  refresh();
  return { ok: true, message: "File added." };
}

export async function removeAssetAction(assetId: string): Promise<ActionResult> {
  if (!uuid.safeParse(assetId).success) return { ok: false, error: "Invalid item." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_project_asset", { p_asset: assetId });
  if (error) return fail(error);
  refresh();
  return { ok: true, message: "Removed. It stays in the activity history." };
}

/** Removes uploads that were never registered (e.g. a form failed after upload). */
export async function discardUploadsAction(paths: string[]): Promise<ActionResult> {
  const parsed = z.array(z.string().min(10).max(512)).max(20).safeParse(paths);
  if (!parsed.success || parsed.data.length === 0) return { ok: true };
  const supabase = await createClient();
  await supabase.storage.from("project-files").remove(parsed.data); // RLS: only unregistered own files
  return { ok: true };
}

/* --------------------------------------------------------------------------- */
/* Lifecycle                                                                    */
/* --------------------------------------------------------------------------- */
type Fns = Database["public"]["Functions"];

async function simple<F extends keyof Fns>(fn: F, args: Fns[F]["Args"], message: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return fail(error);
  refresh();
  return { ok: true, message };
}

export async function publishProjectAction(projectId: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("publish_project", { p_project: projectId }, "Project published to the team.");
}

export async function claimProjectAction(projectId: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("claim_project", { p_project: projectId }, "Project claimed. Next: submit your understanding of the brief.");
}

export async function assignEditorAction(projectId: string, editorId: string, reason: string) {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(editorId).success) return { ok: false as const, error: "Invalid selection." };
  return simple("assign_editor", { p_project: projectId, p_editor: editorId, p_reason: reasonSchema.parse(reason ?? "") }, "Editor assigned.");
}

export async function unassignEditorAction(projectId: string, reason: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("unassign_editor", { p_project: projectId, p_reason: reasonSchema.parse(reason ?? "") }, "Editor unassigned. The project is available again.");
}

export async function holdProjectAction(projectId: string, reason: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("put_project_on_hold", { p_project: projectId, p_reason: reasonSchema.parse(reason ?? "") }, "Project put on hold.");
}

export async function resumeProjectAction(projectId: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("resume_project", { p_project: projectId }, "Project resumed.");
}

export async function cancelProjectAction(projectId: string, reason: string) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("cancel_project", { p_project: projectId, p_reason: reasonSchema.parse(reason ?? "") }, "Project cancelled.");
}

export async function setArchivedAction(projectId: string, archived: boolean) {
  if (!uuid.safeParse(projectId).success) return { ok: false as const, error: "Invalid project." };
  return simple("set_project_archived", { p_project: projectId, p_archived: archived }, archived ? "Project archived." : "Project restored from archive.");
}

export async function deleteDraftAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Invalid project." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_draft_project", { p_project: projectId });
  if (error) return fail(error);
  const paths = (data as string[] | null) ?? [];
  if (paths.length > 0) await supabase.storage.from("project-files").remove(paths);
  refresh();
  redirect("/projects?view=drafts&deleted=1");
}
