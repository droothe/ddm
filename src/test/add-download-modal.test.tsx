import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddDownloadModal } from "@/components/ddm/AddDownloadModal";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  readClipboardText: vi.fn(),
  resolveSharedMedia: vi.fn(),
}));

vi.mock("@/lib/ddm-store", () => ({
  detectCategory: () => "other",
  fileNameFromUrl: (url: string) => url.split("/").pop() ?? "download.bin",
  useDDM: () => ({
    add: mocks.add,
    settings: {
      defaultDir: "C:\\Users\\user\\Downloads",
      defaultThreads: 8,
    },
    sharedMedia: null,
    shareError: null,
    resolveSharedMedia: mocks.resolveSharedMedia,
  }),
}));

vi.mock("@/lib/downloadEngine", () => ({
  isAndroidTauriRuntime: () => false,
  readClipboardText: mocks.readClipboardText,
}));

describe("AddDownloadModal", () => {
  beforeEach(() => {
    mocks.add.mockReset().mockResolvedValue(true);
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
    expect(input).toHaveFocus();
    expect(dialog.className).toContain("pointer-events-auto");
    expect(dialog.className).toContain("z-[101]");
    expect(
      screen.getByText("Downloads are saved to the selected directory by the native app."),
    ).toBeVisible();

    fireEvent.change(input, { target: { value: "https://example.com/typed.zip" } });
    expect(input).toHaveValue("https://example.com/typed.zip");

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
        "C:\\Users\\user\\Downloads",
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
});
