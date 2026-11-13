import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./form";

export const metadata: Metadata = { title: "Set password" };

export default async function SetPasswordPage({ searchParams }: PageProps<"/account/password">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?notice=link-expired");
  const sp = await searchParams;
  const invited = sp.flow === "invite";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{invited ? "Welcome to JAVORA DESK" : "Choose a new password"}</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-muted">
        {invited ? "Set a password to finish activating your account." : "Your new password replaces the old one immediately."}
      </p>
      <SetPasswordForm />
    </>
  );
}
