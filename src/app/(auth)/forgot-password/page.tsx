import type { Metadata } from "next";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-muted">We&apos;ll email you a secure link to choose a new password.</p>
      <ForgotPasswordForm />
    </>
  );
}
