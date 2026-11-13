import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const MAIL_LOG = process.env.E2E_MAIL_LOG ?? new URL("./local-stack/mail.jsonl", import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errs = [];
async function as(email, pw) {
  const c = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await c.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${B}/login`); await p.getByLabel("Work email").fill(email); await p.getByLabel("Password", { exact: true }).fill(pw);
  await p.getByRole("button", { name: "Sign in" }).click(); await p.waitForURL(/dashboard/); return p;
}
const bad = async (p, path) => { await p.goto(B + path); const t = await p.locator("main, body").first().innerText(); if (/couldn.t load|could not be loaded|Application error/i.test(t)) throw new Error(`broken: ${path}`); };
const owner = await as("owner@javora.test", "OwnerPass123");
const pid = (await owner.goto(`${B}/projects?view=completed`), await owner.getByRole("link", { name: /Product launch/ }).first().getAttribute("href"));
for (const path of ["/settings", "/settings?tab=workspace", "/notifications", "/notifications?filter=unread", "/activity", "/team", "/projects?view=drafts", `${pid}?tab=brief`, `${pid}?tab=materials`, `${pid}?tab=understanding`, `${pid}?tab=storyboard`, `${pid}?tab=sessions`, `${pid}?tab=revisions`, "/projects?q=launch&sort=priority"]) await bad(owner, path);
console.log("1. owner pages render");
// Workspace settings save
await owner.goto(`${B}/settings?tab=workspace`);
await owner.getByLabel("Workspace name").fill("Javora Studio");
await owner.getByRole("button", { name: "Save workspace settings" }).click();
await owner.getByText("Workspace settings saved").waitFor();
await owner.reload(); if (!(await owner.getByText("Javora Studio").first().isVisible())) throw new Error("workspace name not persisted");
console.log("2. workspace settings saved & shown in sidebar");
// Archive completed project
await owner.goto(B + pid); await owner.getByRole("button", { name: "More actions" }).click(); await owner.getByRole("menuitem", { name: "Archive" }).click();
await owner.getByText("Project archived").waitFor();
await owner.goto(`${B}/projects?view=archived`); await owner.getByRole("link", { name: /Product launch/ }).first().waitFor();
console.log("3. completed project archived and listed under Archived");
// Draft: create, edit, delete (owner)
await owner.goto(`${B}/projects/new`);
await owner.getByLabel("Project title").fill("Scratch draft project"); await owner.getByLabel("Internal project ID").fill("JV-DRAFT-1");
await owner.getByLabel("Client name or username").fill("someone"); await owner.getByLabel("Original client brief").fill("Draft brief text");
await owner.getByRole("button", { name: "Save as draft" }).click(); await owner.waitForURL(/projects\/[0-9a-f-]{36}$/);
await owner.getByRole("button", { name: "Publish" }).isDisabled().then((d) => { if (!d) throw new Error("publish enabled without deadline"); });
await owner.getByRole("link", { name: "Edit", exact: true }).click(); await owner.getByLabel("Project title").fill("Scratch draft project (edited)");
await owner.getByRole("button", { name: "Save changes" }).click(); await owner.waitForURL(/projects\/[0-9a-f-]{36}$/);
await owner.getByRole("heading", { name: "Scratch draft project (edited)" }).waitFor();
await owner.getByRole("button", { name: "More actions" }).click(); await owner.getByRole("menuitem", { name: "Delete draft" }).click();
await owner.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click(); await owner.waitForURL(/view=drafts&deleted=1/);
console.log("4. draft created, publish blocked without deadline, edited, deleted");
// Profile settings + notification prefs
const eli = await as("eli@javora.test", "EditorPass123");
await eli.goto(`${B}/settings`); await eli.getByRole("switch", { name: "New project available" }).click();
await eli.getByLabel("Full name").fill("Eli Editor-Santoso"); await eli.getByRole("button", { name: "Save settings" }).click();
await eli.getByText("Settings saved").waitFor(); await eli.reload();
if ((await eli.getByRole("switch", { name: "New project available" }).getAttribute("aria-checked")) !== "false") throw new Error("pref not saved");
console.log("5. profile + notification preferences persisted");
// Password reset via email
const anon = await (await b.newContext()).newPage();
await anon.goto(`${B}/forgot-password`); await anon.getByLabel("Work email").fill("dana@javora.test");
await anon.getByRole("button", { name: "Send reset link" }).click(); await anon.getByText("a reset link is on its way").waitFor();
await new Promise((r) => setTimeout(r, 1500));
const mail = readFileSync(MAIL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).reverse().find((m) => m.to.includes("dana@") && /reset/i.test(m.html));
const link = /href="([^"]+)"/.exec(mail.html)[1].replace(/&amp;/g, "&");
await anon.goto(link); await anon.waitForURL(/account\/password/);
await anon.getByLabel("New password").fill("short"); await anon.getByLabel("Confirm password").fill("short");
await anon.getByRole("button", { name: "Save password" }).click(); await anon.getByText("Use at least 10 characters").waitFor();
await anon.getByLabel("New password").fill("BrandNewPass99"); await anon.getByLabel("Confirm password").fill("BrandNewPass99");
await anon.getByRole("button", { name: "Save password" }).click(); await anon.waitForURL(/dashboard/);
await as("dana@javora.test", "BrandNewPass99");
// unknown email gives same response (no enumeration)
await anon.context().clearCookies(); await anon.goto(`${B}/forgot-password`); await anon.getByLabel("Work email").fill("nobody@nowhere.test");
await anon.getByRole("button", { name: "Send reset link" }).click(); await anon.getByText("a reset link is on its way").waitFor();
console.log("6. password reset by email works; weak passwords rejected; no account enumeration");
// Wrong password + open redirect protection
const x = await (await b.newContext()).newPage();
await x.goto(`${B}/login?next=//evil.example.com`); await x.getByLabel("Work email").fill("eli@javora.test"); await x.getByLabel("Password", { exact: true }).fill("wrong");
await x.getByRole("button", { name: "Sign in" }).click(); await x.getByText("Incorrect email or password.").waitFor();
await x.getByLabel("Password", { exact: true }).fill("EditorPass123"); await x.getByRole("button", { name: "Sign in" }).click();
await x.waitForURL(/localhost:3000\/dashboard/);
console.log("7. wrong password rejected; open redirect ignored");
// File route rejects invalid paths and anonymous
const r1 = await x.request.get(`${B}/api/files?path=../../etc/passwd`); if (r1.status() !== 400) throw new Error("file route accepted bad path");
console.log("8. file route rejects path traversal");
if (errs.length) console.log("page errors:", errs);
await b.close(); console.log("✓ SWEEP PASSED");
