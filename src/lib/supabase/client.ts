"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser client (RLS applies). Used for uploads and realtime subscriptions. */
export function getBrowserClient() {
  if (!client) {
    const { supabaseUrl, supabaseKey } = getPublicEnv();
    client = createBrowserClient<Database>(supabaseUrl, supabaseKey);
  }
  return client;
}
