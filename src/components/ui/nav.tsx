"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Link-based tabs (state lives in the URL so tabs are shareable and refresh-safe). */
export function LinkTabs({
  tabs,
  active,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number | null; dot?: boolean }[];
  active: string;
  className?: string;
}) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <nav
      aria-label="Sections"
      className={cn("-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 scrollbar-thin sm:mx-0 sm:px-0", className)}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            ref={isActive ? activeRef : undefined}
            href={t.href}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              isActive ? "border-navy-900 text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.dot && <span className="size-1.5 rounded-full bg-warning" aria-label="needs attention" />}
            {typeof t.count === "number" && (
              <span className={cn("rounded-full px-1.5 text-[11px] tabular", isActive ? "bg-navy-900 text-white" : "bg-navy-50 text-ink-muted")}>
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Lightweight dropdown menu with outside-click and Escape handling. */
export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-40 mt-2 min-w-52 animate-fade-in rounded-xl border border-line bg-surface p-1 shadow-(--shadow-pop)",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  href,
  icon,
  tone = "default",
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
}) {
  const cls = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
    tone === "danger" ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-navy-50",
  );
  if (href) {
    return (
      <Link role="menuitem" href={href} className={cls} onClick={onClick}>
        {icon}
        {children}
      </Link>
    );
  }
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
