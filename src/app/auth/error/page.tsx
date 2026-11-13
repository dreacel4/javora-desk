import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { BrandMark } from "@/components/layout/brand";

export const metadata: Metadata = { title: "Access unavailable" };

const MESSAGES: Record<string, { title: string; body: string }> = {
  disabled: {
    title: "Your account is disabled",
    body: "The workspace owner has disabled this account. Contact them if you believe this is a mistake.",
  },
  "no-profile": {
    title: "No workspace access",
    body: "You are signed in, but this account has no JAVORA DESK profile. Ask the workspace owner for an invitation.",
  },
};

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const sp = await searchParams;
  const msg = MESSAGES[typeof sp.reason === "string" ? sp.reason : ""] ?? {
    title: "Something went wrong",
    body: "We couldn't complete that request. Please sign in again.",
  };
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-sm text-center">
        <BrandMark className="mx-auto size-10" />
        <div className="mx-auto mt-8 grid size-12 place-items-center rounded-xl bg-warning-soft text-warning">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{msg.title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{msg.body}</p>
        <form action={signOutAction} className="mt-8">
          <button type="submit" className="h-10 w-full rounded-lg bg-navy-900 text-sm font-medium text-white hover:bg-navy-800">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
