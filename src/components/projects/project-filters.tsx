"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { STATUS_META, PRIORITY_META } from "@/lib/status";

export function ProjectFilters({
  editors,
  showEditorFilter,
}: {
  editors: { id: string; name: string }[];
  showEditorFilter: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  // Keep the input in sync when the URL changes elsewhere (back/forward, Clear).
  const urlQ = params.get("q") ?? "";
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (lastUrlQ !== urlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = ["q", "status", "priority", "editor"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, client or ID"
          aria-label="Search projects"
          className="pl-9"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Select aria-label="Filter by status" value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)} className="sm:w-48">
          <option value="">Any status</option>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </Select>
        <Select aria-label="Filter by priority" value={params.get("priority") ?? ""} onChange={(e) => update("priority", e.target.value)} className="sm:w-36">
          <option value="">Any priority</option>
          {Object.entries(PRIORITY_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </Select>
        {showEditorFilter && (
          <Select aria-label="Filter by editor" value={params.get("editor") ?? ""} onChange={(e) => update("editor", e.target.value)} className="sm:w-44">
            <option value="">Any editor</option>
            {editors.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
        )}
        <Select aria-label="Sort" value={params.get("sort") ?? "deadline"} onChange={(e) => update("sort", e.target.value === "deadline" ? "" : e.target.value)} className="sm:w-44">
          <option value="deadline">Sort: Deadline</option>
          <option value="priority">Sort: Priority</option>
          <option value="updated">Sort: Last updated</option>
          <option value="created">Sort: Newest</option>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams();
              const view = params.get("view");
              if (view) next.set("view", view);
              setQ("");
              startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
            }}
            className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Updating" />}
      </div>
    </div>
  );
}
