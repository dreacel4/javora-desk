import type { Enums, Tables } from "@/lib/supabase/database.types";

export type AppRole = Enums<"app_role">;
export type ProjectStatus = Enums<"project_status">;
export type ProjectPriority = Enums<"project_priority">;
export type Profile = Tables<"profiles">;
export type Project = Tables<"projects">;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export const MANAGER_ROLES: readonly AppRole[] = ["owner", "dispatcher"];
export const isManagerRole = (role: AppRole | null | undefined) => role === "owner" || role === "dispatcher";
