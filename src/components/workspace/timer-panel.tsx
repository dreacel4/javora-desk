"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, Pause, Play, Timer, WifiOff } from "lucide-react";
import {
  getTimerAction,
  heartbeatAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
  type TimerSnapshot,
} from "@/lib/actions/workflow";
import { formatDuration } from "@/lib/format";
import type { ProjectStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/primitives";
import { ConfirmDialog, useToast } from "@/components/ui/overlay";

const HEARTBEAT_MS = 60_000;

/**
 * The database is the source of truth: the displayed time is the server's
 * `active_seconds` at fetch time plus local elapsed time since that fetch.
 * A refresh, a second tab or a reconnect simply re-reads the server state.
 */
export function TimerPanel({
  projectId,
  initial,
  status,
  staleMinutes,
}: {
  projectId: string;
  initial: TimerSnapshot;
  status: ProjectStatus;
  staleMinutes: number;
}) {
  const [snap, setSnap] = useState(initial);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const toast = useToast();
  const channel = useRef<BroadcastChannel | null>(null);

  const apply = useCallback((s: TimerSnapshot, broadcast = false) => {
    setSnap((prev) => {
      if (prev.status === "active" && s.status === "paused" && !broadcast) setAutoPaused(true);
      return s;
    });
    setFetchedAt(Date.now());
    setOffline(false);
    if (broadcast) channel.current?.postMessage({ projectId });
  }, [projectId]);

  // Cross-tab sync: other tabs re-read the server state when this one changes it.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("javora-timer");
    channel.current = bc;
    bc.onmessage = async () => {
      const res = await getTimerAction(projectId);
      if (res.ok && res.data) {
        setSnap(res.data);
        setFetchedAt(Date.now());
        setAutoPaused(false);
      }
    };
    return () => bc.close();
  }, [projectId]);

  // Display tick
  useEffect(() => {
    if (snap.status !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [snap.status]);

  // Heartbeat + resync on focus/reconnect
  const beat = useCallback(async () => {
    if (!snap.sessionId || snap.status !== "active") return;
    try {
      const res = await heartbeatAction(projectId, snap.sessionId);
      if (res.ok && res.data) apply(res.data);
      else setOffline(true);
    } catch {
      setOffline(true);
    }
  }, [apply, projectId, snap.sessionId, snap.status]);

  useEffect(() => {
    if (snap.status !== "active") return;
    const t = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && void beat();
    const onOnline = () => void beat();
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [beat, snap.status]);

  const run = async (fn: () => Promise<{ ok: boolean; data?: TimerSnapshot; error?: string }>) => {
    setBusy(true);
    setAutoPaused(false);
    try {
      const res = await fn();
      if (res.ok && res.data) apply(res.data, true);
      else if (!res.ok) toast("error", res.error ?? "Timer action failed.");
    } catch {
      toast("error", "Network error — the timer state on the server is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  const running = snap.status === "active";
  const liveSession = snap.activeSeconds + (running ? Math.max(0, (now - fetchedAt) / 1000) : 0);
  const liveTotal = snap.projectTotalSeconds + (running ? Math.max(0, (now - fetchedAt) / 1000) : 0);
  const canStart = ["ready_to_start", "in_progress", "revision_requested"].includes(status);
  const startLabel = status === "ready_to_start" ? "Start production" : status === "revision_requested" ? "Start revision" : "Start timer";

  return (
    <section
      aria-label="Work timer"
      className={cn(
        "overflow-hidden rounded-(--radius-card) border shadow-(--shadow-card)",
        running ? "border-navy-800 bg-navy-900 text-white" : "border-line bg-surface",
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", running ? "bg-white/10" : "bg-navy-50 text-navy-700")}>
            <Timer className={cn("size-5", running && "animate-pulse")} />
          </div>
          <div>
            <p className={cn("text-xs font-medium", running ? "text-navy-200" : "text-ink-muted")}>
              {running ? "Session running" : snap.status === "paused" ? "Session paused" : "No active session"}
            </p>
            <p className="font-mono text-[28px] leading-tight font-semibold tracking-tight tabular" aria-live="off">
              {formatDuration(liveSession, true)}
            </p>
            <p className={cn("text-xs tabular", running ? "text-navy-400" : "text-ink-subtle")}>
              Your total on this project: {formatDuration(liveTotal)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!snap.sessionId && (
            <Button
              variant={running ? "secondary" : "primary"}
              icon={<Play className="size-4" />}
              loading={busy}
              disabled={!canStart}
              onClick={() => run(() => startTimerAction(projectId))}
            >
              {startLabel}
            </Button>
          )}
          {snap.sessionId && running && (
            <Button
              variant="secondary"
              className="border-white/15 bg-white/10 text-white hover:bg-white/15"
              icon={<Pause className="size-4" />}
              loading={busy}
              onClick={() => run(() => pauseTimerAction(projectId, snap.sessionId!))}
            >
              Pause
            </Button>
          )}
          {snap.sessionId && snap.status === "paused" && (
            <Button icon={<Play className="size-4" />} loading={busy} disabled={!canStart} onClick={() => run(() => resumeTimerAction(projectId, snap.sessionId!))}>
              Resume
            </Button>
          )}
          {snap.sessionId && (
            <ConfirmDialog
              title="End this work session?"
              description="The session is closed and added to your history. You can start a new session later."
              confirmLabel="End session"
              onConfirm={async () => {
                const res = await stopTimerAction(projectId, snap.sessionId!);
                if (res.ok && res.data) apply(res.data, true);
                return res;
              }}
              trigger={(open) => (
                <Button
                  variant="ghost"
                  className={running ? "text-navy-200 hover:bg-white/10 hover:text-white" : undefined}
                  icon={<CircleStop className="size-4" />}
                  onClick={open}
                  disabled={busy}
                >
                  End session
                </Button>
              )}
            />
          )}
        </div>
      </div>

      {(offline || autoPaused) && (
        <div className={cn("border-t px-5 py-3", running ? "border-white/10" : "border-line")}>
          {offline ? (
            <Alert tone="warning" title="Connection lost">
              <span className="inline-flex items-center gap-1.5">
                <WifiOff className="size-3.5" /> Time is tracked by the server. If the connection stays down for more than {staleMinutes} minutes, the timer pauses at the last confirmed moment.
              </span>
            </Alert>
          ) : (
            <Alert tone="warning" title="Timer paused automatically">
              No activity reached the server for {staleMinutes} minutes, so the session was paused at the last confirmed moment. Resume when you&apos;re back.
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}
