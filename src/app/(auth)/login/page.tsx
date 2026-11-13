import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  "signed-out": "You have been signed out.",
  "link-expired": "That link is invalid or has expired. Request a new one.",
  "password-updated": "Password updated. Sign in with your new password.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-muted">Sign in to your JAVORA DESK workspace.</p>
      <LoginForm next={next} notice={notice} />
      <p className="mt-8 text-center text-xs text-ink-muted">
        Accounts are created by invitation from the workspace owner.
      </p>
    </>
  );
}
