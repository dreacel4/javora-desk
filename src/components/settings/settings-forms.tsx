"use client";

import { useMemo, useState } from "react";
import { updateProfileAction, updateWorkspaceAction } from "@/lib/actions/settings";
import type { AppRole } from "@/lib/types";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Toggle } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { useAction } from "@/components/ui/overlay";

const NOTIFICATION_GROUPS: { title: string; roles: AppRole[]; items: { key: string; label: string }[] }[] = [
  {
    title: "Projects",
    roles: ["owner", "dispatcher", "editor"],
    items: [
      { key: "project_available", label: "New project available" },
      { key: "project_assigned", label: "Project assigned to me" },
      { key: "project_unassigned", label: "Removed from a project" },
      { key: "project_claimed", label: "Project claimed by an editor" },
      { key: "brief_updated", label: "Brief updated" },
      { key: "project_updated", label: "Project details changed" },
      { key: "materials_added", label: "Materials added" },
      { key: "project_status_changed", label: "Project put on hold, resumed or cancelled" },
      { key: "deadline_approaching", label: "Deadline approaching" },
    ],
  },
  {
    title: "Production workflow",
    roles: ["owner", "dispatcher", "editor"],
    items: [
      { key: "confirmation_submitted", label: "Editor understanding submitted" },
      { key: "confirmation_approved", label: "My understanding approved" },
      { key: "confirmation_clarification", label: "Clarification requested" },
      { key: "storyboard_submitted", label: "Storyboard submitted" },
      { key: "storyboard_approved", label: "Storyboard approved" },
      { key: "storyboard_changes_requested", label: "Storyboard changes requested" },
      { key: "storyboard_comment", label: "Storyboard comment" },
      { key: "work_submitted", label: "Work submitted" },
      { key: "revision_requested", label: "Revision requested" },
      { key: "project_approved", label: "Project approved" },
      { key: "session_auto_paused", label: "Timer paused automatically" },
    ],
  },
];

const MANAGER_ONLY = new Set(["project_claimed", "confirmation_submitted", "storyboard_submitted", "work_submitted"]);
const EDITOR_ONLY = new Set([
  "project_available", "project_assigned", "project_unassigned", "confirmation_approved", "confirmation_clarification",
  "storyboard_approved", "storyboard_changes_requested", "storyboard_comment", "revision_requested", "project_approved",
  "session_auto_paused", "brief_updated", "project_updated", "materials_added", "project_status_changed",
]);

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Asia/Jakarta", "UTC"];
  }
}

export function ProfileSettings({ profile }: { profile: Pick<Tables<"profiles">, "full_name" | "email" | "timezone" | "notification_prefs" | "role"> }) {
  const [name, setName] = useState(profile.full_name);
  const [tz, setTz] = useState(profile.timezone);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const raw = profile.notification_prefs;
    const out: Record<string, boolean> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") out[k] = v;
    }
    return out;
  });
  const zones = useMemo(() => timeZones(), []);
  const { run, pending } = useAction();
  const manager = profile.role !== "editor";
  const relevant = (key: string) => (manager ? !EDITOR_ONLY.has(key) || key === "deadline_approaching" || key === "project_updated" : !MANAGER_ONLY.has(key));

  const save = () => run(() => updateProfileAction({ full_name: name, timezone: tz, prefs }));

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Profile" description="How you appear to the team." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
          </Field>
          <Field label="Email" hint="Contact the owner to change your sign-in email.">
            {(p) => <Input {...p} value={profile.email} disabled />}
          </Field>
          <Field label="Time zone" hint="Deadlines and timestamps are shown in this zone.">
            {(p) => (
              <Select {...p} value={tz} onChange={(e) => setTz(e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <a href="/account/password" className="text-[13px] font-medium text-accent hover:underline">
              Change password →
            </a>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notification preferences" description="In-app notifications you want to receive. Everything is on by default." />
        <CardBody className="flex flex-col gap-6">
          {NOTIFICATION_GROUPS.map((g) => {
            const items = g.items.filter((i) => relevant(i.key));
            if (items.length === 0) return null;
            return (
              <div key={g.title}>
                <p className="mb-3 text-xs font-semibold tracking-wide text-ink-muted uppercase">{g.title}</p>
                <div className="flex flex-col gap-3.5">
                  {items.map((i) => (
                    <Toggle key={i.key} label={i.label} checked={prefs[i.key] ?? true} onChange={(c) => setPrefs((s) => ({ ...s, [i.key]: c }))} />
                  ))}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button loading={pending} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

export function WorkspaceSettingsForm({ settings }: { settings: Tables<"workspace_settings"> }) {
  const [v, setV] = useState({
    workspace_name: settings.workspace_name,
    timezone: settings.timezone,
    default_priority: settings.default_priority,
    default_client_platform: settings.default_client_platform,
    default_resolution: settings.default_resolution,
    default_aspect_ratio: settings.default_aspect_ratio,
    default_frame_rate: settings.default_frame_rate,
    default_delivery_format: settings.default_delivery_format,
    default_storyboard_required: settings.default_storyboard_required,
    deadline_warning_hours: String(settings.deadline_warning_hours),
    stale_session_minutes: String(settings.stale_session_minutes),
    max_active_projects_per_editor: String(settings.max_active_projects_per_editor),
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const zones = useMemo(() => timeZones(), []);
  const { run, pending } = useAction();
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Workspace" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Workspace name" required error={errors.workspace_name}>
            {(p) => <Input {...p} value={v.workspace_name} onChange={(e) => set("workspace_name", e.target.value)} maxLength={80} />}
          </Field>
          <Field label="Default time zone for new members">
            {(p) => (
              <Select {...p} value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Project defaults" description="Pre-filled on the New Project form." />
        <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client platform">
            {(p) => <Input {...p} value={v.default_client_platform} onChange={(e) => set("default_client_platform", e.target.value)} maxLength={60} />}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select {...p} value={v.default_priority} onChange={(e) => set("default_priority", e.target.value as typeof v.default_priority)}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </Select>
            )}
          </Field>
          <Field label="Resolution">
            {(p) => <Input {...p} value={v.default_resolution} onChange={(e) => set("default_resolution", e.target.value)} maxLength={40} />}
          </Field>
          <Field label="Aspect ratio">
            {(p) => <Input {...p} value={v.default_aspect_ratio} onChange={(e) => set("default_aspect_ratio", e.target.value)} maxLength={20} />}
          </Field>
          <Field label="Frame rate">
            {(p) => <Input {...p} value={v.default_frame_rate} onChange={(e) => set("default_frame_rate", e.target.value)} maxLength={20} />}
          </Field>
          <Field label="Delivery format">
            {(p) => <Input {...p} value={v.default_delivery_format} onChange={(e) => set("default_delivery_format", e.target.value)} maxLength={80} />}
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Toggle label="Require storyboard approval by default" checked={v.default_storyboard_required} onChange={(c) => set("default_storyboard_required", c)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Workflow rules" />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          <Field label="Deadline reminder (hours before)" error={errors.deadline_warning_hours}>
            {(p) => <Input {...p} type="number" min={1} max={168} value={v.deadline_warning_hours} onChange={(e) => set("deadline_warning_hours", e.target.value)} />}
          </Field>
          <Field label="Auto-pause idle timers after (minutes)" error={errors.stale_session_minutes} hint="When a browser stops responding.">
            {(p) => <Input {...p} type="number" min={3} max={120} value={v.stale_session_minutes} onChange={(e) => set("stale_session_minutes", e.target.value)} />}
          </Field>
          <Field label="Max active projects per editor" error={errors.max_active_projects_per_editor} hint="0 = no limit. Applies to claiming.">
            {(p) => <Input {...p} type="number" min={0} max={50} value={v.max_active_projects_per_editor} onChange={(e) => set("max_active_projects_per_editor", e.target.value)} />}
          </Field>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button
          loading={pending}
          onClick={async () => {
            setErrors({});
            const res = await run(() => updateWorkspaceAction(v));
            if (!res.ok) setErrors(res.fieldErrors ?? {});
          }}
        >
          Save workspace settings
        </Button>
      </div>
    </div>
  );
}
