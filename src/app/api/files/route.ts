import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a private project file. The signed URL is created with the caller's
 * own session, so Storage RLS decides whether they may read it. URLs expire
 * after 5 minutes and are never stored.
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const download = request.nextUrl.searchParams.get("download") === "1";
  if (!/^[0-9a-f-]{36}\/(materials|understanding|storyboards)\/[^/]{1,300}$/i.test(path)) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const fileName = path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/i, "") ?? "file";
  const { data, error } = await supabase.storage
    .from("project-files")
    .createSignedUrl(path, 300, download ? { download: fileName } : undefined);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "File not found or you do not have access." }, { status: 404 });
  }
  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
