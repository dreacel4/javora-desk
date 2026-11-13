"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";
import { Button } from "./button";
import { Field, Textarea } from "./form";
import { Alert } from "./primitives";

/* -------------------------------------------------------------------------- */
/* Modal — native <dialog> for focus trapping, Esc handling and a11y           */
/* -------------------------------------------------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-(--shadow-pop) open:animate-slide-up",
        { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" }[size],
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-1 text-[13px] text-ink-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 rounded-md p-1 text-ink-muted hover:bg-navy-50 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                       */
/* -------------------------------------------------------------------------- */
type Toast = { id: number; tone: "success" | "error"; message: string };
const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastContext value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-(--shadow-pop)"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <p className="flex-1 text-ink">{t.message}</p>
            <button
              type="button"
              className="text-ink-muted hover:text-ink"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* -------------------------------------------------------------------------- */
/* Runs a server action, surfaces errors/success as toasts.                     */
/* -------------------------------------------------------------------------- */
export function useAction() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts?: { success?: string; onSuccess?: (data?: T) => void }) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          try {
            const res = await fn();
            if (res.ok) {
              if (opts?.success ?? res.message) toast("success", (opts?.success ?? res.message) as string);
              opts?.onSuccess?.(res.data);
            } else {
              toast("error", res.error);
            }
            resolve(res);
          } catch {
            const res = { ok: false as const, error: "Network error. Check your connection and try again." };
            toast("error", res.error);
            resolve(res);
          }
        });
      }),
    [toast],
  );
  return { run, pending };
}

/* -------------------------------------------------------------------------- */
/* ConfirmDialog — for destructive or significant actions, optional reason      */
/* -------------------------------------------------------------------------- */
export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  reason,
  onConfirm,
  success,
}: {
  /** Uncontrolled: render prop for the button that opens the dialog. */
  trigger?: (open: () => void) => ReactNode;
  /** Controlled mode (e.g. opened from a dropdown menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  reason?: { label: string; placeholder?: string; required?: boolean; minLength?: number };
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>;
  success?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setInternalOpen(v));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction();
  const min = reason?.required ? reason.minLength ?? 3 : 0;

  const close = () => {
    setOpen(false);
    setText("");
    setError(null);
  };

  return (
    <>
      {trigger?.(() => setOpen(true))}
      <Modal
        open={open}
        onClose={close}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={pending}
              disabled={text.trim().length < min}
              onClick={async () => {
                const res = await run(() => onConfirm(text.trim()), { success });
                if (res.ok) close();
                else setError(res.error);
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {(reason || error) && (
          <div className="flex flex-col gap-3">
            {error && <Alert tone="danger">{error}</Alert>}
            {reason && (
              <Field label={reason.label} required={reason.required}>
                {(p) => (
                  <Textarea {...p} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} maxLength={2000} autoFocus />
                )}
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
