import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation/auth";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change", "magiclink", "signup"];

/**
 * Landing point for links in Supabase Auth emails (invitations and password
 * resets). Supports both the token-hash template and the PKCE `code` flow.
 * See docs/SUPABASE_SETUP.md for the email template configuration.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  let next = safeNext(url.searchParams.get("next"), "/dashboard");

  // Errors returned by an OAuth provider (e.g. an uninvited Google account is
  // rejected by the database trigger and Supabase reports "Database error saving new user").
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) {
    const notInvited = /database error|signups not allowed|invitation/i.test(oauthError);
    return NextResponse.redirect(new URL(`/login?notice=${notInvited ? "not-invited" : "oauth-failed"}`, request.url));
  }

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (ok && type === "invite") next = "/account/password?flow=invite";
    if (ok && type === "recovery") next = "/account/password";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    return NextResponse.redirect(new URL("/login?notice=link-expired", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
