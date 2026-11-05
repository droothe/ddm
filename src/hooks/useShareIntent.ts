import { useEffect } from "react";

export interface SharedText {
  text: string;
  mimeType?: string;
}

export function extractSharedUrl(text: string): string | null {
  const candidate = text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;!?]+$/, "");
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function useShareIntent(onUrl: (url: string) => void): void {
  useEffect(() => {
    let disposed = false;

    const handleShare = (payload: unknown) => {
      if (disposed) return;
      if (!isRecord(payload)) return;
      const text = payload["text"];
      const mimeType = payload["mimeType"];
      if (mimeType !== undefined && mimeType !== "text/plain") return;
      if (typeof text !== "string") return;

      const url = extractSharedUrl(text);
      if (url) onUrl(url);
    };

    const onCustomEvent = (event: Event) => {
      if (event instanceof CustomEvent) handleShare(event.detail);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source === window && isRecord(event.data) && event.data["type"] === "ddm:share-intent") {
        handleShare(event.data);
      }
    };

    window.addEventListener("ddm:share-intent", onCustomEvent);
    window.addEventListener("message", onMessage);

    const initialIntentBridge = window.__TAURI__?.core;
    if (initialIntentBridge && /Android/i.test(navigator.userAgent)) {
      void initialIntentBridge
        .invoke<SharedText | null>("plugin:share-intent|getInitialSharedText")
        .then((payload) => {
          if (payload) handleShare(payload);
        })
        .catch((error: unknown) => {
          console.error("Could not read the initial Android share intent.", error);
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("ddm:share-intent", onCustomEvent);
      window.removeEventListener("message", onMessage);
    };
  }, [onUrl]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
