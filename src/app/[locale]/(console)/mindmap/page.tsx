"use client";

import dynamic from "next/dynamic";

const MindMapCanvas = dynamic(() => import("@/mindmap/mindmap-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">加载中…</div>
  ),
});

export default function MindMapPage() {
  return (
    <div className="relative h-full w-full">
      <MindMapCanvas />
    </div>
  );
}