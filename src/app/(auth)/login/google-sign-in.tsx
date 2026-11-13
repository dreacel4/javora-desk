"use client";

import { useState, useSyncExternalStore } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/validation/auth";
import { Alert } from "@/components/ui/primitives";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

// OAuth errors can come back in the URL fragment, which only the browser can read.
const subscribe = () => () => {};
const readHash = () => window.location.hash;
const serverHash = () => "";

export function GoogleSignIn({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  const hashError = /error/.test(hash)
    ? /Database|Signups|not allowed|invit/i.test(decodeURIComponent(hash))
      ? "This Google account has not been invited to JAVORA DESK. Ask the workspace owner to invite the exact Gmail address you used."
      : "Google sign-in did not complete. Please try again."
    : null;

  const start = async () => {
    setLoading(true);
    setError(null);
    const target = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`;
    const { error: oauthError } = await getBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: target, queryParams: { prompt: "select_account" } },
    });
    if (oauthError) {
      setLoading(false);
      setError(
        /provider is not enabled|Unsupported provider/i.test(oauthError.message)
          ? "Google sign-in is not enabled yet. The workspace owner must turn it on in Supabase."
          : "Could not start Google sign-in. Please try again.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {(error ?? hashError) && <Alert tone="danger">{error ?? hashError}</Alert>}
      <button
        type="button"
        onClick={start}
        disabled={loading}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-[15px] font-medium text-ink transition-colors hover:bg-navy-50 disabled:opacity-60"
      >
        <GoogleLogo />
        {loading ? "Redirecting to Google…" : "Continue with Google"}
      </button>
    </div>
  );
}
