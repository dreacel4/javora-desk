import type { ActionResult } from "@/lib/types";

type DbError = { code?: string; message?: string; details?: string | null } | null | undefined;

// Error codes raised deliberately by the workflow functions carry messages
// written for end users. Everything else is logged and replaced.
const USER_FACING = new Set(["42501", "P0002", "22023", "55000", "23505", "P0001"]);

export function dbErrorMessage(error: DbError, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (error.code && USER_FACING.has(error.code) && error.message) return error.message;
  if (error.code === "23514") return "Some values are missing, too long or out of range.";
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008") return "One of the values has an invalid format.";
  if (error.code === "PGRST301" || error.code === "PGRST303") return "Your session has expired. Please sign in again.";
  console.error("[javora] unexpected database error", error);
  return fallback;
}

export function fail(error: DbError, fallback?: string): ActionResult<never> {
  return { ok: false, error: dbErrorMessage(error, fallback) };
}
