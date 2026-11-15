import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DDMProvider, useDDM } from "@/lib/ddm-store";

const engine = vi.hoisted(() => ({
  externalDownloadListener: null as ((url: string) => void) | null,
  probeDownload: vi.fn(),
  chooseDownloadTarget: vi.fn(),
  getDefaultDownloadDirectory: vi.fn(),
  isTauriRuntime: vi.fn(),
}));

vi.mock("@/lib/downloadEngine", () => ({
  cancelDownload: vi.fn(),
  chooseDownloadTarget: engine.chooseDownloadTarget,
  extractMediaUrl: vi.fn(),
  getDefaultDownloadDirectory: engine.getDefaultDownloadDirectory,
  isAndroidTauriRuntime: () => false,
  isTauriRuntime: engine.isTauriRuntime,
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
    engine.chooseDownloadTarget.mockReset();
    engine.getDefaultDownloadDirectory.mockReset();
    engine.isTauriRuntime.mockReset().mockReturnValue(false);
    window.localStorage.clear();
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

  it("persists the selected folder and ask-before-save setting", async () => {
    function SettingsProbe() {
      const { settings, setSettings } = useDDM();
      return (
        <button
          onClick={() =>
            setSettings({ defaultDir: "C:\\Users\\user\\Downloads", askWhereToSave: true })
          }
        >
          {settings.defaultDir || "No folder"}|{String(settings.askWhereToSave)}
        </button>
      );
    }

    const firstRender = render(
      <DDMProvider>
        <SettingsProbe />
      </DDMProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "No folder|false" }));

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("ddm-settings-v1") ?? "{}")).toMatchObject({
        defaultDir: "C:\\Users\\user\\Downloads",
        askWhereToSave: true,
      }),
    );
    firstRender.unmount();

    render(
      <DDMProvider>
        <SettingsProbe />
      </DDMProvider>,
    );
    expect(await screen.findByRole("button", { name: "C:\\Users\\user\\Downloads|true" })).toBeVisible();
  });

  it("does not queue an external download when the save dialog is cancelled", async () => {
    const url = "https://example.com/file.zip";
    engine.isTauriRuntime.mockReturnValue(true);
    engine.getDefaultDownloadDirectory.mockResolvedValue("C:\\Users\\user\\Downloads");
    engine.chooseDownloadTarget.mockResolvedValue(null);

    function EnableSavePrompt() {
      const { settings, setSettings } = useDDM();
      return (
        <button onClick={() => setSettings({ askWhereToSave: true })}>
          {settings.askWhereToSave ? "Enabled" : "Enable"}
        </button>
      );
    }

    render(
      <DDMProvider>
        <EnableSavePrompt />
      </DDMProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    await waitFor(() => expect(engine.externalDownloadListener).toBeTypeOf("function"));

    await act(async () => {
      engine.externalDownloadListener?.(url);
    });

    await waitFor(() =>
      expect(engine.chooseDownloadTarget).toHaveBeenCalledWith(
        "C:\\Users\\user\\Downloads\\file.zip",
      ),
    );
    expect(engine.probeDownload).not.toHaveBeenCalled();
  });
});
