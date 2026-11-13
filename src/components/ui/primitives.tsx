import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { Tone } from "@/lib/status";
import { cn, initials } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-(--radius-card) border border-line bg-surface shadow-(--shadow-card)", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-navy-50 text-ink-muted ring-line",
  navy: "bg-navy-900 text-white ring-navy-900",
  info: "bg-info-soft text-[#2d5bb8] ring-[#d3e0f7]",
  success: "bg-success-soft text-[#0f7a4f] ring-[#c9ecdc]",
  warning: "bg-warning-soft text-[#9a6a1c] ring-[#f2e0bf]",
  danger: "bg-danger-soft text-[#b33a3a] ring-[#f5d0d0]",
  violet: "bg-violet-soft text-[#5b3fa6] ring-[#e1d8f5]",
};

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

const alertStyle = {
  info: { cls: "border-[#d3e0f7] bg-info-soft text-[#24498f]", Icon: Info },
  success: { cls: "border-[#c9ecdc] bg-success-soft text-[#0f6b45]", Icon: CheckCircle2 },
  warning: { cls: "border-[#f2e0bf] bg-warning-soft text-[#85591a]", Icon: AlertTriangle },
  danger: { cls: "border-[#f5d0d0] bg-danger-soft text-[#a33434]", Icon: XCircle },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: keyof typeof alertStyle;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const { cls, Icon } = alertStyle[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("leading-relaxed", title && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl bg-navy-50 text-navy-600 ring-1 ring-line">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Avatar({ name, size = "md", className }: { name: string | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const sz = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" }[size];
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-navy-100 font-semibold text-navy-800 ring-1 ring-navy-200", sz, className)}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium tracking-wide text-ink-muted uppercase">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-muted">{it.label}</dt>
          <dd className="mt-1 text-sm break-words text-ink">{it.value || <span className="text-ink-subtle">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Pre-wrapped long text (client briefs, notes) that preserves line breaks. */
export function Prose({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return <p className="text-sm text-ink-subtle">Not provided.</p>;
  return <div className={cn("text-sm leading-relaxed break-words whitespace-pre-wrap text-ink", className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-navy-100/70", className)} />;
}
