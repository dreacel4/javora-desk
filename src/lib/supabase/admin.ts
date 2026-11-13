import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES RLS — only for operations that Supabase Auth
 * requires admin rights for (sending invitations, banning disabled accounts).
 * Never import this from client components; `server-only` enforces that.
 * Always verify the caller's permissions with the user client first.
 */
export function createAdminClient() {
  const { supabaseUrl } = getPublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not configured on the server (see .env.example).");
  }
  return createClient<Database>(supabaseUrl, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
