"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Hand,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Send,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  assignEditorAction,
  cancelProjectAction,
  claimProjectAction,
  deleteDraftAction,
  holdProjectAction,
  publishProjectAction,
  resumeProjectAction,
  setArchivedAction,
  unassignEditorAction,
} from "@/lib/actions/projects";
import type { AppRole, Project } from "@/lib/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal, useAction } from "@/components/ui/overlay";
import { Dropdown, MenuItem } from "@/components/ui/nav";

const ASSIGNABLE = ["available", "claimed", "awaiting_confirmation", "awaiting_storyboard_approval", "ready_to_start", "in_progress", "revision_requested"];

export function ProjectActions({
  project,
  role,
  editors,
}: {
  project: Pick<Project, "id" | "status" | "assigned_editor_id" | "archived_at" | "title" | "deadline">;
  role: AppRole;
  editors: { id: string; name: string }[];
}) {
  const manager = role !== "editor";
  const { run, pending } = useAction();
  const [assignOpen, setAssignOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "hold" | "cancel" | "unassign" | "delete">(null);

  const s = project.status;
  const closed = s === "completed" || s === "cancelled";

  if (!manager) {
    if (s === "available") {
      return (
        <ConfirmDialog
          title="Claim this project?"
          description="It will be assigned to you. Your next step is to submit your understanding of the brief."
          confirmLabel="Claim project"
          onConfirm={() => claimProjectAction(project.id)}
          trigger={(open) => (
            <Button icon={<Hand className="size-4" />} onClick={open}>
              Claim project
            </Button>
          )}
        />
      );
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {s === "draft" && (
        <ConfirmDialog
          title="Publish this project?"
          description={
            project.assigned_editor_id
              ? "The planned editor is assigned and notified."
              : "All active editors are notified and can claim it."
          }
          confirmLabel="Publish"
          onConfirm={() => publishProjectAction(project.id)}
          trigger={(open) => (
            <Button icon={<Send className="size-4" />} onClick={open} disabled={!project.deadline} title={!project.deadline ? "Set a deadline first" : undefined}>
              Publish
            </Button>
          )}
        />
      )}
      {s === "on_hold" && (
        <Button icon={<Play className="size-4" />} loading={pending} onClick={() => run(() => resumeProjectAction(project.id))}>
          Resume project
        </Button>
      )}
      {!closed && (
        <ButtonLink href={`/projects/${project.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>
          Edit
        </ButtonLink>
      )}

      <Dropdown
        trigger={(p) => (
          <Button {...p} variant="secondary" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        )}
      >
        {(close) => (
          <>
            {(s === "draft" || ASSIGNABLE.includes(s)) && (
              <MenuItem icon={<UserPlus className="size-4 text-ink-muted" />} onClick={() => { close(); setAssignOpen(true); }}>
                {project.assigned_editor_id ? "Reassign editor" : s === "draft" ? "Plan editor" : "Assign editor"}
              </MenuItem>
            )}
            {project.assigned_editor_id && ASSIGNABLE.includes(s) && s !== "available" && (
              <MenuItem icon={<UserMinus className="size-4 text-ink-muted" />} onClick={() => { close(); setDialog("unassign"); }}>
                Unassign editor
              </MenuItem>
            )}
            {!closed && s !== "draft" && s !== "on_hold" && (
              <MenuItem icon={<Pause className="size-4 text-ink-muted" />} onClick={() => { close(); setDialog("hold"); }}>
                Put on hold
              </MenuItem>
            )}
            {closed && !project.archived_at && (
              <MenuItem icon={<Archive className="size-4 text-ink-muted" />} onClick={() => { close(); void run(() => setArchivedAction(project.id, true)); }}>
                Archive
              </MenuItem>
            )}
            {project.archived_at && (
              <MenuItem icon={<ArchiveRestore className="size-4 text-ink-muted" />} onClick={() => { close(); void run(() => setArchivedAction(project.id, false)); }}>
                Restore from archive
              </MenuItem>
            )}
            {!closed && (
              <MenuItem tone="danger" icon={<Ban className="size-4" />} onClick={() => { close(); setDialog("cancel"); }}>
                Cancel project
              </MenuItem>
            )}
            {s === "draft" && role === "owner" && (
              <MenuItem tone="danger" icon={<Trash2 className="size-4" />} onClick={() => { close(); setDialog("delete"); }}>
                Delete draft
              </MenuItem>
            )}
          </>
        )}
      </Dropdown>

      <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} project={project} editors={editors} />

      <ConfirmDialog
        title="Put project on hold?"
        description="Any running work session is stopped. You can resume the project later."
        confirmLabel="Put on hold"
        reason={{ label: "Reason", required: true, placeholder: "e.g. Waiting for client assets" }}
        onConfirm={(r) => holdProjectAction(project.id, r)}
        open={dialog === "hold"}
        onOpenChange={(o) => setDialog(o ? "hold" : null)}
      />
      <ConfirmDialog
        title="Cancel this project?"
        description="Cancelled projects keep their full history and can be archived. This cannot be undone."
        confirmLabel="Cancel project"
        tone="danger"
        reason={{ label: "Reason", required: true, placeholder: "e.g. Client cancelled the order" }}
        onConfirm={(r) => cancelProjectAction(project.id, r)}
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
      />
      <ConfirmDialog
        title="Unassign the editor?"
        description="Their open work session is stopped and the project becomes available to other editors."
        confirmLabel="Unassign"
        tone="danger"
        reason={{ label: "Reason (shared with the editor)", required: true }}
        onConfirm={(r) => unassignEditorAction(project.id, r)}
        open={dialog === "unassign"}
        onOpenChange={(o) => setDialog(o ? "unassign" : null)}
      />
      <ConfirmDialog
        title="Delete this draft permanently?"
        description="The draft, its brief and uploaded materials are removed. Published projects cannot be deleted — cancel and archive them instead."
        confirmLabel="Delete draft"
        tone="danger"
        onConfirm={() => deleteDraftAction(project.id)}
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
      />
    </div>
  );
}

function AssignModal({
  open,
  onClose,
  project,
  editors,
}: {
  open: boolean;
  onClose: () => void;
  project: Pick<Project, "id" | "status" | "assigned_editor_id">;
  editors: { id: string; name: string }[];
}) {
  const [editor, setEditor] = useState("");
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  const reassign = Boolean(project.assigned_editor_id);
  const choices = editors.filter((e) => e.id !== project.assigned_editor_id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reassign ? "Reassign editor" : project.status === "draft" ? "Plan editor" : "Assign editor"}
      description={
        reassign
          ? "The current editor's open session is stopped. The new editor starts by confirming their understanding of the brief."
          : project.status === "draft"
            ? "The editor is assigned and notified when you publish."
            : "The editor is notified and must confirm their understanding before starting."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={!editor || (reassign && reason.trim().length < 3)}
            onClick={async () => {
              const res = await run(() => assignEditorAction(project.id, editor, reason));
              if (res.ok) {
                setEditor("");
                setReason("");
                onClose();
              }
            }}
          >
            {reassign ? "Reassign" : "Assign"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Editor" required>
          {(p) => (
            <Select {...p} value={editor} onChange={(e) => setEditor(e.target.value)}>
              <option value="">Select an editor…</option>
              {choices.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          )}
        </Field>
        {reassign && (
          <Field label="Reason (shared with the previous editor)" required>
            {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}
          </Field>
        )}
      </div>
    </Modal>
  );
}
