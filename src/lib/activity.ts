import type { Json } from "@/lib/supabase/database.types";

type Details = Record<string, Json | undefined>;
type Names = Record<string, { name: string } | undefined>;

const asObj = (d: Json): Details => (d && typeof d === "object" && !Array.isArray(d) ? (d as Details) : {});
const str = (v: Json | undefined) => (typeof v === "string" ? v : v == null ? "" : String(v));
const human = (s: string) => s.replace(/_/g, " ");

/** Human-readable sentence for an activity entry (actor name is rendered separately). */
export function describeActivity(action: string, raw: Json, people: Names): string {
  const d = asObj(raw);
  const who = (id: Json | undefined) => people[str(id)]?.name ?? "an editor";
  switch (action) {
    case "project.created": return "created the project";
    case "project.updated": {
      const changes = Object.keys(asObj(d.changes ?? null)).map(human);
      return changes.length ? `updated ${changes.slice(0, 4).join(", ")}${changes.length > 4 ? "…" : ""}` : "updated project details";
    }
    case "project.published": return d.assigned_editor_id ? `published and assigned it to ${who(d.assigned_editor_id)}` : "published the project to the team";
    case "project.editor_planned": return `planned ${who(d.editor_id)} as the editor`;
    case "project.claimed": return "claimed the project";
    case "project.assigned": return `assigned ${who(d.editor_id)}`;
    case "project.reassigned": return `reassigned from ${who(d.previous_editor_id)} to ${who(d.editor_id)}${d.reason ? ` — “${str(d.reason)}”` : ""}`;
    case "project.unassigned": return `unassigned ${who(d.previous_editor_id)} — “${str(d.reason)}”`;
    case "project.production_started": return "started production";
    case "project.on_hold": return `put the project on hold — “${str(d.reason)}”`;
    case "project.resumed": return "resumed the project";
    case "project.cancelled": return `cancelled the project — “${str(d.reason)}”`;
    case "project.archived": return "archived the project";
    case "project.unarchived": return "restored the project from the archive";
    case "project.deleted": return `deleted draft “${str(d.title)}”`;
    case "brief.edited_draft": return "edited the draft brief";
    case "brief.versioned": return `published brief v${str(d.version)} — “${str(d.change_note)}”`;
    case "asset.added": return `added ${human(str(d.kind))} “${str(d.label)}”`;
    case "asset.removed": return `removed “${str(d.label)}”`;
    case "understanding.submitted": return `submitted their understanding (v${str(d.version)})`;
    case "understanding.approved": return "approved the editor's understanding";
    case "understanding.clarification_requested": return `requested clarification — “${str(d.note)}”`;
    case "storyboard.submitted": return `submitted storyboard v${str(d.version)}`;
    case "storyboard.approved": return `approved storyboard v${str(d.version)}`;
    case "storyboard.changes_requested": return `requested storyboard changes (v${str(d.version)})`;
    case "storyboard.commented": return "commented on the storyboard";
    case "work_session.started": return "started a work session";
    case "work_session.paused": return "paused the timer";
    case "work_session.resumed": return "resumed the timer";
    case "work_session.stopped": return "stopped the timer";
    case "work_session.auto_paused": return "timer auto-paused after the browser stopped responding";
    case "submission.created": return `submitted delivery #${str(d.sequence)}`;
    case "review.started": return "started reviewing the submission";
    case "submission.approved": return `approved delivery #${str(d.sequence)} — project completed`;
    case "submission.revision_requested": return `requested a revision on delivery #${str(d.sequence)} — “${str(d.reason)}”`;
    case "member.joined": return `joined as ${human(str(d.role))}`;
    case "member.invited": return `invited ${str(d.email)} as ${human(str(d.role))}`;
    case "member.invitation_revoked": return `revoked the invitation for ${str(d.email)}`;
    case "member.role_changed": return `changed ${who(d.user_id)}'s role from ${str(d.from)} to ${str(d.to)}`;
    case "member.disabled": return `disabled ${str(d.email)}`;
    case "member.enabled": return `re-enabled ${str(d.email)}`;
    case "workspace.settings_updated": return "updated workspace settings";
    default: return human(action.replace(".", " "));
  }
}

export function activityTone(action: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (/approved|completed/.test(action)) return "success";
  if (/revision|changes_requested|clarification|cancelled|on_hold|auto_paused/.test(action)) return "warning";
  if (/deleted|disabled|removed/.test(action)) return "danger";
  if (/submitted|claimed|published|assigned/.test(action)) return "info";
  return "neutral";
}
