import type { ProjectPriority, ProjectStatus } from "@/lib/types";

export type Tone = "neutral" | "navy" | "info" | "success" | "warning" | "danger" | "violet";

export const STATUS_META: Record<ProjectStatus, { label: string; tone: Tone; stage: number; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", stage: 0, hint: "Being prepared by the dispatcher." },
  available: { label: "Available", tone: "info", stage: 1, hint: "Open for an editor to claim." },
  claimed: { label: "Claimed", tone: "navy", stage: 2, hint: "Editor must submit their understanding of the brief." },
  awaiting_confirmation: { label: "Awaiting confirmation", tone: "violet", stage: 2, hint: "Dispatcher is reviewing the editor's understanding." },
  awaiting_storyboard_approval: { label: "Storyboard stage", tone: "violet", stage: 3, hint: "Storyboard must be approved before production." },
  ready_to_start: { label: "Ready to start", tone: "info", stage: 4, hint: "Approved — production can begin." },
  in_progress: { label: "In progress", tone: "navy", stage: 4, hint: "Editor is producing the video." },
  submitted: { label: "Submitted", tone: "warning", stage: 5, hint: "Waiting for dispatcher review." },
  dispatcher_review: { label: "In review", tone: "warning", stage: 5, hint: "Dispatcher is reviewing the submission." },
  revision_requested: { label: "Revision requested", tone: "danger", stage: 4, hint: "Editor is addressing review feedback." },
  completed: { label: "Completed", tone: "success", stage: 6, hint: "Final delivery approved." },
  on_hold: { label: "On hold", tone: "neutral", stage: -1, hint: "Paused by the dispatcher." },
  cancelled: { label: "Cancelled", tone: "neutral", stage: -1, hint: "Project was cancelled." },
};

export const PRODUCTION_STAGES = ["Published", "Claimed", "Understanding", "Storyboard", "Production", "Review", "Completed"] as const;

export const PRIORITY_META: Record<ProjectPriority, { label: string; tone: Tone; rank: number }> = {
  low: { label: "Low", tone: "neutral", rank: 0 },
  normal: { label: "Normal", tone: "info", rank: 1 },
  high: { label: "High", tone: "warning", rank: 2 },
  urgent: { label: "Urgent", tone: "danger", rank: 3 },
};

export const OPEN_STATUSES: ProjectStatus[] = [
  "available", "claimed", "awaiting_confirmation", "awaiting_storyboard_approval",
  "ready_to_start", "in_progress", "submitted", "dispatcher_review", "revision_requested",
];

export const ROLE_LABEL = { owner: "Owner", dispatcher: "Dispatcher", editor: "Editor" } as const;
