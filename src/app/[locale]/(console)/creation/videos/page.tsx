"use client";

import { VideoRenderPanel } from "@/components/creation/video-render-panel";
import { VideosComposer } from "@/components/creation/videos-composer";

export default function VideosPage() {
  return (
    <div className="space-y-4">
      {/* The deliverable package comes first: it is what turns a video already in the library into the
          files a publishing task consumes, and it is the entry CI-P1-04's render contract never had. */}
      <VideoRenderPanel />
      <VideosComposer />
    </div>
  );
}
