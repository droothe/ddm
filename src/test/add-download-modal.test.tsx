import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddDownloadModal } from "@/components/ddm/AddDownloadModal";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  chooseDownloadDirectory: vi.fn(),
  readClipboardText: vi.fn(),
  resolveSharedMedia: vi.fn(),
}));

vi.mock("@/lib/ddm-store", async () => {
  const { translate } = await import("@/lib/i18n");
  return {
    detectCategory: () => "other",
    fileNameFromUrl: (url: string) => url.split("/").pop() ?? "download.bin",
    useDDM: () => ({
      add: mocks.add,
      settings: {
        language: "en",
        defaultDir: "C:\\Users\\user\\Downloads",
        defaultThreads: 8,
      },
      sharedMedia: null,
      shareError: null,
      resolveSharedMedia: mocks.resolveSharedMedia,
      t: translate.bind(null, "en"),
    }),
  };
});

vi.mock("@/lib/downloadEngine", () => ({
  chooseDownloadDirectory: mocks.chooseDownloadDirectory,
  isAndroidTauriRuntime: () => false,
  readClipboardText: mocks.readClipboardText,
}));

describe("AddDownloadModal", () => {
  beforeEach(() => {
    mocks.add.mockReset().mockResolvedValue(true);
    mocks.chooseDownloadDirectory.mockReset().mockResolvedValue(null);
    mocks.readClipboardText.mockReset().mockResolvedValue("");
    Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
    mocks.resolveSharedMedia.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "isTauri");
  });

  it("keeps the dialog interactive and handles input, paste, start and close actions", async () => {
    const onClose = vi.fn();
    render(<AddDownloadModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "New Download" });
    const input = screen.getByRole("textbox", { name: "URL (DDL / Video)" });
    expect(mocks.readClipboardText).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    expect(dialog.className).toContain("pointer-events-auto");
    expect(dialog.className).toContain("z-[101]");
    expect(
      screen.getByText("Downloads are saved to the selected directory by the native app."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Start Download" })).toBeDisabled();

    mocks.chooseDownloadDirectory.mockResolvedValue("C:\\Users\\user\\Documents");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Browse..." }));
    });
    expect(screen.getByRole("textbox", { name: "Download directory" })).toHaveValue(
      "C:\\Users\\user\\Documents",
    );

    fireEvent.change(input, { target: { value: "https://example.com/typed.zip" } });
    expect(input).toHaveValue("https://example.com/typed.zip");
    expect(screen.getByRole("button", { name: "Start Download" })).toBeEnabled();

    mocks.readClipboardText.mockResolvedValue("https://example.com/pasted.zip");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    });
    await waitFor(() => expect(input).toHaveValue("https://example.com/pasted.zip"));

    fireEvent.change(input, { target: { value: "https://example.com/final.zip" } });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start Download" }));
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith(
        "https://example.com/final.zip",
        8,
        "C:\\Users\\user\\Documents",
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByTestId("download-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("shows folder chooser errors", async () => {
    mocks.chooseDownloadDirectory.mockRejectedValue(new Error("Folder picker failed."));
    render(<AddDownloadModal open onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Browse..." }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Folder picker failed.");
  });
});
