"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signInAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState(signInAction, null);
  const [show, setShow] = useState(false);
  // Controlled so React's automatic form reset after a failed attempt keeps the email.
  const [email, setEmail] = useState("");
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {notice && <Alert tone="info">{notice}</Alert>}
      {state && !state.ok && !fe && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Work email" error={fe?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" placeholder="you@javora.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Password" error={fe?.password}>
        {(p) => (
          <div className="relative">
            <Input {...p} name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-10" />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-muted hover:text-ink"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        )}
      </Field>
      <div className="-mt-2 flex justify-end">
        <Link href="/forgot-password" className="text-[13px] font-medium text-accent hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
