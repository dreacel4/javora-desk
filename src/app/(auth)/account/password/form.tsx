"use client";

import { useActionState } from "react";
import { updatePasswordAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

export function SetPasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && !fe && <Alert tone="danger">{state.error}</Alert>}
      <Field label="New password" error={fe?.password} hint="At least 10 characters with upper- and lowercase letters and a number.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required autoFocus />}
      </Field>
      <Field label="Confirm password" error={fe?.confirm}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="Saving…">
        Save password
      </SubmitButton>
    </form>
  );
}
