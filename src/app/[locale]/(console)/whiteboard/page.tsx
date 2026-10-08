"use client";

import dynamic from "next/dynamic";

const WhiteboardCanvas = dynamic(() => import("@/whiteboard/whiteboard-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">加载中…</div>
  ),
});

export default function WhiteboardPage() {

  return (
    <div className="relative h-full w-full">
      <WhiteboardCanvas />
    </div>
  );
}

