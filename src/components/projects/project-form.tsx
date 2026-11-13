"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { createProjectAction, updateProjectAction } from "@/lib/actions/projects";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import type { ProjectFormValues } from "@/lib/validation/project";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/primitives";
import { useAction } from "@/components/ui/overlay";

type Defaults = {
  client_platform: string;
  output_resolution: string;
  aspect_ratio: string;
  frame_rate: string;
  delivery_format: string;
  priority: Project["priority"];
  storyboard_required: boolean;
};

type Asset = { kind: "raw_material" | "reference"; label: string; url: string; notes: string };

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-6 p-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:p-6">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </Card>
  );
}

export function ProjectForm({
  mode,
  project,
  defaults,
  editors,
  timeZone,
}: {
  mode: "create" | "edit";
  project?: Project;
  defaults: Defaults;
  editors: { id: string; full_name: string; email: string }[];
  timeZone: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [intent, setIntent] = useState<"draft" | "publish" | "save">("draft");

  const isDraft = !project || project.status === "draft";
  const [v, setV] = useState({
    title: project?.title ?? "",
    internal_ref: project?.internal_ref ?? "",
    client_name: project?.client_name ?? "",
    client_platform: project?.client_platform ?? defaults.client_platform,
    description: project?.description ?? "",
    original_client_brief: "",
    editing_requirements: "",
    additional_instructions: "",
    output_resolution: project?.output_resolution ?? defaults.output_resolution,
    aspect_ratio: project?.aspect_ratio ?? defaults.aspect_ratio,
    frame_rate: project?.frame_rate ?? defaults.frame_rate,
    required_duration: project?.required_duration ?? "",
    delivery_format: project?.delivery_format ?? defaults.delivery_format,
    priority: project?.priority ?? defaults.priority,
    deadline: toDateTimeLocal(project?.deadline, timeZone),
    storyboard_required: project?.storyboard_required ?? defaults.storyboard_required,
    planned_editor_id: project?.planned_editor_id ?? "",
  });
  const [assets, setAssets] = useState<Asset[]>([]);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const err = (k: string) => errors[k];

  const submit = async (which: "draft" | "publish" | "save") => {
    setIntent(which);
    setFormError(null);
    setErrors({});
    const deadlineIso = v.deadline ? fromDateTimeLocal(v.deadline, timeZone) : null;
    if (v.deadline && !deadlineIso) {
      setErrors({ deadline: ["Invalid date."] });
      return;
    }
    if (which === "publish" && deadlineIso && new Date(deadlineIso).getTime() <= Date.now()) {
      setErrors({ deadline: ["The deadline must be in the future to publish."] });
      return;
    }

    if (mode === "create") {
      const payload: ProjectFormValues = {
        ...v,
        deadline: deadlineIso,
        planned_editor_id: v.planned_editor_id || null,
        assets: assets.filter((a) => a.url.trim() || a.label.trim()),
      };
      const res = await run(() => createProjectAction(payload, which === "publish"));
      if (res.ok && res.data) router.push(`/projects/${res.data.id}`);
      else if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    } else if (project) {
      const payload: Partial<ProjectFormValues> = {
        title: v.title,
        internal_ref: v.internal_ref,
        client_name: v.client_name,
        client_platform: v.client_platform,
        description: v.description,
        output_resolution: v.output_resolution,
        aspect_ratio: v.aspect_ratio,
        frame_rate: v.frame_rate,
        required_duration: v.required_duration,
        delivery_format: v.delivery_format,
        priority: v.priority,
        storyboard_required: v.storyboard_required,
        deadline: deadlineIso,
        ...(isDraft ? { planned_editor_id: v.planned_editor_id || null } : {}),
      };
      const res = await run(() => updateProjectAction(project.id, payload));
      if (res.ok) router.push(`/projects/${project.id}`);
      else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    }
  };

  const storyboardLocked = mode === "edit" && project && !["draft", "available", "claimed", "awaiting_confirmation"].includes(project.status);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(mode === "create" ? "draft" : "save");
      }}
      noValidate
    >
      {formError && <Alert tone="danger" title="Could not save the project">{formError}</Alert>}

      <Section title="Project" description="How the team will recognise this job internally.">
        <Field label="Project title" required error={err("title")}>
          {(p) => <Input {...p} value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Product launch teaser — 30s" maxLength={160} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Internal project ID" required error={err("internal_ref")} hint="Unique, e.g. JV-2026-041">
            {(p) => <Input {...p} value={v.internal_ref} onChange={(e) => set("internal_ref", e.target.value)} placeholder="JV-2026-041" maxLength={40} className="font-mono" />}
          </Field>
          <Field label="Priority" required>
            {(p) => (
              <Select {...p} value={v.priority} onChange={(e) => set("priority", e.target.value as Project["priority"])}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            )}
          </Field>
          <Field label="Client name or username" required error={err("client_name")}>
            {(p) => <Input {...p} value={v.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Fiverr username" maxLength={120} />}
          </Field>
          <Field label="Client platform" required error={err("client_platform")}>
            {(p) => <Input {...p} value={v.client_platform} onChange={(e) => set("client_platform", e.target.value)} list="platforms" maxLength={60} />}
          </Field>
          <datalist id="platforms">
            <option value="Fiverr" />
            <option value="Upwork" />
            <option value="Direct" />
          </datalist>
        </div>
        <Field label="Short description" error={err("description")} hint="One or two lines for lists and notifications.">
          {(p) => <Textarea {...p} rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} />}
        </Field>
      </Section>

      {mode === "create" && (
        <Section
          title="Client brief"
          description="Paste the client's original words exactly. This becomes brief version 1 and is preserved permanently; later changes create new versions."
        >
          <Field label="Original client brief" required error={err("original_client_brief")}>
            {(p) => (
              <Textarea
                {...p}
                rows={8}
                value={v.original_client_brief}
                onChange={(e) => set("original_client_brief", e.target.value)}
                placeholder="Paste the brief from the Fiverr order, including any client messages that define the work."
                maxLength={20000}
              />
            )}
          </Field>
          <Field label="Editing requirements" error={err("editing_requirements")} hint="Your structured interpretation: captions, music, pacing, branding…">
            {(p) => <Textarea {...p} rows={5} value={v.editing_requirements} onChange={(e) => set("editing_requirements", e.target.value)} maxLength={20000} />}
          </Field>
          <Field label="Additional instructions" error={err("additional_instructions")}>
            {(p) => <Textarea {...p} rows={3} value={v.additional_instructions} onChange={(e) => set("additional_instructions", e.target.value)} maxLength={20000} />}
          </Field>
        </Section>
      )}

      <Section title="Output specifications" description="What the final export must match.">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Output resolution" error={err("output_resolution")}>
            {(p) => <Input {...p} value={v.output_resolution} onChange={(e) => set("output_resolution", e.target.value)} list="resolutions" maxLength={40} />}
          </Field>
          <Field label="Aspect ratio" error={err("aspect_ratio")}>
            {(p) => <Input {...p} value={v.aspect_ratio} onChange={(e) => set("aspect_ratio", e.target.value)} list="ratios" maxLength={20} />}
          </Field>
          <Field label="Frame rate (fps)" error={err("frame_rate")}>
            {(p) => <Input {...p} value={v.frame_rate} onChange={(e) => set("frame_rate", e.target.value)} list="fps" maxLength={20} />}
          </Field>
          <Field label="Required duration" error={err("required_duration")}>
            {(p) => <Input {...p} value={v.required_duration} onChange={(e) => set("required_duration", e.target.value)} placeholder="e.g. 30–45 seconds" maxLength={60} />}
          </Field>
          <Field label="Delivery format" error={err("delivery_format")} className="sm:col-span-2 xl:col-span-2">
            {(p) => <Input {...p} value={v.delivery_format} onChange={(e) => set("delivery_format", e.target.value)} placeholder="MP4 (H.264), ProRes…" maxLength={80} />}
          </Field>
        </div>
        <datalist id="resolutions">
          <option value="1920x1080" /><option value="3840x2160" /><option value="1080x1920" /><option value="1080x1080" /><option value="1080x1350" />
        </datalist>
        <datalist id="ratios">
          <option value="16:9" /><option value="9:16" /><option value="1:1" /><option value="4:5" /><option value="21:9" />
        </datalist>
        <datalist id="fps">
          <option value="23.976" /><option value="24" /><option value="25" /><option value="30" /><option value="60" />
        </datalist>
      </Section>

      {mode === "create" && (
        <Section title="Materials & references" description="Links to raw footage (Drive, Dropbox, WeTransfer) and style references. Files can be uploaded on the project page after saving.">
          {assets.length === 0 && <p className="text-[13px] text-ink-muted">No links added yet.</p>}
          {assets.map((a, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-line bg-canvas/60 p-3 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-start">
              <Select aria-label="Type" value={a.kind} onChange={(e) => setAssets((l) => l.map((x, j) => (j === i ? { ...x, kind: e.target.value as Asset["kind"] } : x)))}>
                <option value="raw_material">Raw material</option>
                <option value="reference">Reference</option>
              </Select>
              <Input aria-label="Label" placeholder="Label" value={a.label} maxLength={160} onChange={(e) => setAssets((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="URL" placeholder="https://…" type="url" value={a.url} maxLength={2048} onChange={(e) => setAssets((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remove link" onClick={() => setAssets((l) => l.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {err("assets") && <p className="text-xs text-danger">{err("assets")?.[0]}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setAssets((l) => [...l, { kind: "raw_material", label: "", url: "", notes: "" }])}>
              Raw material link
            </Button>
            <Button variant="secondary" size="sm" icon={<Link2 className="size-4" />} onClick={() => setAssets((l) => [...l, { kind: "reference", label: "", url: "", notes: "" }])}>
              Reference link
            </Button>
          </div>
        </Section>
      )}

      <Section title="Schedule & assignment" description={`Times are in your time zone (${timeZone}).`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Deadline" required={!isDraft} error={err("deadline")} hint="Required before publishing.">
            {(p) => <Input {...p} type="datetime-local" value={v.deadline} onChange={(e) => set("deadline", e.target.value)} />}
          </Field>
          {isDraft ? (
            <Field label="Editor" hint="Leave open to let any editor claim it.">
              {(p) => (
                <Select {...p} value={v.planned_editor_id} onChange={(e) => set("planned_editor_id", e.target.value)}>
                  <option value="">Open assignment</option>
                  {editors.map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name || e.email}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <p className="self-end text-[13px] text-ink-muted">Change the editor from the project page (Assign / Reassign).</p>
          )}
        </div>
        <Toggle
          checked={v.storyboard_required}
          onChange={(c) => set("storyboard_required", c)}
          disabled={Boolean(storyboardLocked)}
          label="Storyboard approval required"
          description={
            storyboardLocked
              ? "Locked: the editor's understanding has already been approved."
              : "The editor must upload a storyboard and get it approved before production starts."
          }
        />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border sm:shadow-(--shadow-card)">
        <Button variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        {mode === "create" ? (
          <>
            <Button variant="secondary" type="submit" loading={pending && intent === "draft"} disabled={pending}>
              Save as draft
            </Button>
            <Button onClick={() => void submit("publish")} loading={pending && intent === "publish"} disabled={pending}>
              {v.planned_editor_id ? "Publish & assign" : "Publish to team"}
            </Button>
          </>
        ) : (
          <Button type="submit" loading={pending} disabled={pending}>
            Save changes
          </Button>
        )}
      </div>
    </form>
  );
}
