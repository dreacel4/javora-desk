"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type UploadCategory = "materials" | "understanding" | "storyboards";
export type UploadedFile = { path: string; name: string };

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPT: Record<UploadCategory, Record<string, string>> = {
  storyboards: { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg,.jpeg" },
  understanding: {
    "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg,.jpeg", "image/webp": ".webp", "text/plain": ".txt,.srt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/zip": ".zip",
  },
  materials: {
    "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg,.jpeg", "image/webp": ".webp", "text/plain": ".txt,.srt",
    "text/csv": ".csv", "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/zip": ".zip",
  },
};

function mimeFor(file: File, category: UploadCategory): string | null {
  const allowed = ACCEPT[category];
  if (file.type && allowed[file.type]) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  // Browsers often report an empty type for subtitles and some documents.
  for (const [mime, exts] of Object.entries(allowed)) {
    if (exts.split(",").includes(`.${ext}`)) return mime;
  }
  return null;
}

function safeName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-120);
  return cleaned || "file";
}

/** File picker + uploader to the private bucket. Upload happens when `upload()` is called. */
export function useFileUpload(projectId: string, category: UploadCategory, maxFiles = 10) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!mimeFor(f, category)) {
        setError(`${f.name}: this file type is not allowed here.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is larger than 50 MB. Share large files through a Drive link instead.`);
        continue;
      }
      if (next.length >= maxFiles) {
        setError(`Attach at most ${maxFiles} files.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const remove = (i: number) => setFiles((l) => l.filter((_, j) => j !== i));

  /** Uploads every selected file; on any failure removes what was uploaded and throws. */
  const upload = async (): Promise<UploadedFile[]> => {
    if (files.length === 0) return [];
    setUploading(true);
    const supabase = getBrowserClient();
    const done: UploadedFile[] = [];
    try {
      for (const f of files) {
        const path = `${projectId}/${category}/${crypto.randomUUID()}-${safeName(f.name)}`;
        const { error: upErr } = await supabase.storage.from("project-files").upload(path, f, {
          contentType: mimeFor(f, category) ?? undefined,
          upsert: false,
          cacheControl: "3600",
        });
        if (upErr) throw new Error(`Upload failed for ${f.name}: ${upErr.message}`);
        done.push({ path, name: f.name.slice(0, 255) });
      }
      return done;
    } catch (e) {
      if (done.length) await supabase.storage.from("project-files").remove(done.map((d) => d.path));
      throw e;
    } finally {
      setUploading(false);
    }
  };

  return { files, add, remove, upload, uploading, error, setError, reset: () => setFiles([]), accept: Object.values(ACCEPT[category]).join(",") };
}

export function FilePicker({
  state,
  label = "Attach files",
  hint,
}: {
  state: ReturnType<typeof useFileUpload>;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          state.add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line-strong bg-canvas/50",
        )}
      >
        <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-2 text-[13px] font-medium text-accent hover:underline">
          <Paperclip className="size-4" /> {label}
        </button>
        <p className="text-xs text-ink-muted">{hint ?? "Drag and drop or browse · up to 50 MB each"}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={state.accept}
          className="sr-only"
          onChange={(e) => {
            state.add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {state.files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
              {state.uploading ? <Loader2 className="size-4 animate-spin text-ink-muted" /> : <FileText className="size-4 text-ink-muted" />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-ink-subtle tabular">{formatBytes(f.size)}</span>
              {!state.uploading && (
                <button type="button" onClick={() => state.remove(i)} className="text-ink-subtle hover:text-danger" aria-label={`Remove ${f.name}`}>
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FileLink({ path, name, size }: { path: string; name: string; size?: number }) {
  return (
    <a
      href={`/api/files?path=${encodeURIComponent(path)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex max-w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] transition-colors hover:border-navy-200 hover:bg-navy-50"
    >
      <FileText className="size-4 shrink-0 text-navy-600" />
      <span className="min-w-0 truncate font-medium text-ink group-hover:text-navy-700">{name}</span>
      {typeof size === "number" && size > 0 && <span className="shrink-0 text-xs text-ink-subtle tabular">{formatBytes(size)}</span>}
    </a>
  );
}
