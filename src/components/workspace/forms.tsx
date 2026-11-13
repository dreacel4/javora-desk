"use client";

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Link2, MessageSquare, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { addAssetAction, addFileAssetAction, discardUploadsAction, removeAssetAction, updateBriefAction } from "@/lib/actions/projects";
import {
  beginReviewAction,
  reviewStoryboardAction,
  reviewSubmissionAction,
  reviewUnderstandingAction,
  submitStoryboardAction,
  submitUnderstandingAction,
  submitWorkAction,
} from "@/lib/actions/workflow";
import { isGoogleDriveUrl } from "@/lib/validation/project";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { ConfirmDialog, Modal, useAction } from "@/components/ui/overlay";
import { FilePicker, useFileUpload } from "./file-upload";

type FieldErrors = Record<string, string[] | undefined>;

/* =========================================================================== */
/* Editor understanding                                                        */
/* =========================================================================== */
const UNDERSTANDING_FIELDS = [
  { key: "materials_description", label: "1. Received materials", hint: "What footage, audio, graphics and documents did you receive? Anything unusable?", rows: 4, required: true },
  { key: "requirements_understanding", label: "2. Client requirements", hint: "In your own words: what does the client actually want?", rows: 4, required: true },
  { key: "editing_approach", label: "3. Proposed editing approach", hint: "Style, pacing, music, captions, colour, transitions.", rows: 4, required: true },
  { key: "visual_sequence", label: "4. Planned visual sequence", hint: "The order of scenes/beats from start to end.", rows: 5, required: true },
  { key: "expected_deliverables", label: "5. Expected deliverables", hint: "Files, versions, formats, durations you will deliver.", rows: 3, required: true },
  { key: "missing_assets", label: "6. Missing assets or unclear instructions", hint: "Leave empty if nothing is missing.", rows: 3, required: false },
  { key: "questions", label: "7. Questions for the dispatcher", hint: "Leave empty if you have none.", rows: 3, required: false },
] as const;
type UnderstandingKey = (typeof UNDERSTANDING_FIELDS)[number]["key"];

export function UnderstandingForm({
  projectId,
  previous,
}: {
  projectId: string;
  previous?: Pick<Tables<"editor_responses">, UnderstandingKey> | null;
}) {
  const [values, setValues] = useState<Record<UnderstandingKey, string>>(() => {
    const init = {} as Record<UnderstandingKey, string>;
    for (const f of UNDERSTANDING_FIELDS) init[f.key] = previous?.[f.key] ?? "";
    return init;
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const upload = useFileUpload(projectId, "understanding");
  const { run, pending } = useAction();

  const submit = async () => {
    setErrors({});
    let files: { path: string; name: string }[] = [];
    try {
      files = await upload.upload();
    } catch (e) {
      upload.setError(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const res = await run(() => submitUnderstandingAction(projectId, values, files));
    if (res.ok) upload.reset();
    else {
      setErrors(res.fieldErrors ?? {});
      if (files.length) await discardUploadsAction(files.map((f) => f.path));
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      {UNDERSTANDING_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} required={f.required} error={errors[f.key]}>
          {(p) => (
            <Textarea
              {...p}
              rows={f.rows}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              maxLength={8000}
            />
          )}
        </Field>
      ))}
      <div>
        <p className="mb-1.5 text-[13px] font-medium">Attachments <span className="font-normal text-ink-muted">(optional)</span></p>
        <FilePicker state={upload} hint="Notes, sketches, marked-up screenshots · PDF, images, DOCX, TXT, ZIP" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending || upload.uploading}>
          Submit understanding
        </Button>
      </div>
    </form>
  );
}

export function UnderstandingReview({ responseId }: { responseId: string }) {
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        title="Request clarification?"
        description="The editor sees your note and resubmits their understanding."
        confirmLabel="Send to editor"
        reason={{ label: "What needs clarification?", required: true, minLength: 5 }}
        onConfirm={(note) => reviewUnderstandingAction(responseId, "clarification_requested", note)}
        trigger={(open) => (
          <Button variant="secondary" icon={<MessageSquare className="size-4" />} onClick={open} disabled={pending}>
            Request clarification
          </Button>
        )}
      />
      <Button variant="success" icon={<Check className="size-4" />} loading={pending} onClick={() => run(() => reviewUnderstandingAction(responseId, "approved", ""))}>
        Approve understanding
      </Button>
    </div>
  );
}

/* =========================================================================== */
/* Storyboard                                                                  */
/* =========================================================================== */
export function StoryboardForm({ projectId }: { projectId: string }) {
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const upload = useFileUpload(projectId, "storyboards");
  const { run, pending } = useAction();

  const submit = async () => {
    setErrors({});
    if (upload.files.length === 0) {
      upload.setError("Attach at least one storyboard file (PDF, PNG or JPG).");
      return;
    }
    let files: { path: string; name: string }[];
    try {
      files = await upload.upload();
    } catch (e) {
      upload.setError(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const res = await run(() => submitStoryboardAction(projectId, { description, sequence_notes: notes, files }));
    if (res.ok) {
      upload.reset();
      setDescription("");
      setNotes("");
    } else {
      setErrors(res.fieldErrors ?? {});
      await discardUploadsAction(files.map((f) => f.path));
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <FilePicker state={upload} label="Upload storyboard" hint="PDF, PNG or JPG · up to 50 MB each" />
      <Field label="Description" required error={errors.description} hint="What the storyboard shows and how it maps to the brief.">
        {(p) => <Textarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} />}
      </Field>
      <Field label="Sequence notes" error={errors.sequence_notes} hint="Timings, transitions or panel-specific notes.">
        {(p) => <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={8000} />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" icon={<Upload className="size-4" />} loading={pending || upload.uploading}>
          Submit for approval
        </Button>
      </div>
    </form>
  );
}

export function StoryboardReview({ storyboardId, pending: isPending }: { storyboardId: string; pending: boolean }) {
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        title="Add a comment"
        description="Comments are kept with this storyboard version and sent to the editor."
        confirmLabel="Add comment"
        reason={{ label: "Comment", required: true, minLength: 1 }}
        onConfirm={(c) => reviewStoryboardAction(storyboardId, "comment", c)}
        trigger={(open) => (
          <Button variant="ghost" size="sm" icon={<MessageSquare className="size-4" />} onClick={open}>
            Comment
          </Button>
        )}
      />
      {isPending && (
        <>
          <ConfirmDialog
            title="Request storyboard changes?"
            description="The editor uploads a new version addressing your feedback."
            confirmLabel="Request changes"
            reason={{ label: "Requested changes", required: true, minLength: 5 }}
            onConfirm={(c) => reviewStoryboardAction(storyboardId, "changes_requested", c)}
            trigger={(open) => (
              <Button variant="secondary" size="sm" onClick={open} disabled={pending}>
                Request changes
              </Button>
            )}
          />
          <Button variant="success" size="sm" icon={<Check className="size-4" />} loading={pending} onClick={() => run(() => reviewStoryboardAction(storyboardId, "approved", ""))}>
            Approve storyboard
          </Button>
        </>
      )}
    </div>
  );
}

/* =========================================================================== */
/* Submission                                                                  */
/* =========================================================================== */
export function SubmissionForm({
  projectId,
  defaults,
  nextVersion,
  openRevisionReason,
}: {
  projectId: string;
  defaults: { export_resolution: string; aspect_ratio: string; frame_rate: string; export_format: string };
  nextVersion: number;
  openRevisionReason?: string | null;
}) {
  const [v, setV] = useState({
    drive_url: "",
    file_name: "",
    version_label: `v${nextVersion}`,
    export_resolution: defaults.export_resolution,
    aspect_ratio: defaults.aspect_ratio,
    frame_rate: defaults.frame_rate,
    export_format: defaults.export_format,
    work_summary: "",
    completed_requirements: "",
    deviations: "",
    notes: "",
  });
  const [access, setAccess] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const { run, pending } = useAction();
  const set = (k: keyof typeof v, value: string) => setV((s) => ({ ...s, [k]: value }));
  const driveValid = v.drive_url === "" || isGoogleDriveUrl(v.drive_url);

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setErrors({});
        const res = await run(() => submitWorkAction(projectId, { ...v, access_confirmed: access as true }));
        if (!res.ok) setErrors(res.fieldErrors ?? {});
      }}
    >
      {openRevisionReason && (
        <Alert tone="warning" title="Revision requested">
          {openRevisionReason}
        </Alert>
      )}
      <Field label="Google Drive link" required error={errors.drive_url ?? (!driveValid ? "This doesn't look like a Google Drive file or folder link." : undefined)}>
        {(p) => <Input {...p} type="url" inputMode="url" value={v.drive_url} onChange={(e) => set("drive_url", e.target.value)} placeholder="https://drive.google.com/file/d/…" />}
      </Field>
      <Alert tone="info" title="Check sharing before you submit">
        Open the link in a private window or confirm it is shared with the dispatcher&apos;s account. JAVORA DESK cannot verify Drive permissions for you.
        {v.drive_url && driveValid && (
          <a href={v.drive_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium underline">
            Test the link <ExternalLink className="size-3.5" />
          </a>
        )}
      </Alert>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_140px]">
        <Field label="Final file name" required error={errors.file_name}>
          {(p) => <Input {...p} value={v.file_name} onChange={(e) => set("file_name", e.target.value)} placeholder="client_teaser_final_v1.mp4" maxLength={255} />}
        </Field>
        <Field label="Version" required error={errors.version_label}>
          {(p) => <Input {...p} value={v.version_label} onChange={(e) => set("version_label", e.target.value)} maxLength={40} />}
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Export resolution" required error={errors.export_resolution}>
          {(p) => <Input {...p} value={v.export_resolution} onChange={(e) => set("export_resolution", e.target.value)} maxLength={40} />}
        </Field>
        <Field label="Aspect ratio" required error={errors.aspect_ratio}>
          {(p) => <Input {...p} value={v.aspect_ratio} onChange={(e) => set("aspect_ratio", e.target.value)} maxLength={20} />}
        </Field>
        <Field label="Frame rate" required error={errors.frame_rate}>
          {(p) => <Input {...p} value={v.frame_rate} onChange={(e) => set("frame_rate", e.target.value)} maxLength={20} />}
        </Field>
        <Field label="Export format" required error={errors.export_format}>
          {(p) => <Input {...p} value={v.export_format} onChange={(e) => set("export_format", e.target.value)} maxLength={80} />}
        </Field>
      </div>
      <Field label="Work summary" required error={errors.work_summary} hint="What you produced and the key creative decisions.">
        {(p) => <Textarea {...p} rows={4} value={v.work_summary} onChange={(e) => set("work_summary", e.target.value)} maxLength={8000} />}
      </Field>
      <Field label="Completed requirements" required error={errors.completed_requirements} hint="List each brief requirement you fulfilled.">
        {(p) => <Textarea {...p} rows={4} value={v.completed_requirements} onChange={(e) => set("completed_requirements", e.target.value)} maxLength={8000} />}
      </Field>
      <Field label="Deviations from the brief" error={errors.deviations} hint="Anything you did differently, and why. Leave empty if none.">
        {(p) => <Textarea {...p} rows={3} value={v.deviations} onChange={(e) => set("deviations", e.target.value)} maxLength={8000} />}
      </Field>
      <Field label="Additional notes" error={errors.notes}>
        {(p) => <Textarea {...p} rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={8000} />}
      </Field>
      <div className="rounded-xl border border-line bg-canvas/60 p-4">
        <Checkbox
          checked={access}
          onChange={(e) => setAccess(e.target.checked)}
          label="I confirmed the dispatcher can open this Drive link"
          description="Submitting ends your active work session."
        />
        {errors.access_confirmed && <p className="mt-2 text-xs text-danger">{errors.access_confirmed[0]}</p>}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!access || !driveValid}>
          Submit for review
        </Button>
      </div>
    </form>
  );
}

export function SubmissionReview({
  projectId,
  submissionId,
  projectStatus,
}: {
  projectId: string;
  submissionId: string;
  projectStatus: string;
}) {
  const { run, pending } = useAction();
  const [mode, setMode] = useState<null | "approve" | "revise">(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  if (projectStatus === "submitted") {
    return (
      <Button loading={pending} onClick={() => run(() => beginReviewAction(projectId))}>
        Start review
      </Button>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<AlertTriangle className="size-4" />} onClick={() => setMode("revise")}>
          Request revision
        </Button>
        <Button variant="success" icon={<Check className="size-4" />} onClick={() => setMode("approve")}>
          Approve delivery
        </Button>
      </div>
      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "approve" ? "Approve this delivery?" : "Request a revision"}
        description={
          mode === "approve"
            ? "The project is marked completed and the editor is notified."
            : "The editor is notified with your reason and the project returns to production."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={mode === "approve" ? "success" : "primary"}
              loading={pending}
              disabled={mode === "revise" && reason.trim().length < 5}
              onClick={async () => {
                const res = await run(() =>
                  reviewSubmissionAction(submissionId, { decision: mode === "approve" ? "approved" : "revision_requested", notes, reason }),
                );
                if (res.ok) {
                  setMode(null);
                  setNotes("");
                  setReason("");
                }
              }}
            >
              {mode === "approve" ? "Approve & complete" : "Send revision request"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {mode === "revise" && (
            <Field label="Reason" required hint="What must change? Be specific — this is what the editor works from.">
              {(p) => <Textarea {...p} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={4000} autoFocus />}
            </Field>
          )}
          <Field label={mode === "approve" ? "Notes for the editor (optional)" : "Revision notes (optional)"}>
            {(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={8000} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* =========================================================================== */
/* Brief editing (managers)                                                    */
/* =========================================================================== */
export function BriefEditor({
  projectId,
  isDraft,
  current,
}: {
  projectId: string;
  isDraft: boolean;
  current: Pick<Tables<"project_briefs">, "original_client_brief" | "editing_requirements" | "additional_instructions">;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...current, change_note: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const { run, pending } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => { setV({ ...current, change_note: "" }); setOpen(true); }}>
        {isDraft ? "Edit brief" : "Publish new version"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={isDraft ? "Edit draft brief" : "New brief version"}
        description={
          isDraft
            ? "Drafts are edited in place. Once published, every change creates a new version."
            : "Earlier versions stay unchanged and visible. The assigned editor is notified."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                setErrors({});
                const res = await run(() => updateBriefAction(projectId, v));
                if (res.ok) setOpen(false);
                else setErrors(res.fieldErrors ?? {});
              }}
            >
              {isDraft ? "Save brief" : "Publish version"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {!isDraft && (
            <Field label="What changed?" required error={errors.change_note} hint="Shown to the editor and in the version history.">
              {(p) => <Input {...p} value={v.change_note} onChange={(e) => setV((s) => ({ ...s, change_note: e.target.value }))} maxLength={2000} placeholder="e.g. Client extended the duration to 45 seconds" />}
            </Field>
          )}
          <Field label="Client brief" required error={errors.original_client_brief}>
            {(p) => <Textarea {...p} rows={8} value={v.original_client_brief} onChange={(e) => setV((s) => ({ ...s, original_client_brief: e.target.value }))} maxLength={20000} />}
          </Field>
          <Field label="Editing requirements" error={errors.editing_requirements}>
            {(p) => <Textarea {...p} rows={5} value={v.editing_requirements} onChange={(e) => setV((s) => ({ ...s, editing_requirements: e.target.value }))} maxLength={20000} />}
          </Field>
          <Field label="Additional instructions" error={errors.additional_instructions}>
            {(p) => <Textarea {...p} rows={3} value={v.additional_instructions} onChange={(e) => setV((s) => ({ ...s, additional_instructions: e.target.value }))} maxLength={20000} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}

/* =========================================================================== */
/* Materials (managers)                                                        */
/* =========================================================================== */
export function AddMaterial({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"link" | "file">("link");
  const [v, setV] = useState({ kind: "raw_material" as "raw_material" | "reference", label: "", url: "", notes: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const upload = useFileUpload(projectId, "materials", 1);
  const { run, pending } = useAction();

  const close = () => {
    setOpen(false);
    setErrors({});
    upload.reset();
    setV({ kind: "raw_material", label: "", url: "", notes: "" });
  };

  const save = async () => {
    setErrors({});
    if (source === "link") {
      const res = await run(() => addAssetAction(projectId, v));
      if (res.ok) close();
      else setErrors(res.fieldErrors ?? {});
      return;
    }
    if (upload.files.length === 0) {
      upload.setError("Choose a file to upload.");
      return;
    }
    try {
      const [file] = await upload.upload();
      const res = await run(() =>
        addFileAssetAction(projectId, { kind: v.kind, label: v.label || file.name, notes: v.notes, path: file.path, fileName: file.name }),
      );
      if (res.ok) close();
      else setErrors(res.fieldErrors ?? {});
    } catch (e) {
      upload.setError(e instanceof Error ? e.message : "Upload failed.");
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
        Add material
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Add material or reference"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending || upload.uploading}>
              Cancel
            </Button>
            <Button loading={pending || upload.uploading} onClick={save}>
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-navy-50 p-1" role="tablist">
            {(["link", "file"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={`flex h-8 items-center justify-center gap-2 rounded-md text-[13px] font-medium ${source === s ? "bg-surface text-ink shadow-sm" : "text-ink-muted"}`}
              >
                {s === "link" ? <Link2 className="size-4" /> : <Upload className="size-4" />}
                {s === "link" ? "Link" : "Upload file"}
              </button>
            ))}
          </div>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={v.kind} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value as typeof v.kind }))}>
                <option value="raw_material">Raw material</option>
                <option value="reference">Reference</option>
              </Select>
            )}
          </Field>
          <Field label="Label" required={source === "link"} error={errors.label}>
            {(p) => <Input {...p} value={v.label} onChange={(e) => setV((s) => ({ ...s, label: e.target.value }))} maxLength={160} placeholder="e.g. Raw footage — day 1" />}
          </Field>
          {source === "link" ? (
            <Field label="URL" required error={errors.url}>
              {(p) => <Input {...p} type="url" value={v.url} onChange={(e) => setV((s) => ({ ...s, url: e.target.value }))} placeholder="https://…" />}
            </Field>
          ) : (
            <FilePicker state={upload} label="Choose file" hint="Scripts, logos, subtitles, notes · up to 50 MB. Use links for video footage." />
          )}
          <Field label="Notes" error={errors.notes}>
            {(p) => <Textarea {...p} rows={2} value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} maxLength={2000} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function RemoveAssetButton({ assetId, label }: { assetId: string; label: string }) {
  return (
    <ConfirmDialog
      title={`Remove “${label}”?`}
      description="It disappears from the materials list but remains recorded in the activity history."
      confirmLabel="Remove"
      tone="danger"
      onConfirm={() => removeAssetAction(assetId)}
      trigger={(open) => (
        <button type="button" onClick={open} className="rounded-md p-1.5 text-ink-subtle hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${label}`}>
          <Trash2 className="size-4" />
        </button>
      )}
    />
  );
}

export function DismissibleNote({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="relative">
      {children}
      <button type="button" onClick={() => setHidden(true)} className="absolute top-3 right-3 text-ink-subtle hover:text-ink" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}
