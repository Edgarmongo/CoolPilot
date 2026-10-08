import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_BYTES,
  VIDEO_DESCRIPTION_MAX_LENGTH,
  VIDEO_TITLE_MAX_LENGTH,
  formatVideoSize,
  isVideoFileName,
  videoContentType,
  videoFileExtension,
  videoPathFromMetadata,
  videoUrl,
} from "./video-library";

describe("video library", () => {
  it("accepts the supported video extensions", () => {
    expect(isVideoFileName("clip.mp4")).toBe(true);
    expect(isVideoFileName("clip.MOV")).toBe(true);
    expect(isVideoFileName("clip.webm")).toBe(true);
    expect(isVideoFileName("clip.m4v")).toBe(true);
  });

  it("rejects images, archives and names without an extension", () => {
    expect(isVideoFileName("photo.png")).toBe(false);
    expect(isVideoFileName("archive.zip")).toBe(false);
    expect(isVideoFileName("noextension")).toBe(false);
    expect(isVideoFileName(".mp4")).toBe(false);
  });

  it("maps a stored file name to a streaming content type", () => {
    expect(videoContentType("clip.mp4")).toBe("video/mp4");
    expect(videoContentType("clip.webm")).toBe("video/webm");
    expect(videoContentType("clip.mov")).toBe("video/quicktime");
    expect(videoContentType("clip.unknown")).toBe("application/octet-stream");
  });

  it("builds an encoded streaming url and exposes the upload cap", () => {
    expect(videoUrl("video-1 clip.mp4")).toBe("/api/videos?file=video-1%20clip.mp4");
    expect(videoFileExtension("clip.MP4")).toBe(".mp4");
    expect(MAX_VIDEO_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(VIDEO_TITLE_MAX_LENGTH).toBe(60);
    expect(VIDEO_DESCRIPTION_MAX_LENGTH).toBe(2000);
  });

  it("formats byte sizes for the library list", () => {
    expect(formatVideoSize(0)).toBe("0 B");
    expect(formatVideoSize(512)).toBe("512 B");
    expect(formatVideoSize(2048)).toBe("2.0 KB");
    expect(formatVideoSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatVideoSize(200 * 1024 * 1024)).toBe("200 MB");
    expect(formatVideoSize(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });

  it("reads the video recorded on a content item", () => {
    expect(videoPathFromMetadata({ videoPath: " video-1.mp4 " })).toBe("video-1.mp4");
    expect(videoPathFromMetadata({ videoPath: 42 })).toBe("");
    expect(videoPathFromMetadata(undefined)).toBe("");
  });
});
