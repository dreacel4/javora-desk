#!/usr/bin/env node
/**
 * Creates the FIRST Owner of a JAVORA DESK workspace.
 *
 * Usage (run locally, never in the browser):
 *   node --env-file=.env.local scripts/create-first-owner.mjs --email you@company.com --name "Your Name"
 *   # optional: --password '<strong password>'  (otherwise an invitation email is sent)
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (service role).
 *
 * Safety: the database only accepts an inviter-less owner invitation while the
 * workspace has NO owner. After the first owner exists, this script refuses to
 * run and all further members must be invited from the Team page.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim() ?? "";
const password = arg("password");

if (!url || !secret) {
  console.error("✗ Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. in .env.local).");
  process.exit(1);
}
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('✗ Provide a valid --email. Example: --email owner@javora.com --name "Owner Name"');
  process.exit(1);
}
if (password && (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password))) {
  console.error("✗ --password must be at least 10 characters with upper- and lowercase letters and a number.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner");
if (countError) {
  console.error("✗ Could not read profiles. Have the migrations been applied?", countError.message);
  process.exit(1);
}
if ((count ?? 0) > 0) {
  console.error("✗ This workspace already has an owner. Invite additional members from the Team page.");
  process.exit(1);
}

const { data: invitation, error: invError } = await admin
  .from("invitations")
  .insert({ email, role: "owner", full_name: name || null, invited_by: null })
  .select("id")
  .single();
if (invError) {
  console.error("✗ Could not record the owner invitation:", invError.message);
  process.exit(1);
}

const result = password
  ? await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } })
  : await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo: `${site}/auth/confirm?next=${encodeURIComponent("/account/password?flow=invite")}`,
    });

if (result.error) {
  await admin.from("invitations").delete().eq("id", invitation.id);
  console.error("✗ Supabase Auth rejected the user:", result.error.message);
  process.exit(1);
}

const { data: profile } = await admin.from("profiles").select("id, role").eq("email", email).single();
if (profile?.role !== "owner") {
  console.error("✗ The user was created but no owner profile exists. Check the on_auth_user_created trigger.");
  process.exit(1);
}

console.log(`✓ Owner created: ${email}`);
console.log(password ? `  Sign in at ${site}/login` : "  An invitation email was sent. The link lets them set a password.");
