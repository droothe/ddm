import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DDMProvider } from "@/lib/ddm-store";

const engine = vi.hoisted(() => ({
  externalDownloadListener: null as ((url: string) => void) | null,
  probeDownload: vi.fn(),
}));

vi.mock("@/lib/downloadEngine", () => ({
  cancelDownload: vi.fn(),
  extractMediaUrl: vi.fn(),
  isAndroidTauriRuntime: () => false,
  isTauriRuntime: () => false,
  listenForExternalDownloads: async (listener: (url: string) => void) => {
    engine.externalDownloadListener = listener;
    return () => {};
  },
  listenForProgress: async () => () => {},
  openDownloadFolder: vi.fn(),
  pauseDownload: vi.fn(),
  probeDownload: engine.probeDownload,
  publishDownloadToAndroid: vi.fn(),
  resumeDownload: vi.fn(),
  setGlobalSpeedLimit: vi.fn(),
  startDownload: vi.fn().mockResolvedValue(undefined),
}));

describe("external downloads", () => {
  afterEach(() => {
    engine.externalDownloadListener = null;
    engine.probeDownload.mockReset();
  });

  it("automatically queues links received from the browser extension", async () => {
    const url = "https://example.com/file.zip";
    engine.probeDownload.mockResolvedValue({
      name: "file.zip",
      size: 1024,
      supportsRanges: true,
    });

    render(
      <DDMProvider>
        <div />
      </DDMProvider>,
    );

    await waitFor(() => expect(engine.externalDownloadListener).toBeTypeOf("function"));
    act(() => engine.externalDownloadListener?.(url));

    await waitFor(() => expect(engine.probeDownload).toHaveBeenCalledWith(url, 8));
  });
});
