import type { DownloadItem, Status, ThreadSegment } from "./ddm-store";

export interface DownloadMetadata {
  name: string;
  extension?: string;
  mimeType?: string;
  size: number;
  supportsRanges: boolean;
}

export interface DirectMedia {
  url: string;
  name: string;
  mimeType: string;
}

export interface EngineProgress {
  id: string;
  status?: Status;
  size?: number;
  speed?: number;
  chunks?: ThreadSegment[];
  errorMessage?: string;
  filePath?: string;
}

export interface PublishedDownload {
  uri: string;
}

type ProgressListener = (event: EngineProgress) => void;
type ExternalDownloadListener = (url: string) => void;

interface TauriBridge {
  core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  event?: {
    listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
  deepLink?: {
    getCurrent(): Promise<string[] | null>;
    onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>;
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriBridge;
  }
}

interface BrowserTask {
  item: DownloadItem;
  chunks: BrowserChunk[];
  state: "downloading" | "paused" | "cancelled" | "error";
  generation: number;
  controllers: Set<AbortController>;
  lastProgressAt: number;
  lastProgressBytes: number;
}

interface BrowserChunk extends ThreadSegment {
  parts: Uint8Array[];
}

const browserTasks = new Map<string, BrowserTask>();
const progressListeners = new Set<ProgressListener>();
let tauriProgressUnlisten: (() => void) | undefined;
let tauriProgressSetup: Promise<void> | undefined;
let speedLimitBytesPerSecond = 0;
let nextPermittedReadAt = 0;

export function setGlobalSpeedLimit(limitMB: number): void {
  speedLimitBytesPerSecond = limitMB > 0 ? limitMB * 1024 * 1024 : 0;
  if (speedLimitBytesPerSecond === 0) nextPermittedReadAt = 0;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI__?.core?.invoke === "function";
}

export function isAndroidTauriRuntime(): boolean {
  return isTauriRuntime() && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export async function readClipboardText(): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("plugin:clipboard-manager|read_text");
  }
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    throw new Error("Clipboard access is not available in this environment.");
  }
  return navigator.clipboard.readText();
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriInvoke = typeof window !== "undefined" ? window.__TAURI__?.core?.invoke : undefined;
  if (!tauriInvoke) throw new Error("The Tauri download backend is not available in this browser.");
  return tauriInvoke<T>(command, args);
}

function emitProgress(event: EngineProgress) {
  for (const listener of progressListeners) listener(event);
}

function validateUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS download URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS download URLs are supported.");
  }
  return parsed;
}

export function extractDownloadUrlFromDeepLink(value: string): string {
  let deepLink: URL;
  try {
    deepLink = new URL(value);
  } catch {
    throw new Error("Invalid DDM deep link.");
  }

  if (
    deepLink.protocol !== "ddm:" ||
    !["add", "download"].includes(deepLink.hostname) ||
    (deepLink.pathname !== "" && deepLink.pathname !== "/")
  ) {
    throw new Error("Unsupported DDM deep link.");
  }

  const downloadUrl = deepLink.searchParams.get("url");
  if (!downloadUrl) throw new Error("The DDM deep link is missing its download URL.");
  return validateUrl(downloadUrl).href;
}

function parseSize(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : undefined;
}

function parseContentRange(value: string | null): number | undefined {
  const match = value?.match(/^bytes\s+\d+-\d+\/(\d+)$/i);
  return match?.[1] ? parseSize(match[1]) : undefined;
}

function responseName(response: Response, url: string): string {
  const disposition = response.headers.get("content-disposition");
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return plain ?? fileNameFromUrl(url);
    }
  }
  return plain ?? fileNameFromUrl(url);
}

export async function extractMediaUrl(url: string): Promise<DirectMedia> {
  validateUrl(url);
  if (isTauriRuntime()) {
    return invoke<DirectMedia>("extract_media_url", { url });
  }

  const parsed = new URL(url);
  if (isSocialPageHost(parsed.hostname)) {
    throw new Error(
      "Social-media page extraction is not supported. Share a direct media URL that you own or are authorized to download.",
    );
  }

  let response: Response;
  try {
    response = await fetch(url, { method: "HEAD", redirect: "follow" });
  } catch {
    const controller = new AbortController();
    try {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      controller.abort();
    }
  }
  if (!response.ok) throw new Error(`Could not inspect media URL (HTTP ${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const name = responseName(response, url);
  if (!mimeType.startsWith("video/") && !mimeType.startsWith("audio/")) {
    throw new Error("The shared link is not a direct audio or video file.");
  }
  return { url: response.url || parsed.href, name, mimeType };
}

function isSocialPageHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return [
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "youtu.be",
    "x.com",
    "twitter.com",
  ].some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

export async function probeDownload(url: string, threads: number): Promise<DownloadMetadata> {
  validateUrl(url);
  if (!Number.isInteger(threads) || threads < 1 || threads > 16) {
    throw new Error("Thread count must be between 1 and 16.");
  }

  if (isTauriRuntime()) {
    const metadata = await invoke<DownloadMetadata>("check_url_headers", { url });
    if (!metadata || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
      throw new Error("The native download service returned invalid file metadata.");
    }
    return metadata;
  }

  let size: number | undefined;
  let name = fileNameFromUrl(url);
  let mimeType: string | undefined;
  let acceptsRanges = false;

  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (head.ok) {
      acceptsRanges = /^bytes$/i.test(head.headers.get("accept-ranges") ?? "");
      size = parseSize(head.headers.get("content-length"));
      name = responseName(head, url);
      mimeType = head.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
    }
  } catch {
    // Some servers reject HEAD; the ranged request below can still provide metadata.
  }

  const controller = new AbortController();
  let supportsRanges = false;
  try {
    const response = await fetch(url, {
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
      redirect: "follow",
    });
    name = responseName(response, url);
    mimeType ??= response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;

    if (response.status === 206) {
      supportsRanges = true;
      size = parseContentRange(response.headers.get("content-range")) ?? size;
    } else if (response.ok) {
      if (acceptsRanges) {
        console.warn("The server advertised byte ranges but ignored the range probe.");
      }
      size = parseSize(response.headers.get("content-length")) ?? size;
    } else {
      throw new Error(`The server rejected the download probe (HTTP ${response.status}).`);
    }
    await response.body?.cancel();
  } catch (error) {
    if (error instanceof Error && !isAbortError(error)) throw error;
    if (!size) {
      throw new Error(
        "Could not read the file size. Check the URL and the server's CORS settings.",
      );
    }
  } finally {
    controller.abort();
  }

  if (!size) {
    throw new Error("The server did not expose a usable Content-Length or Content-Range header.");
  }
  const extension = fileExtension(name);
  return {
    name,
    ...(extension ? { extension } : {}),
    ...(mimeType ? { mimeType } : {}),
    size,
    supportsRanges,
  };
}

export async function startDownload(item: DownloadItem): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("start_download", {
      url: item.url,
      savePath: item.path,
      threadCount: item.threads,
      downloadId: item.id,
      speedLimitBytesPerSecond,
    });
    return;
  }

  const existingTask = browserTasks.get(item.id);
  if (existingTask && (existingTask.state === "paused" || existingTask.state === "error")) {
    existingTask.item = item;
    existingTask.state = "downloading";
    if (!item.supportsRanges) {
      for (const chunk of existingTask.chunks) {
        chunk.done = 0;
        chunk.parts = [];
      }
      emitChunkProgress(existingTask);
    }
    runBrowserTask(existingTask);
    return;
  }
  if (existingTask?.state === "downloading") return;

  const task: BrowserTask = {
    item,
    chunks: item.chunks.map((chunk) => ({ ...chunk, parts: [] })),
    state: "downloading",
    generation: 0,
    controllers: new Set(),
    lastProgressAt: Date.now(),
    lastProgressBytes: 0,
  };
  browserTasks.set(item.id, task);
  runBrowserTask(task);
}

export async function pauseDownload(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("pause_download", { id });
    return;
  }
  const task = browserTasks.get(id);
  if (!task || task.state !== "downloading") return;
  task.state = "paused";
  task.generation += 1;
  for (const controller of task.controllers) controller.abort();
  task.controllers.clear();
  emitProgress({ id, status: "paused", speed: 0 });
}

export async function resumeDownload(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("resume_download", { id });
    return;
  }
  const task = browserTasks.get(id);
  if (!task || (task.state !== "paused" && task.state !== "error")) return;
  task.state = "downloading";
  if (!task.item.supportsRanges) {
    for (const chunk of task.chunks) {
      chunk.done = 0;
      chunk.parts = [];
    }
    emitChunkProgress(task);
  }
  runBrowserTask(task);
}

export async function cancelDownload(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("cancel_download", { id });
    return;
  }
  const task = browserTasks.get(id);
  if (!task) return;
  task.state = "cancelled";
  task.generation += 1;
  for (const controller of task.controllers) controller.abort();
  task.controllers.clear();
  browserTasks.delete(id);
}

export async function openDownloadFolder(path: string, name: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      "Opening a local folder requires the native Tauri app. Browser downloads use the browser's save location.",
    );
  }
  if (isAndroidTauriRuntime()) {
    if (!path.startsWith("content://")) {
      throw new Error("This download has not been published to Android media storage yet.");
    }
    await invoke<void>("plugin:share-intent|openMediaStoreItem", { uri: path });
    return;
  }
  await invoke<void>("show_download_in_folder", { path, name });
}

export async function publishDownloadToAndroid(
  sourcePath: string,
  name: string,
  mimeType?: string,
): Promise<PublishedDownload> {
  if (!isAndroidTauriRuntime()) {
    throw new Error("Android MediaStore is available only in the Android app.");
  }
  const result = await invoke<PublishedDownload>("plugin:share-intent|publishDownload", {
    sourcePath,
    name,
    ...(mimeType ? { mimeType } : {}),
  });
  if (!result || typeof result.uri !== "string" || !result.uri.startsWith("content://")) {
    throw new Error("Android did not return a valid MediaStore URI.");
  }
  return result;
}

async function runBrowserTask(task: BrowserTask): Promise<void> {
  const generation = ++task.generation;
  emitProgress({ id: task.item.id, status: "downloading", speed: 0 });
  task.lastProgressAt = Date.now();
  task.lastProgressBytes = task.chunks.reduce((total, chunk) => total + chunk.done, 0);

  try {
    await Promise.all(task.chunks.map((chunk) => downloadChunk(task, chunk, generation)));
    if (generation !== task.generation || task.state !== "downloading") return;

    if (task.chunks.some((chunk) => chunk.done !== chunk.size)) {
      throw new Error("The server ended the response before the full file was downloaded.");
    }
    const parts = task.chunks.flatMap((chunk) => chunk.parts);
    saveBlob(parts, task.item.name);
    task.state = "paused";
    browserTasks.delete(task.item.id);
    emitProgress({ id: task.item.id, status: "completed", speed: 0 });
  } catch (error) {
    if (generation !== task.generation || task.state !== "downloading") return;
    task.state = "error";
    task.generation += 1;
    for (const controller of task.controllers) controller.abort();
    task.controllers.clear();
    emitProgress({
      id: task.item.id,
      status: "error",
      speed: 0,
      errorMessage: error instanceof Error ? error.message : "The download failed.",
    });
  }
}

async function downloadChunk(
  task: BrowserTask,
  chunk: BrowserChunk,
  generation: number,
): Promise<void> {
  while (
    chunk.done < chunk.size &&
    generation === task.generation &&
    task.state === "downloading"
  ) {
    const controller = new AbortController();
    task.controllers.add(controller);
    const rangeStart = chunk.start + chunk.done;
    const rangeEnd = chunk.end;
    const request: RequestInit = {
      signal: controller.signal,
      redirect: "follow",
      ...(task.item.supportsRanges
        ? { headers: { Range: `bytes=${rangeStart}-${rangeEnd}` } }
        : {}),
    };

    try {
      const response = await fetch(task.item.url, request);
      if (!response.ok) throw new Error(`Download request failed (HTTP ${response.status}).`);
      if (task.item.supportsRanges && response.status !== 206) {
        throw new Error(
          "The server stopped honoring HTTP Range requests; no partial file was saved.",
        );
      }
      if (!task.item.supportsRanges && response.status === 206) {
        throw new Error("The server unexpectedly returned a partial response for a full download.");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (chunk.done + bytes.byteLength > chunk.size) {
          throw new Error("The server returned more data than the requested byte range.");
        }
        if (!task.item.supportsRanges && chunk.done + bytes.byteLength !== chunk.size) {
          throw new Error("The server ended the response before the full file was downloaded.");
        }
        chunk.parts.push(bytes);
        chunk.done += bytes.byteLength;
        emitChunkProgress(task);
        continue;
      }

      while (generation === task.generation && task.state === "downloading") {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await throttleRead(value.byteLength, controller.signal);
        if (generation !== task.generation || task.state !== "downloading") return;
        await throttleRead(value.byteLength, controller.signal);
        if (generation !== task.generation || task.state !== "downloading") return;
        chunk.parts.push(value);
        chunk.done += value.byteLength;
        if (chunk.done > chunk.size) {
          throw new Error("The server returned more data than the requested byte range.");
        }
        emitChunkProgress(task);
      }
      if (
        generation === task.generation &&
        task.state === "downloading" &&
        !task.item.supportsRanges &&
        chunk.done !== chunk.size
      ) {
        throw new Error("The server ended the response before the full file was downloaded.");
      }
    } catch (error) {
      if (generation !== task.generation || task.state !== "downloading") return;
      throw error;
    } finally {
      task.controllers.delete(controller);
    }
  }
}

async function throttleRead(byteLength: number, signal: AbortSignal): Promise<void> {
  if (speedLimitBytesPerSecond <= 0) return;

  const now = performance.now();
  const delay = Math.max(0, nextPermittedReadAt - now);
  nextPermittedReadAt =
    Math.max(now, nextPermittedReadAt) + (byteLength / speedLimitBytesPerSecond) * 1000;
  if (delay === 0) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const onAbort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("Download throttling was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function emitChunkProgress(task: BrowserTask) {
  const chunks = task.chunks.map(({ parts: _parts, ...chunk }) => chunk);
  const now = Date.now();
  const totalDone = chunks.reduce((total, chunk) => total + chunk.done, 0);
  const elapsed = Math.max(1, now - task.lastProgressAt) / 1000;
  const speed = Math.max(0, totalDone - task.lastProgressBytes) / elapsed;
  task.lastProgressAt = now;
  task.lastProgressBytes = totalDone;
  emitProgress({
    id: task.item.id,
    status: "downloading",
    chunks,
    size: task.item.size,
    speed,
  });
}

function saveBlob(parts: Uint8Array[], name: string) {
  const blob = new Blob(parts as BlobPart[], { type: "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function fileNameFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const encodedName = pathname.split("/").filter(Boolean).pop();
  if (!encodedName) return new URL(url).hostname;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function fileExtension(name: string): string | undefined {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toLowerCase() : undefined;
}

function isAbortError(error: Error): boolean {
  return error.name === "AbortError";
}

export async function listenForProgress(listener: ProgressListener): Promise<() => void> {
  progressListeners.add(listener);
  if (isTauriRuntime() && window.__TAURI__?.event?.listen && !tauriProgressSetup) {
    tauriProgressSetup = window.__TAURI__.event
      .listen<EngineProgress>("download-progress", ({ payload }) => emitProgress(payload))
      .then((unlisten) => {
        tauriProgressUnlisten = unlisten;
      })
      .catch((error: unknown) => {
        tauriProgressSetup = undefined;
        throw error;
      });
  }
  await tauriProgressSetup;
  return () => {
    progressListeners.delete(listener);
    if (progressListeners.size === 0) {
      tauriProgressUnlisten?.();
      tauriProgressUnlisten = undefined;
      tauriProgressSetup = undefined;
    }
  };
}

export async function listenForExternalDownloads(
  listener: ExternalDownloadListener,
): Promise<() => void> {
  const handleUrl = (value: unknown) => {
    if (typeof value !== "string") return;
    try {
      const parsed = validateUrl(value);
      listener(parsed.href);
    } catch (error) {
      console.warn("Ignored invalid external download URL.", error);
    }
  };
  const handleDeepLink = (value: string) => {
    try {
      handleUrl(extractDownloadUrlFromDeepLink(value));
    } catch (error) {
      console.warn("Ignored invalid DDM deep link.", error);
    }
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      event.source !== window ||
      !isRecord(event.data) ||
      event.data["type"] !== "ddm:add-download"
    )
      return;
    handleUrl(event.data["url"]);
  };
  const onCustomEvent = (event: Event) => {
    if (event instanceof CustomEvent) {
      handleUrl(isRecord(event.detail) ? event.detail["url"] : event.detail);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("message", onMessage);
    window.addEventListener("ddm:add-download", onCustomEvent);
  }

  let unlistenTauri: (() => void) | undefined;
  let unlistenDeepLink: (() => void) | undefined;
  if (isTauriRuntime() && window.__TAURI__?.event?.listen) {
    try {
      unlistenTauri = await window.__TAURI__.event.listen<{ url: string }>(
        "external-download-request",
        ({ payload }) => handleUrl(payload["url"]),
      );
      if (!isAndroidTauriRuntime() && window.__TAURI__?.deepLink) {
        unlistenDeepLink = await window.__TAURI__.deepLink.onOpenUrl((urls) =>
          urls.forEach(handleDeepLink),
        );
        const currentUrls = await window.__TAURI__.deepLink.getCurrent();
        currentUrls?.forEach(handleDeepLink);
      }
    } catch (error) {
      unlistenTauri?.();
      unlistenDeepLink?.();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("ddm:add-download", onCustomEvent);
      throw error;
    }
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("ddm:add-download", onCustomEvent);
    }
    unlistenTauri?.();
    unlistenDeepLink?.();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
