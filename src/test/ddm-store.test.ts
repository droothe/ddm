import { describe, expect, it } from "vitest";
import { createThreadSegments } from "@/lib/ddm-store";
import { extractSharedUrl } from "@/hooks/useShareIntent";

describe("createThreadSegments", () => {
  it("divides byte ranges without gaps or overlap", () => {
    const segments = createThreadSegments(10, 3);

    expect(segments).toEqual([
      { start: 0, end: 2, size: 3, done: 0 },
      { start: 3, end: 5, size: 3, done: 0 },
      { start: 6, end: 9, size: 4, done: 0 },
    ]);
    expect(segments.reduce((total, segment) => total + segment.size, 0)).toBe(10);
  });

  describe("extractSharedUrl", () => {
    it("extracts a web URL from Android shared text", () => {
      expect(extractSharedUrl("Check this out: https://example.com/video.mp4?x=1")).toBe(
        "https://example.com/video.mp4?x=1",
      );
    });

    it("ignores non-web and malformed shared text", () => {
      expect(extractSharedUrl("file:///storage/video.mp4")).toBeNull();
      expect(extractSharedUrl("nothing to download")).toBeNull();
    });
  });

  it("does not create empty ranges when the file is smaller than the thread count", () => {
    expect(createThreadSegments(2, 16)).toEqual([
      { start: 0, end: 0, size: 1, done: 0 },
      { start: 1, end: 1, size: 1, done: 0 },
    ]);
  });

  it("rejects invalid file sizes and thread counts", () => {
    expect(() => createThreadSegments(0, 1)).toThrow("valid file size");
    expect(() => createThreadSegments(10, 0)).toThrow("between 1 and 16");
    expect(() => createThreadSegments(10, 17)).toThrow("between 1 and 16");
  });
});
