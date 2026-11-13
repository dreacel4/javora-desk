"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, null);
  const [email, setEmail] = useState("");
  if (state?.ok) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="grid size-11 place-items-center rounded-xl bg-success-soft text-success">
          <MailCheck className="size-5" />
        </div>
        <p className="text-sm text-ink">{state.message}</p>
        <p className="text-[13px] text-ink-muted">The link expires after one hour. Check your spam folder if it doesn&apos;t arrive.</p>
        <Link href="/login" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
          <ArrowLeft className="size-3.5" /> Back to sign in
        </Link>
      </div>
    );
  }
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && !fe && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Work email" error={fe?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="Sending…">
        Send reset link
      </SubmitButton>
      <Link href="/login" className="inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Back to sign in
      </Link>
    </form>
  );
}
