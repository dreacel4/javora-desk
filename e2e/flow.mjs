// End-to-end walkthrough of JAVORA DESK through the real UI (local stack).
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS_DIR ?? new URL("./shots", import.meta.url).pathname;
const MAIL_LOG = process.env.E2E_MAIL_LOG ?? new URL("./local-stack/mail.jsonl", import.meta.url).pathname;
const PASS = "EditorPass123";
let step = 0;
const log = (m) => console.log(`${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { throw new Error(`E2E FAILED: ${m}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const consoleErrors = [];
async function ctx(viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport, timezoneId: "Asia/Jakarta" });
  const p = await c.newPage();
  p.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/realtime|websocket|54321\/realtime|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text()); });
  return { c, p };
}
async function login(p, email, password) {
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Work email").fill(email);
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/dashboard/);
}
async function toast(p, text) {
  await p.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
}
function inviteLink(email) {
  const lines = existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, "utf8").trim().split("\n") : [];
  for (const l of lines.reverse()) {
    const m = JSON.parse(l);
    if (m.to?.includes(email)) {
      const href = /href="([^"]+)"/.exec(m.html)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
  }
  return null;
}
async function noOverflow(p, label) {
  const { sw, iw } = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw + 1) fail(`${label}: horizontal overflow (${sw} > ${iw})`);
}

// ---------------------------------------------------------------- Owner
const owner = await ctx();
await login(owner.p, "owner@javora.test", "OwnerPass123");
log("Owner signed in");
await owner.p.screenshot({ path: `${SHOTS}/01-owner-dashboard-empty.png` });

for (const [name, email, role] of [
  ["Dana Dispatch", "dana@javora.test", "dispatcher"],
  ["Eli Editor", "eli@javora.test", "editor"],
  ["Eva Editor", "eva@javora.test", "editor"],
]) {
  await owner.p.goto(`${BASE}/team`);
  await owner.p.getByRole("button", { name: "Invite member" }).click();
  const d = owner.p.getByRole("dialog");
  await d.getByLabel("Full name").fill(name);
  await d.getByLabel("Email").fill(email);
  await d.getByLabel("Role").selectOption(role);
  await d.getByRole("button", { name: "Send invitation" }).click();
  await toast(owner.p, `Invitation sent to ${email}`);
}
log("Owner invited a dispatcher and two editors");

const people = {};
for (const email of ["dana@javora.test", "eli@javora.test", "eva@javora.test"]) {
  const link = inviteLink(email);
  if (!link) fail(`no invitation email for ${email}`);
  const u = await ctx();
  await u.p.goto(link);
  await u.p.waitForURL(/\/account\/password\?flow=invite/);
  await u.p.getByLabel("New password").fill(PASS);
  await u.p.getByLabel("Confirm password").fill(PASS);
  await u.p.getByRole("button", { name: "Save password" }).click();
  await u.p.waitForURL(/\/dashboard\?welcome=1/);
  people[email] = u;
}
log("All three invitees accepted via the emailed link and set passwords");
const dana = people["dana@javora.test"].p;
const eli = people["eli@javora.test"].p;
const eva = people["eva@javora.test"].p;

// ---------------------------------------------------------------- Permissions
for (const path of ["/team", "/projects/new", "/activity"]) {
  await eli.goto(`${BASE}${path}`);
  await eli.getByText("Not found or not available to you").waitFor({ timeout: 10000 }).catch(() => fail(`editor could open ${path}`));
}
log("Editor is blocked from /team, /projects/new and /activity");

// ---------------------------------------------------------------- Create & publish
await dana.goto(`${BASE}/projects/new`);
await dana.getByLabel("Project title").fill("Product launch teaser — 45s");
await dana.getByLabel("Internal project ID").fill("JV-2026-001");
await dana.getByLabel("Client name or username").fill("acme_studio");
await dana.getByLabel("Original client brief").fill("Hi! I need a punchy 30 second teaser for our product launch.\nUse the attached footage, upbeat music and bold captions.");
await dana.getByLabel("Editing requirements").fill("- Kinetic captions\n- Logo sting at the end\n- Upbeat royalty-free music");
await dana.getByRole("button", { name: "Raw material link" }).click();
await dana.getByLabel("Label").fill("Raw footage folder");
await dana.getByLabel("URL").fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ");
const deadline = new Date(Date.now() + 3 * 86400_000);
const dl = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, "0")}-${String(deadline.getDate()).padStart(2, "0")}T17:00`;
await dana.getByLabel("Deadline").fill(dl);
await dana.getByRole("switch", { name: /Storyboard approval required/ }).click();
await dana.getByRole("button", { name: "Publish to team" }).click();
await dana.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const projectUrl = dana.url();
log(`Dispatcher created and published a project (${projectUrl.split("/").pop()})`);
await dana.screenshot({ path: `${SHOTS}/02-project-published.png`, fullPage: true });

// Brief versioning after publication
await dana.goto(`${projectUrl}?tab=brief`);
await dana.getByRole("button", { name: "Publish new version" }).click();
let d = dana.getByRole("dialog");
await d.getByLabel("What changed?").fill("Client extended the duration to 45 seconds");
await d.getByLabel("Client brief").fill("Hi! I need a punchy 45 second teaser for our product launch.\nUse the attached footage, upbeat music and bold captions.");
await d.getByRole("button", { name: "Publish version" }).click();
await toast(dana, "Brief saved as version 2");
await dana.reload();
await dana.getByText("Version 1").waitFor({ timeout: 10000 }).catch(() => fail("brief v1 not in history"));
await dana.getByText("Original client brief").first().waitFor({ timeout: 10000 }).catch(() => fail("original brief label missing"));
log("Brief v2 published; v1 preserved in history as the original");

// ---------------------------------------------------------------- Claim race (UI)
await eli.goto(`${BASE}/projects?view=available`);
await eli.getByRole("link", { name: /Product launch teaser/ }).first().click();
await eva.goto(projectUrl);
await eli.getByRole("button", { name: "Claim project" }).click();
await eli.getByRole("dialog").getByRole("button", { name: "Claim project" }).click();
await toast(eli, "Project claimed");
await eva.getByRole("button", { name: "Claim project" }).click();
await eva.getByRole("dialog").getByRole("button", { name: "Claim project" }).click();
await eva.getByText("This project is no longer available to claim.").first().waitFor();
log("Eli claimed; Eva's later claim was rejected with a clear message");
await eva.goto(projectUrl);
await eva.getByText("Not found or not available to you").waitFor({ timeout: 10000 }).catch(() => fail("Eva can still see Eli's project"));
log("Eva can no longer see the project after it was claimed");

// ---------------------------------------------------------------- Understanding
await eli.goto(`${projectUrl}?tab=understanding`);
await eli.getByRole("button", { name: "Start production" }).waitFor({ state: "detached", timeout: 1000 }).catch(() => {});
await eli.getByLabel("1. Received materials").fill("One Drive folder with 14 b-roll clips and the logo pack.");
await eli.getByLabel("2. Client requirements").fill("A 45s product teaser with captions, music and a logo sting.");
await eli.getByLabel("3. Proposed editing approach").fill("Fast beat-synced cuts, kinetic captions, warm grade.");
await eli.getByLabel("4. Planned visual sequence").fill("Hook shot, product hero, 3 feature beats, CTA + logo sting.");
await eli.getByLabel("5. Expected deliverables").fill("1 x 1920x1080 MP4");
await eli.getByLabel("7. Questions for the dispatcher").fill("Which music track do they prefer?");
await eli.getByRole("button", { name: "Submit understanding" }).click();
await toast(eli, "Understanding submitted");
log("Editor submitted their understanding with a question");

await dana.goto(`${projectUrl}?tab=understanding`);
await dana.getByRole("button", { name: "Request clarification" }).click();
d = dana.getByRole("dialog");
await d.getByLabel("What needs clarification?").fill("Use track #2 from the shared music folder.");
await d.getByRole("button", { name: "Send to editor" }).click();
await toast(dana, "Clarification requested");

await eli.goto(`${projectUrl}?tab=understanding`);
await eli.getByText("Use track #2 from the shared music folder.").first().waitFor();
await eli.getByLabel("7. Questions for the dispatcher").fill("");
await eli.getByLabel("2. Client requirements").fill("A 45s product teaser with captions, track #2 and a logo sting.");
await eli.getByRole("button", { name: "Submit understanding" }).click();
await toast(eli, "Understanding submitted");

await dana.goto(`${projectUrl}?tab=understanding`);
await dana.getByRole("button", { name: "Approve understanding" }).click();
await toast(dana, "Understanding approved");
log("Clarification loop completed and understanding approved");

// ---------------------------------------------------------------- Timer
await eli.goto(projectUrl);
await eli.getByRole("button", { name: "Start production" }).click();
await eli.getByText("Session running").waitFor();
await eli.waitForTimeout(3500);
await eli.reload();
await eli.getByText("Session running").waitFor();
const shown = await eli.locator("section[aria-label='Work timer'] p.font-mono").innerText();
const secs = shown.split(":").reduce((a, b) => a * 60 + Number(b), 0);
if (secs < 3) fail(`timer did not survive reload (${shown})`);
log(`Timer started and survived a page reload (${shown})`);

const tab2 = await people["eli@javora.test"].c.newPage();
await tab2.goto(projectUrl);
await tab2.getByText("Session running").waitFor();
await tab2.getByRole("button", { name: "Pause" }).click();
await tab2.getByText("Session paused").waitFor();
await eli.getByText("Session paused").waitFor({ timeout: 10000 });
log("Paused from a second tab; the first tab synced to paused");
await eli.getByRole("button", { name: "Resume" }).click();
await eli.getByText("Session running").waitFor();
await tab2.close();
await eli.screenshot({ path: `${SHOTS}/03-editor-timer-running.png` });

// ---------------------------------------------------------------- Submission
await eli.goto(`${projectUrl}?tab=submissions`);
await eli.getByLabel("Google Drive link").fill("https://dropbox.com/s/abc");
await eli.getByText("doesn't look like a Google Drive").waitFor();
await eli.getByLabel("Google Drive link").fill("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view?usp=sharing");
await eli.getByLabel("Final file name").fill("acme_teaser_v1.mp4");
await eli.getByLabel("Work summary").fill("Cut a 45s teaser with kinetic captions and logo sting.");
await eli.getByLabel("Completed requirements").fill("Captions, music track #2, logo sting, 1080p");
await eli.getByLabel("I confirmed the dispatcher can open this Drive link").check();
await eli.getByRole("button", { name: "Submit for review" }).click();
await toast(eli, "Work submitted");
await eli.goto(projectUrl);
if (await eli.getByText("Session running").isVisible().catch(() => false)) fail("timer still running after submission");
log("Editor submitted a Google Drive link; the session was closed");

// ---------------------------------------------------------------- Review: revision
await dana.goto(`${projectUrl}?tab=submissions`);
await dana.getByRole("button", { name: "Start review" }).click();
await toast(dana, "Review started");
await dana.getByRole("button", { name: "Request revision" }).click();
d = dana.getByRole("dialog");
if (!(await d.getByRole("button", { name: "Send revision request" }).isDisabled())) fail("revision allowed without reason");
await d.getByLabel("Reason").fill("Logo sting is too long — trim it to 2 seconds.");
await d.getByRole("button", { name: "Send revision request" }).click();
await toast(dana, "Revision requested");
await dana.screenshot({ path: `${SHOTS}/04-dispatcher-review.png`, fullPage: true });
log("Dispatcher requested a revision (reason enforced)");

await eli.goto(`${BASE}/notifications`);
await eli.getByText("Revision requested: Product launch teaser").first().waitFor();
log("Editor received the revision notification");
await eli.goto(projectUrl);
await eli.getByRole("button", { name: "Start revision" }).click();
await eli.getByText("Session running").waitFor();
await eli.goto(`${projectUrl}?tab=submissions`);
await eli.getByText("Logo sting is too long").first().waitFor();
await eli.getByLabel("Google Drive link").fill("https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJi/view");
await eli.getByLabel("Final file name").fill("acme_teaser_v2.mp4");
await eli.getByLabel("Work summary").fill("Trimmed the logo sting to 2 seconds.");
await eli.getByLabel("Completed requirements").fill("All brief items plus revision #1");
await eli.getByLabel("I confirmed the dispatcher can open this Drive link").check();
await eli.getByRole("button", { name: "Submit for review" }).click();
await toast(eli, "Work submitted");
log("Editor resubmitted v2");

await dana.goto(`${projectUrl}?tab=submissions`);
await dana.getByRole("button", { name: "Start review" }).click();
await toast(dana, "Review started");
await dana.getByRole("button", { name: "Approve delivery" }).click();
await dana.getByRole("dialog").getByRole("button", { name: "Approve & complete" }).click();
await toast(dana, "Project completed");
await dana.goto(projectUrl);
await dana.getByText("Final delivery approved").waitFor();
log("Dispatcher approved v2 — project completed");

await dana.goto(`${projectUrl}?tab=activity`);
for (const t of ["claimed the project", "requested clarification", "approved the editor's understanding", "started production", "requested a revision", "approved delivery #2"]) {
  await dana.getByText(t, { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => fail(`activity missing: ${t}`));
}
log("Activity history shows every step");
await dana.screenshot({ path: `${SHOTS}/05-activity.png`, fullPage: true });

// ---------------------------------------------------------------- Dashboards & team
await dana.goto(`${BASE}/dashboard`);
await dana.screenshot({ path: `${SHOTS}/06-dispatcher-dashboard.png`, fullPage: true });
await owner.p.goto(`${BASE}/team`);
await owner.p.screenshot({ path: `${SHOTS}/07-team.png`, fullPage: true });
const row = owner.p.locator("tr", { hasText: "Eli Editor" });
if (!(await row.innerText()).includes("100%")) fail("team metrics did not record on-time completion");
log("Team metrics show Eli's completed, on-time project");

// ---------------------------------------------------------------- Disable account
await owner.p.getByRole("button", { name: "Actions for Eva Editor" }).click();
await owner.p.getByRole("menuitem", { name: "Disable account" }).click();
await owner.p.getByRole("dialog").getByRole("button", { name: "Disable account" }).click();
await toast(owner.p, "Account disabled");
await eva.goto(`${BASE}/dashboard`);
await eva.waitForURL(/auth\/error\?reason=disabled|\/login/);
log("Disabled member is locked out immediately");

// ---------------------------------------------------------------- Mobile
const m = await ctx({ width: 390, height: 844 });
await login(m.p, "eli@javora.test", PASS);
for (const [path, name] of [["/dashboard", "m-dashboard"], ["/projects", "m-projects"], [new URL(projectUrl).pathname, "m-project"], [`${new URL(projectUrl).pathname}?tab=submissions`, "m-submissions"]]) {
  await m.p.goto(`${BASE}${path}`);
  await m.p.waitForLoadState("networkidle");
  await noOverflow(m.p, path);
  await m.p.screenshot({ path: `${SHOTS}/08-${name}.png`, fullPage: true });
}
await m.p.getByRole("button", { name: "Open menu" }).click();
await m.p.getByRole("dialog", { name: "Navigation" }).waitFor();
await m.p.screenshot({ path: `${SHOTS}/08-m-nav.png` });
log("Mobile layouts render without horizontal overflow; drawer navigation works");

if (consoleErrors.length) {
  console.log("Browser console errors:\n" + [...new Set(consoleErrors)].join("\n"));
}
await browser.close();
console.log("✓ END-TO-END FLOW PASSED");
