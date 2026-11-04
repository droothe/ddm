import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Status = "downloading" | "paused" | "completed" | "merging" | "error" | "queued";
export type Category = "video" | "archive" | "executable" | "audio" | "other";

export interface Chunk { size: number; done: number }
export interface Download {
  id: string;
  name: string;
  url: string;
  size: number; // bytes
  category: Category;
  status: Status;
  threads: number;
  chunks: Chunk[];
  speed: number; // bytes/s
  path: string;
  mergeTicks?: number;
}
export interface Settings {
  defaultDir: string;
  maxConcurrent: number;
  defaultThreads: number;
  speedLimitMB: number; // 0 = unlimited
}

const MB = 1024 * 1024;

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
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || u.hostname);
  } catch {
    return url.split("/").pop() || "download.bin";
  }
}

function makeChunks(size: number, threads: number, ratio = 0): Chunk[] {
  const base = Math.floor(size / threads);
  return Array.from({ length: threads }, (_, i) => {
    const s = i === threads - 1 ? size - base * (threads - 1) : base;
    const jitter = ratio === 0 ? 0 : Math.min(1, Math.max(0, ratio + Math.sin(i * 2.3 + size) * 0.15));
    return { size: s, done: Math.floor(s * (ratio >= 1 ? 1 : jitter)) };
  });
}

let idSeq = 0;
const uid = () => `dl-${Date.now().toString(36)}-${idSeq++}`;

function seed(): Download[] {
  let n = 0;
  const mk = (name: string, sizeMB: number, status: Status, threads: number, ratio: number): Download => ({
    id: `seed-${n++}`, name, url: `https://cdn.droothe.dev/files/${name}`, size: sizeMB * MB,
    category: detectCategory(name), status, threads, chunks: makeChunks(sizeMB * MB, threads, ratio),
    speed: 0, path: "/Downloads/Droothe",
  });
  return [
    mk("Droothe_Studio_Setup_v3.2.exe", 412, "downloading", 8, 0.42),
    mk("Cinematic_Reel_4K_HDR.mp4", 2860, "downloading", 16, 0.18),
    mk("Asset_Pack_Vol7.zip", 1240, "paused", 8, 0.63),
    mk("Ambient_Sessions_Lossless.flac", 186, "completed", 4, 1),
    mk("Nightly_Build_Linux.tar.gz", 734, "error", 8, 0.27),
  ];
}

export const bytesDone = (d: Download) => d.chunks.reduce((a, c) => a + c.done, 0);
export const progress = (d: Download) => (d.size ? bytesDone(d) / d.size : 0);

interface Ctx {
  downloads: Download[];
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  add: (url: string, threads: number, path: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  stats: { down: number; up: number; threads: number; active: number };
  extension: "ready" | "listening";
}

const DDMContext = createContext<Ctx | null>(null);

export function DDMProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<Download[]>(seed);
  const [settings, setSettingsState] = useState<Settings>({
    defaultDir: "/Downloads/Droothe", maxConcurrent: 3, defaultThreads: 8, speedLimitMB: 0,
  });
  const [up, setUp] = useState(0);
  const [extension, setExtension] = useState<"ready" | "listening">("listening");

  useEffect(() => {
    const t = setInterval(() => setExtension((e) => (e === "listening" ? "ready" : "listening")), 6000);
    return () => clearInterval(t);
  }, []);

  // Simulation engine
  useEffect(() => {
    const TICK = 500;
    const t = setInterval(() => {
      setDownloads((list) => {
        let activeCount = 0;
        return list.map((d) => {
          if (d.status === "queued" && activeCount < settings.maxConcurrent) {
            d = { ...d, status: "downloading" };
          }
          if (d.status === "merging") {
            const m = (d.mergeTicks ?? 0) + 1;
            return m >= 4 ? { ...d, status: "completed", speed: 0, mergeTicks: m } : { ...d, mergeTicks: m };
          }
          if (d.status !== "downloading") return d.speed ? { ...d, speed: 0 } : d;
          activeCount++;
          if (activeCount > settings.maxConcurrent) return { ...d, status: "queued", speed: 0 };
          const limitPerDl = settings.speedLimitMB > 0 ? (settings.speedLimitMB * MB) / settings.maxConcurrent : Infinity;
          const perThread = (1.2 + Math.random() * 2.6) * MB;
          let total = 0;
          const chunks = d.chunks.map((c) => {
            if (c.done >= c.size) return c;
            const want = Math.min(perThread * (TICK / 1000) * (0.5 + Math.random()), limitPerDl * (TICK / 1000) / d.threads);
            const add = Math.min(c.size - c.done, want);
            total += add;
            return { ...c, done: c.done + add };
          });
          const finished = chunks.every((c) => c.done >= c.size);
          return {
            ...d, chunks, speed: total / (TICK / 1000),
            status: finished ? "merging" : "downloading", mergeTicks: 0,
          };
        });
      });
      setUp(() => (0.05 + Math.random() * 0.3) * MB);
    }, TICK);
    return () => clearInterval(t);
  }, [settings.maxConcurrent, settings.speedLimitMB]);

  const patch = (id: string, fn: (d: Download) => Download) =>
    setDownloads((l) => l.map((d) => (d.id === id ? fn(d) : d)));

  const value = useMemo<Ctx>(() => {
    const active = downloads.filter((d) => d.status === "downloading");
    return {
      downloads,
      settings,
      extension,
      setSettings: (s) => setSettingsState((p) => ({ ...p, ...s })),
      add: (url, threads, path) => {
        const name = fileNameFromUrl(url);
        const size = Math.round((80 + Math.random() * 1800) * MB);
        setDownloads((l) => [
          { id: uid(), name, url, size, category: detectCategory(name), status: "downloading", threads,
            chunks: makeChunks(size, threads), speed: 0, path },
          ...l,
        ]);
      },
      pause: (id) => patch(id, (d) => (d.status === "downloading" || d.status === "queued" ? { ...d, status: "paused", speed: 0 } : d)),
      resume: (id) => patch(id, (d) => (d.status === "paused" || d.status === "error" ? { ...d, status: "downloading" } : d)),
      cancel: (id) => patch(id, (d) => ({ ...d, status: "error", speed: 0 })),
      remove: (id) => setDownloads((l) => l.filter((d) => d.id !== id)),
      pauseAll: () => setDownloads((l) => l.map((d) => (d.status === "downloading" || d.status === "queued" ? { ...d, status: "paused", speed: 0 } : d))),
      resumeAll: () => setDownloads((l) => l.map((d) => (d.status === "paused" ? { ...d, status: "downloading" } : d))),
      stats: {
        down: active.reduce((a, d) => a + d.speed, 0),
        up: active.length ? up : 0,
        threads: active.reduce((a, d) => a + d.chunks.filter((c) => c.done < c.size).length, 0),
        active: active.length,
      },
    };
  }, [downloads, settings, up, extension]);

  return <DDMContext.Provider value={value}>{children}</DDMContext.Provider>;
}

export function useDDM() {
  const c = useContext(DDMContext);
  if (!c) throw new Error("useDDM must be used inside DDMProvider");
  return c;
}

export function fmtBytes(b: number) {
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(2)} GB`;
  if (b >= MB) return `${(b / MB).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
export const fmtSpeed = (b: number) => `${(b / MB).toFixed(2)} MB/s`;
export function fmtEta(remaining: number, speed: number) {
  if (!speed) return "—";
  const s = Math.round(remaining / speed);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
