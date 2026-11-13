"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Users,
  X,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import type { AppRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";
import { BrandMark, BrandWordmark } from "./brand";
import { NotificationBell } from "./notification-bell";
import { Avatar } from "@/components/ui/primitives";
import { Dropdown, MenuItem } from "@/components/ui/nav";
import { ButtonLink } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/overlay";

type NavItem = { href: string; label: string; icon: LucideIcon; match: (path: string, view: string | null) => boolean };

function navFor(role: AppRole): { section: string; items: NavItem[] }[] {
  const manager = role !== "editor";
  const projects = (view: string | null) => (p: string, v: string | null) => p === "/projects" && v === view;
  return [
    {
      section: "Workspace",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/dashboard" },
        {
          href: "/projects",
          label: "All projects",
          icon: FolderKanban,
          match: (p, v) => (p === "/projects" && (!v || v === "all")) || (p.startsWith("/projects/") && p !== "/projects/new"),
        },
        { href: "/projects?view=available", label: "Available", icon: Inbox, match: projects("available") },
        ...(manager
          ? [{ href: "/projects?view=review", label: "Review queue", icon: ClipboardCheck, match: projects("review") }]
          : [{ href: "/projects?view=mine", label: "My projects", icon: Briefcase, match: projects("mine") }]),
      ],
    },
    {
      section: "Team",
      items: [
        { href: "/notifications", label: "Notifications", icon: Bell, match: (p) => p === "/notifications" },
        ...(manager
          ? [
              { href: "/team", label: "Team", icon: Users, match: (p: string) => p.startsWith("/team") },
              { href: "/activity", label: "Activity log", icon: Activity, match: (p: string) => p === "/activity" },
            ]
          : []),
        { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
      ],
    },
  ];
}

export type ShellUser = { id: string; fullName: string; email: string; role: AppRole };

export function AppShell({
  user,
  workspaceName,
  initialCollapsed,
  unreadCount,
  children,
}: {
  user: ShellUser;
  workspaceName: string;
  initialCollapsed: boolean;
  unreadCount: number;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  const view = search.get("view");
  const groups = navFor(user.role);
  const manager = user.role !== "editor";

  // Close the mobile drawer whenever the route changes (derived-state pattern).
  const navKey = `${pathname}?${view ?? ""}`;
  const [lastNavKey, setLastNavKey] = useState(navKey);
  if (lastNavKey !== navKey) {
    setLastNavKey(navKey);
    setMobileOpen(false);
  }

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `jd_sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 shrink-0 items-center gap-3 px-4", collapsed && !mobile && "justify-center px-0")}>
        <BrandMark />
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <BrandWordmark inverted />
            <p className="mt-1 truncate text-[11px] text-navy-400">{workspaceName}</p>
          </div>
        )}
        {mobile && (
          <button
            type="button"
            className="ml-auto rounded-md p-1.5 text-navy-200 hover:bg-white/10"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        )}
      </div>

      {manager && (
        <div className={cn("px-3 pb-2", collapsed && !mobile && "px-2")}>
          <Link
            href="/projects/new"
            title="New project"
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg bg-white/[0.08] text-[13px] font-medium text-white ring-1 ring-white/10 ring-inset transition-colors hover:bg-white/[0.14]",
            )}
          >
            <Plus className="size-4" />
            {(!collapsed || mobile) && "New project"}
          </Link>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin" aria-label="Main">
        {groups.map((g) => (
          <div key={g.section} className="mb-5">
            {(!collapsed || mobile) && (
              <p className="mb-1.5 px-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-navy-400/80 uppercase">{g.section}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const active = item.match(pathname, view);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed && !mobile ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors",
                        collapsed && !mobile && "justify-center px-0",
                        active ? "bg-white/[0.1] text-white" : "text-navy-200 hover:bg-white/[0.05] hover:text-white",
                      )}
                    >
                      {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-white" aria-hidden />}
                      <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-navy-400 group-hover:text-navy-200")} />
                      {(!collapsed || mobile) && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {!mobile && (
        <div className="border-t border-white/[0.06] p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] text-navy-400 transition-colors hover:bg-white/[0.05] hover:text-white",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 bg-navy-900 transition-[width] duration-200 lg:block",
            collapsed ? "w-[68px]" : "w-[248px]",
          )}
        >
          {sidebar(false)}
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 animate-fade-in bg-navy-950/50" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] animate-slide-in-left bg-navy-900 shadow-2xl">{sidebar(true)}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6">
            <button
              type="button"
              className="-ml-1 rounded-lg p-2 text-ink-muted hover:bg-navy-50 hover:text-ink lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-2 lg:hidden" aria-label="JAVORA DESK home">
              <BrandMark className="size-7" />
            </Link>

            <form action="/projects" className="ml-auto hidden max-w-sm flex-1 md:block lg:ml-0">
              <label className="sr-only" htmlFor="global-search">Search projects</label>
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search projects, clients, IDs…"
                className="h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[13px] placeholder:text-ink-subtle focus:border-accent focus:bg-surface focus:outline-none focus:ring-3 focus:ring-accent/15"
              />
            </form>

            <div className="ml-auto flex items-center gap-1.5">
              {manager && (
                <ButtonLink href="/projects/new" size="sm" icon={<Plus className="size-4" />} className="hidden sm:inline-flex">
                  New project
                </ButtonLink>
              )}
              <NotificationBell userId={user.id} initialUnread={unreadCount} />
              <Dropdown
                trigger={(p) => (
                  <button {...p} type="button" className="flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-navy-50" aria-label="Account menu">
                    <Avatar name={user.fullName || user.email} />
                    <span className="hidden text-left sm:block">
                      <span className="block max-w-36 truncate text-[13px] leading-tight font-medium text-ink">{user.fullName || user.email}</span>
                      <span className="block text-[11px] leading-tight text-ink-muted">{ROLE_LABEL[user.role]}</span>
                    </span>
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <div className="border-b border-line px-2.5 pt-1.5 pb-2.5">
                      <p className="truncate text-[13px] font-medium">{user.fullName || "Unnamed member"}</p>
                      <p className="truncate text-xs text-ink-muted">{user.email}</p>
                    </div>
                    <div className="pt-1">
                      <MenuItem href="/settings" onClick={close} icon={<Settings className="size-4 text-ink-muted" />}>
                        Settings
                      </MenuItem>
                      <form action={signOutAction}>
                        <button
                          type="submit"
                          role="menuitem"
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-danger hover:bg-danger-soft"
                        >
                          <LogOut className="size-4" />
                          Sign out
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </Dropdown>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
