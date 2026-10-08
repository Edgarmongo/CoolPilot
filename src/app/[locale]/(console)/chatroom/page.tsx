"use client";

import { Suspense } from "react";
import { ChatConversation } from "@/components/agent-chat/chat-conversation";

/** Standalone AI chat surface (ChatGPT-style layout). */
export default function ChatroomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>
      }
    >
      <ChatConversation />
    </Suspense>
  );
}
