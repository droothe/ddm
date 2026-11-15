import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cancelDownload,
  extractMediaUrl,
  isAndroidTauriRuntime,
  listenForExternalDownloads,
  listenForProgress,
  openDownloadFolder,
  pauseDownload,
  publishDownloadToAndroid,
  probeDownload,
  resumeDownload,
  startDownload,
  isTauriRuntime,
  setGlobalSpeedLimit,
  type DownloadMetadata,
  type DirectMedia,
  type EngineProgress,
} from "./downloadEngine";
import { useShareIntent } from "@/hooks/useShareIntent";

export type Status =
  "downloading" | "paused" | "completed" | "merging" | "error" | "queued" | "cancelled";
export type Category = "video" | "archive" | "executable" | "audio" | "other";

export interface ThreadSegment {
  start: number;
  end: number;
  size: number;
  done: number;
}

export interface DownloadItem {
  id: string;
  name: string;
  url: string;
  size: number;
  category: Category;
  status: Status;
  threads: number;
  chunks: ThreadSegment[];
  speed: number;
  path: string;
  supportsRanges: boolean;
  prepared: boolean;
  mimeType?: string;
  errorMessage?: string;
}

export type Download = DownloadItem;

export interface Settings {
  defaultDir: string;
  maxConcurrent: number;
  defaultThreads: number;
  speedLimitMB: number;
}

export function detectCategory(name: string): Category {
  const ext = (name.split("?")[0] ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mkv", "webm", "avi", "mov", "m3u8"].includes(ext)) return "video";
  if (["zip", "rar", "7z", "tar", "gz", "iso"].includes(ext)) return "archive";
  if (["exe", "msi", "dmg", "apk", "deb", "appimage"].includes(ext)) return "executable";
  if (["mp3", "flac", "wav", "aac", "ogg", "m4a"].includes(ext)) return "audio";
  return "other";
}

export function fileNameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || parsed.hostname);
  } catch {
    return url.split("/").pop() || "download.bin";
  }
}

export function createThreadSegments(size: number, threads: number): ThreadSegment[] {
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error("The server did not provide a valid file size.");
  if (!Number.isInteger(threads) || threads < 1 || threads > 16) {
    throw new Error("Thread count must be between 1 and 16.");
  }

  const count = Math.min(size, threads);
  const baseSize = Math.floor(size / count);
  let start = 0;
  return Array.from({ length: count }, (_, index) => {
    const segmentSize = index === count - 1 ? size - start : baseSize;
    const segment = { start, end: start + segmentSize - 1, size: segmentSize, done: 0 };
    start += segmentSize;
    return segment;
  });
}

export const bytesDone = (download: DownloadItem) =>
  download.chunks.reduce((total, chunk) => total + chunk.done, 0);
export const progress = (download: DownloadItem) =>
  download.size > 0 ? Math.min(1, bytesDone(download) / download.size) : 0;

interface DDMContextValue {
  downloads: DownloadItem[];
  settings: Settings;
  setSettings: (settings: Partial<Settings>) => void;
  add: (url: string, threads: number, path: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  openFolder: (id: string) => Promise<void>;
  stats: { down: number; up: number; threads: number; active: number };
  extension: "listening" | "unavailable";
  engine: "browser" | "tauri";
  externalUrl: string | null;
  sharedMedia: DirectMedia | null;
  shareError: string | null;
  resolveSharedMedia: (url: string) => Promise<void>;
  clearExternalUrl: () => void;
}

const DDMContext = createContext<DDMContextValue | null>(null);

const INITIAL_SETTINGS: Settings = {
  defaultDir: "Downloads/Droothe",
  maxConcurrent: 3,
  defaultThreads: 8,
  speedLimitMB: 0,
};

let idSequence = 0;
const makeId = () =>
  `dl-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? idSequence++}`;
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The download failed for an unknown reason.";

export function DDMProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettingsState] = useState<Settings>(INITIAL_SETTINGS);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [sharedMedia, setSharedMedia] = useState<DirectMedia | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [extension, setExtension] = useState<"listening" | "unavailable">("unavailable");
  const [engine, setEngine] = useState<"browser" | "tauri">("browser");
  const externalDownloadHandler = useRef<((url: string) => void) | null>(null);
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const starting = useRef(new Set<string>());
  const started = useRef(new Set<string>());
  const resuming = useRef(new Set<string>());
  const retrying = useRef(new Set<string>());
  const publishing = useRef(new Set<string>());

  const updateDownload = useCallback((id: string, update: Partial<DownloadItem>) => {
    setDownloads((items) => items.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }, []);

  const resolveSharedMedia = useCallback(async (url: string) => {
    setSharedMedia(null);
    setShareError(null);
    try {
      setSharedMedia(await extractMediaUrl(url));
    } catch (error) {
      setShareError(getErrorMessage(error));
    }
  }, []);

  const receiveSharedUrl = useCallback((url: string) => {
    setExternalUrl(url);
    setSharedMedia(null);
    setShareError(null);
  }, []);

  useShareIntent(receiveSharedUrl);

  useEffect(() => {
    setGlobalSpeedLimit(settings.speedLimitMB);
  }, [settings.speedLimitMB]);

  useEffect(() => {
    setEngine(isTauriRuntime() ? "tauri" : "browser");
    let disposed = false;
    let removeProgressListener = () => {};
    let removeExternalListener = () => {};

    void Promise.all([
      listenForProgress((event) => {
        if (event.status === "completed" && event.filePath && isAndroidTauriRuntime()) {
          const item = downloadsRef.current.find((download) => download.id === event.id);
          if (item && !publishing.current.has(item.id)) {
            publishing.current.add(item.id);
            void publishDownloadToAndroid(event.filePath, item.name, item.mimeType)
              .then(({ uri }) => {
                setDownloads((items) =>
                  items.map((download) =>
                    download.id === item.id ? { ...download, path: uri, errorMessage: "" } : download,
                  ),
                );
              })
              .catch((error: unknown) => {
                const message = getErrorMessage(error);
                setDownloads((items) =>
                  items.map((download) =>
                    download.id === item.id
                      ? { ...download, errorMessage: `Downloaded, but could not save to Android media storage: ${message}` }
                      : download,
                  ),
                );
              })
              .finally(() => publishing.current.delete(item.id));
          }
        }
        setDownloads((items) =>
          items.map((item) => (item.id === event.id ? applyProgress(item, event) : item)),
        );
      }),
      listenForExternalDownloads((url) => {
        const handler = externalDownloadHandler.current;
        if (!handler) {
          console.error("Received an external download before the download handler was ready.");
          return;
        }
        handler(url);
      }),
    ])
      .then(([stopProgress, stopExternal]) => {
        if (disposed) {
          stopProgress();
          stopExternal();
          return;
        }
        removeProgressListener = stopProgress;
        removeExternalListener = stopExternal;
        setExtension("listening");
      })
      .catch((error: unknown) =>
        console.error("Could not initialize download event listeners.", error),
      );

    return () => {
      disposed = true;
      removeProgressListener();
      removeExternalListener();
    };
  }, []);

  useEffect(() => {
    const activeCount = downloads.filter((item) => item.status === "downloading").length;
    let slots = Math.max(0, settings.maxConcurrent - activeCount);
    for (const item of downloads) {
      if (slots === 0) break;
      if (item.status !== "queued" || !item.prepared || starting.current.has(item.id)) continue;

      slots -= 1;
      starting.current.add(item.id);
      updateDownload(item.id, { status: "downloading", speed: 0, errorMessage: "" });
      const shouldStart = retrying.current.delete(item.id) || !started.current.has(item.id);
      if (shouldStart) started.current.add(item.id);
      resuming.current.delete(item.id);
      const operation = shouldStart ? startDownload(item) : resumeDownload(item.id);
      void operation
        .catch((error: unknown) => {
          updateDownload(item.id, {
            status: "error",
            speed: 0,
            errorMessage: getErrorMessage(error),
          });
        })
        .finally(() => starting.current.delete(item.id));
    }
  }, [downloads, settings.maxConcurrent, updateDownload]);

  const add = useCallback(
    (url: string, threads: number, path: string) => {
      const id = makeId();
      const initialName = fileNameFromUrl(url);
      const item: DownloadItem = {
        id,
        name: initialName,
        url,
        size: 0,
        category: detectCategory(initialName),
        status: "queued",
        threads,
        chunks: [],
        speed: 0,
        path,
        supportsRanges: false,
        prepared: false,
      };
      setDownloads((items) => [item, ...items]);

      void probeDownload(url, threads)
        .then((metadata) => {
          const segments = createThreadSegments(
            metadata.size,
            metadata.supportsRanges ? threads : 1,
          );
          updateDownload(id, {
            name: metadata.name,
            size: metadata.size,
            supportsRanges: metadata.supportsRanges,
            ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
            chunks: segments,
            prepared: true,
            category: detectCategory(metadata.name),
          });
        })
        .catch((error: unknown) => {
          updateDownload(id, { status: "error", errorMessage: getErrorMessage(error), speed: 0 });
        });
    },
    [updateDownload],
  );
  useEffect(() => {
    externalDownloadHandler.current = (url) =>
      add(url, settings.defaultThreads, settings.defaultDir);
  }, [add, settings.defaultDir, settings.defaultThreads]);

  const pause = useCallback(
    (id: string) => {
      const item = downloads.find((download) => download.id === id);
      if (!item || (item.status !== "downloading" && item.status !== "queued")) return;
      updateDownload(id, { status: "paused", speed: 0 });
      if (item.status === "downloading") {
        void pauseDownload(id).catch((error: unknown) => {
          updateDownload(id, { status: "error", errorMessage: getErrorMessage(error) });
        });
      }
    },
    [downloads, updateDownload],
  );

  const resume = useCallback(
    (id: string) => {
      const item = downloads.find((download) => download.id === id);
      if (!item || (item.status !== "paused" && item.status !== "error")) return;
      if (!item.prepared) return;
      resuming.current.add(id);
      if (item.status === "error" && isTauriRuntime()) retrying.current.add(id);
      updateDownload(id, { status: "queued", speed: 0, errorMessage: "" });
    },
    [downloads, updateDownload],
  );

  const cancel = useCallback(
    (id: string) => {
      updateDownload(id, { status: "cancelled", speed: 0 });
      void cancelDownload(id).catch((error: unknown) => {
        updateDownload(id, { errorMessage: getErrorMessage(error) });
      });
    },
    [updateDownload],
  );

  const remove = useCallback(
    (id: string) => {
      starting.current.delete(id);
      started.current.delete(id);
      resuming.current.delete(id);
      retrying.current.delete(id);
      const item = downloads.find((download) => download.id === id);
      if (item && item.status !== "completed" && item.status !== "cancelled") {
        void cancelDownload(id).catch((error: unknown) =>
          console.error("Could not stop removed download.", error),
        );
      }
      setDownloads((items) => items.filter((download) => download.id !== id));
    },
    [downloads],
  );

  const pauseAll = useCallback(() => {
    for (const item of downloads) {
      if (item.status === "downloading" || item.status === "queued") pause(item.id);
    }
  }, [downloads, pause]);

  const resumeAll = useCallback(() => {
    for (const item of downloads) {
      if (item.status === "paused") resume(item.id);
    }
  }, [downloads, resume]);

  const openFolder = useCallback(
    async (id: string) => {
      const item = downloads.find((download) => download.id === id);
      if (!item) throw new Error("Download not found.");
      await openDownloadFolder(item.path, item.name);
    },
    [downloads],
  );

  const value = useMemo<DDMContextValue>(() => {
    const active = downloads.filter((item) => item.status === "downloading");
    return {
      downloads,
      settings,
      setSettings: (update) => setSettingsState((current) => ({ ...current, ...update })),
      add,
      pause,
      resume,
      cancel,
      remove,
      pauseAll,
      resumeAll,
      openFolder,
      stats: {
        down: active.reduce((total, item) => total + item.speed, 0),
        up: 0,
        threads: active.reduce(
          (total, item) => total + item.chunks.filter((chunk) => chunk.done < chunk.size).length,
          0,
        ),
        active: active.length,
      },
      extension,
      engine,
      externalUrl,
      sharedMedia,
      shareError,
      resolveSharedMedia,
      clearExternalUrl: () => {
        setExternalUrl(null);
        setSharedMedia(null);
        setShareError(null);
      },
    };
  }, [
    add,
    cancel,
    downloads,
    engine,
    extension,
    externalUrl,
    resolveSharedMedia,
    shareError,
    sharedMedia,
    openFolder,
    pause,
    pauseAll,
    remove,
    resume,
    resumeAll,
    settings,
  ]);

  return <DDMContext.Provider value={value}>{children}</DDMContext.Provider>;
}

function applyProgress(item: DownloadItem, event: EngineProgress): DownloadItem {
  return {
    ...item,
    status: event.status ?? item.status,
    size: event.size && event.size > 0 ? event.size : item.size,
    speed: event.speed ?? 0,
    chunks: event.chunks?.length ? event.chunks : item.chunks,
    ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
  };
}

export function useDDM() {
  const context = useContext(DDMContext);
  if (!context) throw new Error("useDDM must be used inside DDMProvider");
  return context;
}

export function fmtBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
export const fmtSpeed = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
export function fmtEta(remaining: number, speed: number) {
  if (!speed) return "—";
  const seconds = Math.round(remaining / speed);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export type { DirectMedia, DownloadMetadata };
