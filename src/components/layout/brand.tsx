import { cn } from "@/lib/utils";

/** JAVORA DESK mark: a navy tile with a "J" cut by a timeline playhead. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#172943" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgb(255 255 255 / 0.10)" />
      <path d="M19.5 8v10.25a5.25 5.25 0 0 1-10.5 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M23.5 8v16" stroke="#7d93b5" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="23.5" cy="8" r="2" fill="#7d93b5" />
    </svg>
  );
}

export function BrandWordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex items-baseline gap-1.5 leading-none", className)}>
      <span className={cn("text-[15px] font-semibold tracking-[0.14em]", inverted ? "text-white" : "text-navy-900")}>JAVORA</span>
      <span className={cn("text-[11px] font-medium tracking-[0.22em]", inverted ? "text-navy-400" : "text-ink-muted")}>DESK</span>
    </span>
  );
}
