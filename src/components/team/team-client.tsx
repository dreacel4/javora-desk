"use client";

import { useState } from "react";
import { MailPlus, MoreHorizontal, Send, ShieldCheck, UserCheck, UserX } from "lucide-react";
import {
  inviteMemberAction,
  resendActivationAction,
  revokeInvitationAction,
  setMemberActiveAction,
  setMemberRoleAction,
} from "@/lib/actions/team";
import type { AppRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Modal, useAction } from "@/components/ui/overlay";
import { Dropdown, MenuItem } from "@/components/ui/nav";

export function InviteButton() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: "", role: "editor" as AppRole, full_name: "", method: "google" as "google" | "email" });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const { run, pending } = useAction();
  return (
    <>
      <Button icon={<MailPlus className="size-4" />} onClick={() => setOpen(true)}>
        Invite member
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite a team member"
        description="The role you choose is stored on the server and cannot be changed by the invitee."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              icon={<Send className="size-4" />}
              loading={pending}
              onClick={async () => {
                setErrors({});
                const res = await run(() => inviteMemberAction(v));
                if (res.ok) {
                  setOpen(false);
                  setV({ email: "", role: "editor", full_name: "", method: "google" });
                } else setErrors(res.fieldErrors ?? {});
              }}
            >
              {v.method === "google" ? "Add member" : "Send invitation"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Full name" error={errors.full_name}>
            {(p) => <Input {...p} value={v.full_name} onChange={(e) => setV((s) => ({ ...s, full_name: e.target.value }))} maxLength={120} />}
          </Field>
          <Field label="How will they sign in?">
            {(p) => (
              <Select {...p} value={v.method} onChange={(e) => setV((s) => ({ ...s, method: e.target.value as "google" | "email" }))}>
                <option value="google">Google account (no email is sent)</option>
                <option value="email">Email invitation with password</option>
              </Select>
            )}
          </Field>
          <Field
            label={v.method === "google" ? "Google account email" : "Email"}
            required
            error={errors.email}
            hint={v.method === "google" ? "Must be the exact Gmail / Google Workspace address they will sign in with." : "They receive an email to set their password (requires SMTP in Supabase)."}
          >
            {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => setV((s) => ({ ...s, email: e.target.value }))} autoComplete="off" />}
          </Field>
          <Field label="Role" required hint="Dispatchers manage projects and reviews. Owners have full administrative access.">
            {(p) => (
              <Select {...p} value={v.role} onChange={(e) => setV((s) => ({ ...s, role: e.target.value as AppRole }))}>
                <option value="editor">Editor</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="owner">Owner</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function MemberActions({
  member,
  isSelf,
}: {
  member: { id: string; name: string; role: AppRole; is_active: boolean; signedIn: boolean };
  isSelf: boolean;
}) {
  const { run, pending } = useAction();
  const [roleOpen, setRoleOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [role, setRole] = useState<AppRole>(member.role);
  if (isSelf) return <span className="text-xs text-ink-subtle">You</span>;

  return (
    <>
      <Dropdown
        trigger={(p) => (
          <Button {...p} variant="ghost" size="icon" aria-label={`Actions for ${member.name}`} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<ShieldCheck className="size-4 text-ink-muted" />} onClick={() => { close(); setRole(member.role); setRoleOpen(true); }}>
              Change role
            </MenuItem>
            {!member.signedIn && member.is_active && (
              <MenuItem icon={<Send className="size-4 text-ink-muted" />} onClick={() => { close(); void run(() => resendActivationAction(member.id)); }}>
                Resend activation email
              </MenuItem>
            )}
            {member.is_active ? (
              <MenuItem tone="danger" icon={<UserX className="size-4" />} onClick={() => { close(); setDisableOpen(true); }}>
                Disable account
              </MenuItem>
            ) : (
              <MenuItem icon={<UserCheck className="size-4 text-ink-muted" />} onClick={() => { close(); void run(() => setMemberActiveAction(member.id, true)); }}>
                Re-enable account
              </MenuItem>
            )}
          </>
        )}
      </Dropdown>

      <Modal
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        size="sm"
        title={`Change ${member.name}'s role`}
        description="Editors with active projects must have them reassigned first."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoleOpen(false)}>Cancel</Button>
            <Button
              loading={pending}
              disabled={role === member.role}
              onClick={async () => {
                const res = await run(() => setMemberRoleAction(member.id, role));
                if (res.ok) setRoleOpen(false);
              }}
            >
              Save role
            </Button>
          </>
        }
      >
        <Field label="Role">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              <option value="editor">Editor</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="owner">Owner</option>
            </Select>
          )}
        </Field>
      </Modal>

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={`Disable ${member.name}?`}
        description="They are signed out of all data immediately and can no longer log in. Their history is kept. Running timers are stopped. You can re-enable the account later."
        confirmLabel="Disable account"
        tone="danger"
        onConfirm={() => setMemberActiveAction(member.id, false)}
      />
    </>
  );
}

export function RevokeInvitationButton({ id, email }: { id: string; email: string }) {
  return (
    <ConfirmDialog
      title={`Revoke the invitation for ${email}?`}
      confirmLabel="Revoke"
      tone="danger"
      onConfirm={() => revokeInvitationAction(id)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open}>
          Revoke
        </Button>
      )}
    />
  );
}
