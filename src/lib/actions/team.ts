"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/env";
import { fail } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";

const uuid = z.string().uuid();
const roleSchema = z.enum(["owner", "dispatcher", "editor"]);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: roleSchema,
  full_name: z.string().trim().max(120).default(""),
});

/**
 * Two-step invitation:
 *  1. `create_invitation` (user session) verifies the caller is an Owner and
 *     records the invitation + intended role in the database.
 *  2. The service-role client asks Supabase Auth to email the invite. The new
 *     auth user is only accepted by the database because step 1 exists.
 */
export async function inviteMemberAction(values: z.input<typeof inviteSchema>): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { data: invitationId, error } = await supabase.rpc("create_invitation", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_full_name: parsed.data.full_name,
  });
  if (error) return fail(error);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    await supabase.rpc("revoke_invitation", { p_invitation: invitationId as string });
    return { ok: false, error: "Invitations are not configured: SUPABASE_SECRET_KEY is missing on the server." };
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent("/account/password?flow=invite")}`,
    data: { full_name: parsed.data.full_name },
  });
  if (inviteError) {
    await supabase.rpc("revoke_invitation", { p_invitation: invitationId as string });
    if (inviteError.status === 429) return { ok: false, error: "Email rate limit reached. Try again later or configure custom SMTP in Supabase." };
    if (/already been registered|already registered|exists/i.test(inviteError.message)) {
      return { ok: false, error: "An account with this email already exists in Supabase Auth." };
    }
    console.error("[javora] inviteUserByEmail failed", inviteError);
    return { ok: false, error: "The invitation email could not be sent. Check the Supabase email settings." };
  }

  revalidatePath("/team");
  return { ok: true, message: `Invitation sent to ${parsed.data.email}.` };
}

/** Re-sends an activation link (password-set email) to a member who never signed in. */
export async function resendActivationAction(userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid member." };
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("is_owner");
  if (!me) return { ok: false, error: "Only the owner can resend invitations." };
  const { data: member } = await supabase.from("profiles").select("email, last_sign_in_at, is_active").eq("id", userId).maybeSingle();
  if (!member) return { ok: false, error: "Member not found." };
  if (member.last_sign_in_at) return { ok: false, error: "This member has already signed in." };
  const { error } = await supabase.auth.resetPasswordForEmail(member.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent("/account/password?flow=invite")}`,
  });
  if (error) return { ok: false, error: error.status === 429 ? "Please wait before sending another email." : "Could not send the email." };
  return { ok: true, message: `Activation link sent to ${member.email}.` };
}

export async function setMemberRoleAction(userId: string, role: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid member." };
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { ok: false, error: "Invalid role." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", { p_user: userId, p_role: parsedRole.data });
  if (error) return fail(error);
  revalidatePath("/team");
  return { ok: true, message: "Role updated." };
}

export async function setMemberActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid member." };
  const supabase = await createClient();
  // The database enforces owner-only + last-owner protection and immediately
  // cuts off data access for disabled members (RLS checks is_active).
  const { error } = await supabase.rpc("set_member_active", { p_user: userId, p_active: active });
  if (error) return fail(error);

  // Also block sign-in / token refresh at the auth layer.
  try {
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
    if (banError) console.error("[javora] could not update auth ban", banError);
  } catch (e) {
    console.error("[javora] admin client unavailable for ban update", e);
  }
  revalidatePath("/team");
  return { ok: true, message: active ? "Account re-enabled." : "Account disabled. The member can no longer access any data." };
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invitationId).success) return { ok: false, error: "Invalid invitation." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: invitationId });
  if (error) return fail(error);
  revalidatePath("/team");
  return { ok: true, message: "Invitation revoked." };
}
