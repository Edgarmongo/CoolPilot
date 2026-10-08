import { ApiClientError, type ApiResponse } from "@/lib/api-client";
import type { StoredVideo } from "@/lib/video-library";

export type VideoUploadResult = Pick<StoredVideo, "fileName" | "url" | "size" | "createdAt">;

/**
 * Uploads a video with progress reporting.
 *
 * `fetch` cannot report upload progress, and multi-gigabyte files need a visible bar,
 * so this goes through XMLHttpRequest.
 */
export function uploadVideoFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<VideoUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/videos/upload");
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(new ApiClientError({ code: "UNKNOWN_ERROR", message: "Video upload failed" }));
    request.ontimeout = () =>
      reject(new ApiClientError({ code: "UNKNOWN_ERROR", message: "Video upload timed out" }));
    request.onload = () => {
      const body = request.response as ApiResponse<VideoUploadResult> | null;
      if (request.status >= 200 && request.status < 300 && body?.ok) {
        onProgress?.(100);
        resolve(body.data);
        return;
      }
      const failure = body && !body.ok ? body : undefined;
      reject(
        new ApiClientError({
          code: failure?.code,
          message: failure?.message ?? failure?.error ?? `Video upload failed (${request.status})`,
        }),
      );
    };

    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}
