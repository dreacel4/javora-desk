import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

/**
 * Returns the signed-in user's profile (or null). Cached per request.
 * The role ALWAYS comes from the database, never from client input or JWT
 * metadata the user could influence.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data ?? null;
});

/** Requires an active signed-in member; otherwise redirects to login. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const profile = await getCurrentProfile();
  // Signed in at the auth level but no usable workspace profile: send to the
  // error page (which is not redirected by the proxy) instead of looping.
  if (!profile) redirect("/auth/error?reason=no-profile");
  if (!profile.is_active) redirect("/auth/error?reason=disabled");
  return profile;
}

/** Requires one of the given roles. Unauthorized users get a 404 (no data leak). */
export async function requireRole(roles: readonly AppRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) notFound();
  return profile;
}
