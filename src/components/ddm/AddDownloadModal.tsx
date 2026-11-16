import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { ClipboardPaste, FolderOpen, X } from "lucide-react";
import { detectCategory, fileNameFromUrl, useDDM, type Category } from "@/lib/ddm-store";
import {
  chooseDownloadDirectory,
  isAndroidTauriRuntime,
  readClipboardText,
} from "@/lib/downloadEngine";
import type { TranslationKey } from "@/lib/i18n";
import { CategoryIcon } from "./CategoryIcon";

const CATS: { key: Category; label: TranslationKey }[] = [
  { key: "video", label: "video" },
  { key: "archive", label: "archive" },
  { key: "executable", label: "executable" },
  { key: "audio", label: "audio" },
];

export function AddDownloadModal({
  open,
  onClose,
  initialUrl,
}: {
  open: boolean;
  onClose: () => void;
  initialUrl?: string;
}) {
  const { add, settings, sharedMedia, shareError, resolveSharedMedia, t } = useDDM();
  const isAndroid = isAndroidTauriRuntime();
  const isDesktopTauri = isTauri() && !isAndroid;
  const [url, setUrl] = useState("");
  const [threads, setThreads] = useState(settings.defaultThreads);
  const [path, setPath] = useState(settings.defaultDir);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const paste = useCallback(async () => {
    try {
      const t = await readClipboardText();
      setPasteBlocked(false);
      if (t) {
        setUrl(t.trim());
      }
    } catch {
      setPasteBlocked(true);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setThreads(settings.defaultThreads);
      setPath(settings.defaultDir);
      setUrl(initialUrl ?? "");
      setDirectoryError("");
      setAddError("");
      setPasteBlocked(false);
      if (initialUrl) void resolveSharedMedia(initialUrl);
    }
  }, [open, initialUrl, resolveSharedMedia, settings.defaultDir, settings.defaultThreads]);

  const browseDirectory = async () => {
    setDirectoryError("");
    try {
      const directory = await chooseDownloadDirectory(path || undefined);
      if (directory) setPath(directory);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : t("couldNotOpenFolderPicker"));
    }
  };

  if (!open) return null;
  const valid = (() => {
    try {
      const parsed = new URL(url);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.host);
    } catch {
      return false;
    }
  })();
  const cat = url ? detectCategory(fileNameFromUrl(url)) : null;
  const awaitingSharedMedia = Boolean(initialUrl && url.trim() === initialUrl && !sharedMedia);

  return (
    <div
      data-testid="download-modal-backdrop"
      className="pointer-events-auto fixed inset-0 z-[100] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-download-title"
        className="pointer-events-auto relative z-[101] max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="add-download-title" className="text-lg font-semibold text-card-foreground">
            {t("newDownload")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label
          htmlFor="download-url"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          {t("urlDdlVideo")}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="download-url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(event) => {
              if (
                isTauri() &&
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "v"
              ) {
                event.preventDefault();
                void paste();
              }
            }}
            placeholder="https://example.com/file.zip"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => void paste()}
            className="rounded-md border border-input px-3 text-muted-foreground hover:text-primary"
            aria-label={t("paste")}
          >
            <ClipboardPaste className="h-4 w-4" />
          </button>
        </div>
        {pasteBlocked && <p className="mt-1 text-xs text-warning">{t("clipboardBlocked")}</p>}
        {initialUrl && sharedMedia && (
          <div className="mt-4 rounded-lg border border-border bg-background p-3">
            <p className="mb-2 truncate text-xs text-muted-foreground">
              {t("preview")} {sharedMedia.name} ({sharedMedia.mimeType})
            </p>
            {sharedMedia.mimeType.startsWith("video/") ? (
              <video
                className="max-h-56 w-full rounded-md bg-black"
                src={sharedMedia.url}
                controls
                playsInline
              />
            ) : (
              <audio className="w-full" src={sharedMedia.url} controls />
            )}
          </div>
        )}
        {initialUrl && shareError && url.trim() === initialUrl && (
          <p className="mt-2 text-sm text-warning">{shareError}</p>
        )}

        <label className="mt-5 block text-xs uppercase tracking-wider text-muted-foreground">
          {isAndroid ? t("appStorageSubfolder") : t("downloadDirectory")}
        </label>
        {isAndroid ? (
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-input bg-background px-3">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="flex-1 bg-transparent py-2 font-mono text-sm outline-none"
            />
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-input bg-background px-3">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <input
              aria-label={t("downloadDirectory")}
              readOnly
              value={path || t("systemDownloadsFolder")}
              className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void browseDirectory()}
              disabled={!isDesktopTauri}
              className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("browse")}
            </button>
          </div>
        )}
        {directoryError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {directoryError}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {isAndroid
            ? t("androidStorageDescription")
            : isTauri()
              ? t("nativeDirectoryDescription")
              : t("browserDirectoryDescription")}
        </p>
        {addError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {addError}
          </p>
        )}

        <div className="mt-5 flex justify-between text-xs uppercase tracking-wider text-muted-foreground">
          <span>{t("threads")}</span>
          <span className="font-mono text-primary">{threads}</span>
        </div>
        <input
          type="range"
          min={1}
          max={16}
          value={threads}
          onChange={(e) => setThreads(+e.target.value)}
          className="mt-2 w-full accent-primary"
        />

        <div className="mt-5 text-xs uppercase tracking-wider text-muted-foreground">
          {t("category")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATS.map((c) => (
            <span
              key={c.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${cat === c.key ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}
            >
              <CategoryIcon category={c.key} className="h-3.5 w-3.5" /> {t(c.label)}
            </span>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={async () => {
              setIsAdding(true);
              setAddError("");
              try {
                const added = await add(
                  sharedMedia?.url ?? url.trim(),
                  threads,
                  isAndroid ? path.trim() : path.trim() || settings.defaultDir,
                );
                if (added) onClose();
              } catch (error) {
                setAddError(error instanceof Error ? error.message : t("couldNotStartDownload"));
              } finally {
                setIsAdding(false);
              }
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 glow"
            disabled={!valid || awaitingSharedMedia || isAdding}
          >
            {isAdding ? t("choosingLocation") : t("startDownload")}
          </button>
        </div>
      </div>
    </div>
  );
}
