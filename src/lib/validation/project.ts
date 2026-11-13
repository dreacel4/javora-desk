import { z } from "zod";

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const required = (label: string, min: number, max: number) =>
  z.string().trim().min(min, min <= 1 ? `${label} is required.` : `${label} needs at least ${min} characters.`).max(max, `Keep this under ${max} characters.`);

export const httpUrl = z
  .string()
  .trim()
  .max(2048, "That link is too long.")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full link starting with https://");

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const assetSchema = z.object({
  kind: z.enum(["raw_material", "reference"]),
  label: required("Label", 1, 160),
  url: httpUrl,
  notes: text(2000).default(""),
});

export const projectFormSchema = z.object({
  title: required("Project title", 3, 160),
  internal_ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, "Use 2–40 letters, numbers, dots, dashes or underscores."),
  client_name: required("Client", 1, 120),
  client_platform: required("Platform", 1, 60),
  description: text(4000).default(""),
  original_client_brief: required("The original client brief", 1, 20000),
  editing_requirements: text(20000).default(""),
  additional_instructions: text(20000).default(""),
  output_resolution: text(40).default(""),
  aspect_ratio: text(20).default(""),
  frame_rate: text(20).default(""),
  required_duration: text(60).default(""),
  delivery_format: text(80).default(""),
  priority: z.enum(PRIORITIES),
  deadline: z.string().nullable(), // ISO, converted from the user's time zone on the client
  storyboard_required: z.boolean(),
  planned_editor_id: z.string().uuid().nullable(),
  assets: z.array(assetSchema).max(40, "Add at most 40 links."),
});
export type ProjectFormValues = z.input<typeof projectFormSchema>;

export const projectUpdateSchema = projectFormSchema
  .omit({ original_client_brief: true, editing_requirements: true, additional_instructions: true, assets: true })
  .partial();

export const briefSchema = z.object({
  original_client_brief: required("The client brief", 1, 20000),
  editing_requirements: text(20000).default(""),
  additional_instructions: text(20000).default(""),
  change_note: text(2000).default(""),
});

export const understandingSchema = z.object({
  materials_description: required("Description of received materials", 10, 8000),
  requirements_understanding: required("Your understanding of the requirements", 10, 8000),
  editing_approach: required("Proposed editing approach", 10, 8000),
  visual_sequence: required("Planned visual sequence", 10, 8000),
  expected_deliverables: required("Expected deliverables", 3, 4000),
  missing_assets: text(4000).default(""),
  questions: text(4000).default(""),
});

export const uploadedFileSchema = z.object({
  path: z.string().min(10).max(512),
  name: z.string().trim().min(1).max(255),
});

export const storyboardSchema = z.object({
  description: required("Description", 3, 8000),
  sequence_notes: text(8000).default(""),
  files: z.array(uploadedFileSchema).min(1, "Attach at least one storyboard file.").max(10),
});

/** Google Drive file/folder links: drive.google.com/file/d/<id>, /drive/folders/<id>, ?id=<id>, docs.google.com/... */
export function isGoogleDriveUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:") return false;
    if (u.hostname !== "drive.google.com" && u.hostname !== "docs.google.com") return false;
    return /\/(file\/d|folders|d)\/[A-Za-z0-9_-]{10,}/.test(u.pathname) || /^[A-Za-z0-9_-]{10,}$/.test(u.searchParams.get("id") ?? "");
  } catch {
    return false;
  }
}

export const submissionSchema = z.object({
  drive_url: z.string().trim().max(2048).refine(isGoogleDriveUrl, "Enter a Google Drive file or folder link (https://drive.google.com/…)."),
  file_name: required("Final file name", 1, 255),
  version_label: required("Version", 1, 40),
  export_resolution: required("Export resolution", 1, 40),
  aspect_ratio: required("Aspect ratio", 1, 20),
  frame_rate: required("Frame rate", 1, 20),
  export_format: required("Export format", 1, 80),
  work_summary: required("Work summary", 10, 8000),
  completed_requirements: required("Completed requirements", 3, 8000),
  deviations: text(8000).default(""),
  notes: text(8000).default(""),
  access_confirmed: z.literal(true, { message: "Confirm that the Drive link is shared with the dispatcher." }),
});

export function formDataToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
