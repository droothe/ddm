import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadRow } from "@/components/ddm/DownloadRow";
import type { Download } from "@/lib/ddm-store";

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  openFolder: vi.fn(),
}));

vi.mock("@/lib/ddm-store", async () => {
  const { translate } = await import("@/lib/i18n");
  return {
    bytesDone: (download: Download) =>
      download.chunks.reduce((total, chunk) => total + chunk.done, 0),
    fmtBytes: (bytes: number) => `${bytes} B`,
    fmtEta: () => "—",
    fmtSpeed: () => "0.00 MB/s",
    progress: () => 1,
    useDDM: () => ({
      pause: mocks.pause,
      resume: mocks.resume,
      cancel: mocks.cancel,
      remove: mocks.remove,
      openFolder: mocks.openFolder,
      settings: { language: "en" },
      t: translate.bind(null, "en"),
    }),
  };
});

const download: Download = {
  id: "download-1",
  name: "file.zip",
  url: "https://example.com/file.zip",
  size: 10,
  category: "archive",
  status: "completed",
  threads: 1,
  chunks: [{ start: 0, end: 9, size: 10, done: 10 }],
  speed: 0,
  path: "C:\\Downloads",
  supportsRanges: false,
  prepared: true,
};

describe("DownloadRow", () => {
  beforeEach(() => {
    mocks.remove.mockReset();
  });

  it("only deletes after the user confirms", async () => {
    render(<DownloadRow d={download} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Delete this download?" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete download" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(download.id));
  });
});
